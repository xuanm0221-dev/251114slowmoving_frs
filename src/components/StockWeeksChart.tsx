"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { 
  ItemTab, 
  ITEM_TABS,
  ChannelTab,
  InventoryItemTabData, 
  SalesItemTabData,
  InventoryBrandData,
  SalesBrandData,
  InventoryMonthData,
  SalesMonthData,
} from "@/types/sales";

interface StockWeeksChartProps {
  selectedTab: ItemTab;
  inventoryData: InventoryItemTabData;
  salesData: SalesItemTabData;
  daysInMonth: { [month: string]: number };
  stockWeek: number;
  // 모두선택 모드용
  showAllItems: boolean;
  allInventoryData?: InventoryBrandData;
  allSalesData?: SalesBrandData;
  // 채널 탭
  channelTab: ChannelTab;
}

// 아이템별 색상 정의 (주력: 진한색, 아울렛: 연한색)
const ITEM_COLORS: Record<ItemTab, { core: string; outlet: string }> = {
  전체: { core: "#1f2937", outlet: "#9ca3af" },      // 검정 / 연한 검정
  Shoes: { core: "#2563EB", outlet: "#93C5FD" },     // 진한 파랑 / 연한 파랑
  Headwear: { core: "#DC2626", outlet: "#FCA5A5" },  // 진한 빨강 / 연한 빨강
  Bag: { core: "#16A34A", outlet: "#86EFAC" },       // 진한 초록 / 연한 초록
  Acc_etc: { core: "#CA8A04", outlet: "#FDE047" },   // 진한 노랑 / 연한 노랑
};

// 아이템 라벨
const ITEM_LABELS: Record<ItemTab, string> = {
  전체: "전체",
  Shoes: "신발",
  Headwear: "모자",
  Bag: "가방",
  Acc_etc: "기타",
};

// 2025년 월 목록
const MONTHS_2025 = [
  "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
  "2025.07", "2025.08", "2025.09", "2025.10", "2025.11", "2025.12"
];

// 2025~2026년 월 목록 (forecast 25.11~26.04까지 포함)
const MONTHS_2025_WITH_FORECAST = [
  ...MONTHS_2025,
  "2026.01",
  "2026.02",
  "2026.03",
  "2026.04",
];

// 채널 라벨
const CHANNEL_LABELS: Record<ChannelTab, string> = {
  ALL: "전체",
  FRS: "대리상",
  창고: "창고",
};

// daysInMonth에 값이 없는 월(26.01~26.04 등)은 캘린더 기준으로 일수 계산
function getDaysInMonthFromYm(month: string): number {
  const [yearStr, monthStr] = month.split(".");
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (!year || !m) return 30; // 안전한 기본값
  // JS Date: month는 1월=1 기준에서 마지막 날 구하기 위해 (year, m, 0)
  return new Date(year, m, 0).getDate();
}

// 월 문자열을 "25.01", "26.01" 형식으로 변환
function formatMonthLabel(month: string): string {
  const [yearStr, monthStr] = month.split(".");
  return `${yearStr.slice(-2)}.${monthStr}`;
}

// 상품 타입 탭 타입
type ProductTypeTab = "전체" | "주력" | "아울렛";

