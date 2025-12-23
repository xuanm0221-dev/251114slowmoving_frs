"use client";

import { useMemo } from "react";
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
import BilingualLabel from "./BilingualLabel";
import { 
  ItemTab, 
  ITEM_TABS,
  ChannelTab,
  InventoryBrandData,
  SalesBrandData,
  StockWeekWindow,
} from "@/types/sales";
import { StockWeeksChartPoint, computeStockWeeksForChart, ProductTypeTab, getWindowMonths, getDaysInMonthFromYm, calculateWeeks } from "@/utils/stockWeeks";

interface StockWeeksChartProps {
  selectedTab: ItemTab;
  // 히트맵에서 계산된 주수 데이터 (단일 아이템용)
  chartData: StockWeeksChartPoint[];
  // 모두선택 모드용
  showAllItems: boolean;
  allInventoryData?: InventoryBrandData;
  allSalesData?: SalesBrandData;
  daysInMonth: { [month: string]: number };
  stockWeekWindow: StockWeekWindow;
  channelTab: ChannelTab;
  productTypeTab: ProductTypeTab;
  setProductTypeTab: (tab: ProductTypeTab) => void;
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

// 2025년 히트맵에는 26.04까지의 재고주수를 함께 표시
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

export default function StockWeeksChart({
  selectedTab,
  chartData,
  showAllItems,
  allInventoryData,
  allSalesData,
  daysInMonth,
  stockWeekWindow,
  channelTab,
  productTypeTab,
  setProductTypeTab,
}: StockWeeksChartProps) {

  // 단일 아이템 차트 데이터: props로 받은 데이터 그대로 사용
  const singleItemChartData = useMemo(() => {
    return chartData;
  }, [chartData]);

  // 모든 아이템 차트 데이터 생성 (각 아이템별로 computeStockWeeksForChart 사용)
  const allItemsChartData = useMemo(() => {
    if (!showAllItems || !allInventoryData || !allSalesData) return [];

    // 각 아이템별로 주수 데이터 계산
    const itemChartDataMap: Record<ItemTab, StockWeeksChartPoint[]> = {} as Record<ItemTab, StockWeeksChartPoint[]>;
    
    ITEM_TABS.forEach((itemTab) => {
      const itemInventoryData = allInventoryData[itemTab];
      const itemSalesData = allSalesData[itemTab];
      
      if (itemInventoryData && itemSalesData) {
        itemChartDataMap[itemTab] = computeStockWeeksForChart(
          MONTHS_2025_WITH_FORECAST,
          itemInventoryData,
          itemSalesData,
          daysInMonth,
          stockWeekWindow,
          productTypeTab
        );
      }
    });

    // 월별로 데이터 포인트 생성
    return MONTHS_2025_WITH_FORECAST.map((month, index) => {
      // 월 레이블 생성: 25.01 형식, 예상 월은 (F) 추가
      const [yearStr, monthStr] = month.split(".");
      const yearShort = yearStr.slice(-2);
      const firstItemData = allSalesData[ITEM_TABS[0]]?.[month];
      const isForecast = firstItemData?.isForecast || false;
      const monthLabel = isForecast 
        ? `${yearShort}.${monthStr}(F)`
        : `${yearShort}.${monthStr}`;
      
      const dataPoint: Record<string, string | number | null> = {
        month: monthLabel,
      };

      ITEM_TABS.forEach((itemTab) => {
        const chartData = itemChartDataMap[itemTab];
        if (chartData && chartData[index]) {
          dataPoint[`${ITEM_LABELS[itemTab]}_합계`] = chartData[index].합계;
          dataPoint[`${ITEM_LABELS[itemTab]}_대리상`] = chartData[index].대리상;
        } else {
          dataPoint[`${ITEM_LABELS[itemTab]}_합계`] = null;
          dataPoint[`${ITEM_LABELS[itemTab]}_대리상`] = null;
        }
      });

      return dataPoint;
    });
  }, [showAllItems, allInventoryData, allSalesData, daysInMonth, productTypeTab, stockWeekWindow]);

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
              <BilingualLabel 
                primary="2025년 월별 재고주수 추이 (전체 아이템 비교)" 
                secondary="2025年 ACC weekcover" 
                align="left"
              />
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
                <BilingualLabel primary="상품전체" secondary="所有商品" align="center" />
              </button>
              <button
                onClick={() => setProductTypeTab("주력")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  productTypeTab === "주력"
                    ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <BilingualLabel primary="주력상품" secondary="主力商品" align="center" />
              </button>
              <button
                onClick={() => setProductTypeTab("아울렛")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  productTypeTab === "아울렛"
                    ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <BilingualLabel primary="아울렛상품" secondary="奥莱商品" align="center" />
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
            <BilingualLabel 
              primary={`2025년 월별 재고주수 추이 (${itemLabel})`}
              secondary="2025年 ACC weekcover" 
              align="left"
            />
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
              <BilingualLabel primary="상품전체" secondary="所有商品" align="center" />
            </button>
            <button
              onClick={() => setProductTypeTab("주력")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                productTypeTab === "주력"
                  ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <BilingualLabel primary="주력상품" secondary="主力商品" align="center" />
            </button>
            <button
              onClick={() => setProductTypeTab("아울렛")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                productTypeTab === "아울렛"
                  ? "bg-sky-100 text-sky-700 border-2 border-sky-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <BilingualLabel primary="아울렛상품" secondary="奥莱商品" align="center" />
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
                  
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                      <p className="font-medium mb-1">{label}</p>
                      {sortedPayload.map((entry, index) => {
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