export default function StockWeeksChart({
  selectedTab,
  inventoryData,
  salesData,
  daysInMonth,
  stockWeek,
  showAllItems,
  allInventoryData,
  allSalesData,
  channelTab,
}: StockWeeksChartProps) {
  // 상품 타입 탭 상태
  const [productTypeTab, setProductTypeTab] = useState<ProductTypeTab>("전체");

  // 주수 계산 함수
  const calculateWeeks = (inventory: number, sales: number, days: number): number | null => {
    if (sales === 0 || days === 0) return null;
    const dailySales = sales / days;
    const weeklySales = dailySales * 7;
    if (weeklySales === 0) return null;
    return inventory / weeklySales;
  };

  // 채널별 재고/판매 데이터 가져오기 (히트맵과 동일한 계산 로직)
  const getChannelData = (
    invData: InventoryMonthData | undefined, 
    slsData: SalesMonthData | undefined,
    days: number
  ) => {
    if (!invData || !slsData) return { stockCore: 0, stockOutlet: 0, salesCore: 0, salesOutlet: 0 };

    // 직영재고 계산 함수 (히트맵과 동일)
    const calculateRetailStock = (orSales: number) => {
      if (days === 0) return 0;
      // 모든 데이터는 원 단위로 저장되어 있음
      return (orSales / days) * 7 * stockWeek;
    };

    switch (channelTab) {
      case "FRS":
        // 대리상: frs_core, frs_outlet 주수 (히트맵과 동일)
        return {
          stockCore: invData.FRS_core || 0,
          stockOutlet: invData.FRS_outlet || 0,
          salesCore: slsData.FRS_core || 0,
          salesOutlet: slsData.FRS_outlet || 0,
        };
      case "창고":
        // 창고: warehouse_core, warehouse_outlet 주수 (히트맵과 동일)
        const retailStockCore = calculateRetailStock(invData.OR_sales_core || 0);
        const retailStockOutlet = calculateRetailStock(invData.OR_sales_outlet || 0);
        const warehouseStockCore = (invData.HQ_OR_core || 0) - retailStockCore;
        // 아울렛은 본사재고(HQ_OR_outlet)를 직접 사용 (본사물류재고 아님)
        return {
          stockCore: Math.max(0, warehouseStockCore),
          stockOutlet: invData.HQ_OR_outlet || 0,  // 본사재고 직접 사용
          // 창고 주력: 전체 판매로 계산 (유지)
          salesCore: slsData.전체_core || 0,
          // 창고 아울렛: 직영판매(OR_sales)만 사용 (대리상판매 제외)
          // 모든 데이터는 원 단위로 저장되어 있음
          salesOutlet: invData.OR_sales_outlet || 0,
        };
      case "ALL":
      default:
        // 전체: total_core, total_outlet 주수 (히트맵과 동일)
        return {
          stockCore: invData.전체_core || 0,
          stockOutlet: invData.전체_outlet || 0,
          salesCore: slsData.전체_core || 0,
          salesOutlet: slsData.전체_outlet || 0,
        };
    }
  };

  // 단일 아이템 차트 데이터 생성 (상품 타입 탭에 따라 계산)
  const singleItemChartData = useMemo(() => {
    return MONTHS_2025_WITH_FORECAST.map((month) => {
      const invData = inventoryData[month];
      const slsData = salesData[month];
      const days = daysInMonth[month] || getDaysInMonthFromYm(month);

      if (!invData || !slsData || !days) {
        return {
          month: formatMonthLabel(month),
          합계: null,
          대리상: null,
        };
      }

      let totalStock: number;
      let totalSales: number;
      let frsStock: number;
      let frsSales: number;

      // 상품 타입 탭에 따라 계산
      switch (productTypeTab) {
        case "주력":
          // 주력상품: core만 사용
          totalStock = invData.전체_core || 0;
          totalSales = slsData.전체_core || 0;
          frsStock = invData.FRS_core || 0;
          frsSales = slsData.FRS_core || 0;
          break;
        case "아울렛":
          // 아울렛상품: outlet만 사용
          totalStock = invData.전체_outlet || 0;
          totalSales = slsData.전체_outlet || 0;
          frsStock = invData.FRS_outlet || 0;
          frsSales = slsData.FRS_outlet || 0;
          break;
        case "전체":
        default:
          // 상품전체: core + outlet
          totalStock = (invData.전체_core || 0) + (invData.전체_outlet || 0);
          totalSales = (slsData.전체_core || 0) + (slsData.전체_outlet || 0);
          frsStock = (invData.FRS_core || 0) + (invData.FRS_outlet || 0);
          frsSales = (slsData.FRS_core || 0) + (slsData.FRS_outlet || 0);
          break;
      }

      // 실선: 합계 기준
      const weeksTotal = calculateWeeks(totalStock, totalSales, days);

      // 점선: 대리상 기준
      const weeksFRS = calculateWeeks(frsStock, frsSales, days);

      // 예상 구간(forecast)에서는 대리상 구분이 없으므로 null로 설정
      const isForecast = slsData.isForecast;
      const displayFRS = isForecast ? null : (weeksFRS !== null ? parseFloat(weeksFRS.toFixed(1)) : null);

      return {
        month: formatMonthLabel(month),
        합계: weeksTotal !== null ? parseFloat(weeksTotal.toFixed(1)) : null,
        대리상: displayFRS,
      };
    });
  }, [inventoryData, salesData, daysInMonth, productTypeTab]);

  // 모든 아이템 차트 데이터 생성 (상품 타입 탭에 따라 계산)
  const allItemsChartData = useMemo(() => {
    if (!showAllItems || !allInventoryData || !allSalesData) return [];

    return MONTHS_2025_WITH_FORECAST.map((month) => {
      const days = daysInMonth[month] || getDaysInMonthFromYm(month);
      const dataPoint: Record<string, string | number | null> = {
        month: formatMonthLabel(month),
      };

      ITEM_TABS.forEach((itemTab) => {
        const invData = allInventoryData[itemTab]?.[month];
        const slsData = allSalesData[itemTab]?.[month];

        if (!invData || !slsData || !days) {
          dataPoint[`${ITEM_LABELS[itemTab]}_합계`] = null;
          dataPoint[`${ITEM_LABELS[itemTab]}_대리상`] = null;
          return;
        }

        let totalStock: number;
        let totalSales: number;
        let frsStock: number;
        let frsSales: number;

        // 상품 타입 탭에 따라 계산
        switch (productTypeTab) {
          case "주력":
            // 주력상품: core만 사용
            totalStock = invData.전체_core || 0;
            totalSales = slsData.전체_core || 0;
            frsStock = invData.FRS_core || 0;
            frsSales = slsData.FRS_core || 0;
            break;
          case "아울렛":
            // 아울렛상품: outlet만 사용
            totalStock = invData.전체_outlet || 0;
            totalSales = slsData.전체_outlet || 0;
            frsStock = invData.FRS_outlet || 0;
            frsSales = slsData.FRS_outlet || 0;
            break;
          case "전체":
          default:
            // 상품전체: core + outlet
            totalStock = (invData.전체_core || 0) + (invData.전체_outlet || 0);
            totalSales = (slsData.전체_core || 0) + (slsData.전체_outlet || 0);
            frsStock = (invData.FRS_core || 0) + (invData.FRS_outlet || 0);
            frsSales = (slsData.FRS_core || 0) + (slsData.FRS_outlet || 0);
            break;
        }

        // 실선: 합계 기준
        const weeksTotal = calculateWeeks(totalStock, totalSales, days);
        dataPoint[`${ITEM_LABELS[itemTab]}_합계`] = weeksTotal !== null ? parseFloat(weeksTotal.toFixed(1)) : null;

        // 점선: 대리상 기준
        const weeksFRS = calculateWeeks(frsStock, frsSales, days);
        dataPoint[`${ITEM_LABELS[itemTab]}_대리상`] = weeksFRS !== null ? parseFloat(weeksFRS.toFixed(1)) : null;
      });

      return dataPoint;
    });
  }, [showAllItems, allInventoryData, allSalesData, daysInMonth, productTypeTab]);

  const colors = ITEM_COLORS[selectedTab];
  const itemLabel = ITEM_LABELS[selectedTab];

  const channelLabel = CHANNEL_LABELS[channelTab];

  // 모두선택 모드일 때 렌더링
  if (showAllItems && allInventoryData && allSalesData) {
    return (
      <div className="card mb-4">
        {/* 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <span className="text-purple-500">📈</span>
              2025년 월별 재고주수 추이 (전체 아이템 비교)
            </h2>
            {/* 상품 타입 탭 추가 */}
            <div className="flex gap-2">
              <button
                onClick={() => setProductTypeTab("전체")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  productTypeTab === "전체"
                    ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                상품전체
              </button>
              <button
                onClick={() => setProductTypeTab("주력")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  productTypeTab === "주력"
                    ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                주력상품
              </button>
              <button
                onClick={() => setProductTypeTab("아울렛")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  productTypeTab === "아울렛"
                    ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                아울렛상품
              </button>
            </div>
          </div>
        </div>

        {/* 차트 */}
        <div className="w-full h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={allItemsChartData}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 12, fill: "#6b7280" }}
                axisLine={{ stroke: "#d1d5db" }}
              />
              <YAxis 
                tick={{ fontSize: 12, fill: "#6b7280" }}
                axisLine={{ stroke: "#d1d5db" }}
                tickFormatter={(value) => `${value}주`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "white", 
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "12px"
                }}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    // 합계를 먼저, 대리상을 나중에 표시
                    const sortedPayload = [...payload].sort((a, b) => {
                      const aKey = String(a.dataKey || "");
                      const bKey = String(b.dataKey || "");
                      if (aKey.includes("합계")) return -1;
                      if (bKey.includes("합계")) return 1;
                      return 0;
                    });
                    
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                        <p className="font-medium mb-1">{label}</p>
                        {sortedPayload.map((entry, index) => {
                          const dataKey = String(entry.dataKey || "");
                          const label = dataKey.includes("합계") ? "합계" : dataKey.includes("대리상") ? "대리상" : dataKey;
                          return (
                            <p key={index} style={{ color: entry.color }}>
                              {label}: {entry.value !== null ? `${entry.value}주` : "-"}
                            </p>
                          );
                        })}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend 
                wrapperStyle={{ fontSize: "12px" }}
              />
              {ITEM_TABS.flatMap((itemTab) => [
                <Line
                  key={`${itemTab}_total`}
                  type="monotone"
                  dataKey={`${ITEM_LABELS[itemTab]}_합계`}
                  name={`${ITEM_LABELS[itemTab]} 합계`}
                  stroke={ITEM_COLORS[itemTab].core}
                  strokeWidth={3}
                  dot={{ fill: ITEM_COLORS[itemTab].core, strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                  connectNulls
                />,
                <Line
                  key={`${itemTab}_frs`}
                  type="monotone"
                  dataKey={`${ITEM_LABELS[itemTab]}_대리상`}
                  name={`${ITEM_LABELS[itemTab]} 대리상`}
                  stroke={ITEM_COLORS[itemTab].outlet}
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  dot={{ fill: ITEM_COLORS[itemTab].outlet, strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                  connectNulls
                />
              ])}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 범례 설명 */}
        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
            <span className="font-medium">라인 스타일:</span>
            <span>실선 = 합계 기준</span>
            <span>점선 = 대리상 기준</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 mt-2">
            <span className="font-medium">아이템별 색상:</span>
            {ITEM_TABS.map((itemTab) => (
              <div key={itemTab} className="flex items-center gap-1">
                <span className="w-4 h-2 rounded" style={{ backgroundColor: ITEM_COLORS[itemTab].core }}></span>
                <span>{ITEM_LABELS[itemTab]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 단일 아이템 모드 렌더링
  return (
    <div className="card mb-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-purple-500">📈</span>
            2025년 월별 재고주수 추이 ({itemLabel})
          </h2>
          {/* 상품 타입 탭 추가 */}
          <div className="flex gap-2">
            <button
              onClick={() => setProductTypeTab("전체")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                productTypeTab === "전체"
                  ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              상품전체
            </button>
            <button
              onClick={() => setProductTypeTab("주력")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                productTypeTab === "주력"
                  ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              주력상품
            </button>
            <button
              onClick={() => setProductTypeTab("아울렛")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                productTypeTab === "아울렛"
                  ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              아울렛상품
            </button>
          </div>
        </div>
      </div>

      {/* 차트 */}
      <div className="w-full h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={singleItemChartData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="month" 
              tick={{ fontSize: 12, fill: "#6b7280" }}
              axisLine={{ stroke: "#d1d5db" }}
            />
            <YAxis 
              tick={{ fontSize: 12, fill: "#6b7280" }}
              axisLine={{ stroke: "#d1d5db" }}
              tickFormatter={(value) => `${value}주`}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "white", 
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "12px"
              }}
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  // 합계를 먼저, 대리상을 나중에 표시
                  const sortedPayload = [...payload].sort((a, b) => {
                    const aKey = String(a.dataKey || "");
                    const bKey = String(b.dataKey || "");
                    if (aKey === "합계") return -1;
                    if (bKey === "합계") return 1;
                    return 0;
                  });
                  
                  // null인 항목은 필터링 (예상 구간에서 대리상이 null인 경우)
                  const validPayload = sortedPayload.filter(entry => entry.value !== null);
                  
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                      <p className="font-medium mb-1">{label}</p>
                      {validPayload.map((entry, index) => {
                        const dataKey = String(entry.dataKey || "");
                        const labelText = dataKey === "합계" ? "합계" : "대리상";
                        return (
                          <p key={index} style={{ color: entry.color }}>
                            {labelText}: {entry.value !== null ? `${entry.value}주` : "-"}
                          </p>
                        );
                      })}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend 
              wrapperStyle={{ fontSize: "12px" }}
            />
            <Line
              type="monotone"
              dataKey="합계"
              stroke={colors.core}
              strokeWidth={3}
              dot={{ fill: colors.core, strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="대리상"
              stroke={colors.outlet}
              strokeWidth={3}
              strokeDasharray="5 5"
              dot={{ fill: colors.outlet, strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 범례 설명 */}
      <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <span className="font-medium">라인 스타일:</span>
          <div className="flex items-center gap-1">
            <span className="w-6 h-0.5" style={{ backgroundColor: colors.core }}></span>
            <span>합계 기준 (실선)</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-6 h-0.5 border-dashed border-t-2" style={{ borderColor: colors.outlet }}></span>
            <span>대리상 기준 (점선)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
