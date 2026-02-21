"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  TooltipProps,
  LabelList,
  ReferenceLine,
} from "recharts";
import type { Brand } from "@/types/sales";
import { BRAND_CODE_MAP, DIMENSION_TABS } from "@/types/stagnantStock";
import type { DimensionTab } from "@/types/stagnantStock";

// 차트에서 사용할 단위 탭 목록 (컬러&사이즈만)
const CHART_DIMENSION_TABS: DimensionTab[] = ["컬러&사이즈"];
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";

// 아이템 필터 타입
type ItemFilterTab = "ACC합계" | "신발" | "모자" | "가방" | "기타";

interface InventorySeasonChartProps {
  brand: Brand;
  dimensionTab?: DimensionTab;
  onDimensionTabChange?: (tab: DimensionTab) => void;
  thresholdPct?: number;
  minQty?: number;  // 최소 수량 기준 (정체재고 판단용) - 전월말 기준
  currentMonthMinQty?: number;  // 당월수량 기준 (당월수량미달 판단용)
  itemTab?: ItemFilterTab;
  onItemTabChange?: (tab: ItemFilterTab) => void;
}

// 아이템 필터 탭 목록
const ITEM_FILTER_TABS: ItemFilterTab[] = ["ACC합계", "신발", "모자", "가방", "기타"];

// 시즌 그룹 타입
type SeasonGroup = "정체재고" | "당시즌" | "차기시즌" | "과시즌" | "당월수량미달";

// 월별 시즌 데이터
interface MonthSeasonData {
  month: string;
  정체재고: { stock_amt: number; sales_amt: number };
  과시즌: { stock_amt: number; sales_amt: number };
  당시즌: { stock_amt: number; sales_amt: number };
  차기시즌: { stock_amt: number; sales_amt: number };
  당월수량미달: { stock_amt: number; sales_amt: number };
  total_stock_amt: number;
  total_sales_amt: number;
}

// API 응답 타입
interface InventorySeasonChartResponse {
  year2024: MonthSeasonData[];
  year2025: MonthSeasonData[];
  meta: {
    brand: string;
    thresholdPct: number;
    currentYear: string;
    nextYear: string;
    currentMonthMinQty: number;
  };
}

// 탭 타입
type ChartMode = "전년대비" | "매출액대비";

// 색상 정의
const COLORS = {
  // 전년(2024년)
  prev: {
    정체재고: "#FF4081",  // 핫핑크
    과시즌: "#D1D5DB",    // 연그레이
    당시즌: "#7DD3FC",    // 하늘색
    차기시즌: "#C4B5FD",  // 연보라
    당월수량미달: "#FEF3C7",  // 연한 노랑
  },
  // 당년(2025년)
  curr: {
    정체재고: "#DC2626",  // 빨강
    과시즌: "#6B7280",    // 회색
    당시즌: "#2563EB",    // 파랑
    차기시즌: "#7C3AED",  // 보라
    당월수량미달: "#FDE68A",  // 노랑
  },
  // YOY 라인 (매출액 기준)
  yoy: "#FDA4AF",  // 파스텔 핑크
};

// 시즌 순서 (스택 순서: 아래부터 위로)
const SEASON_ORDER: SeasonGroup[] = ["당월수량미달", "과시즌", "당시즌", "차기시즌", "정체재고"];

// 숫자 포맷팅 함수
function formatNumber(num: number): string {
  return Math.round(num).toLocaleString("ko-KR");
}

function formatAmountM(num: number): string {
  const mValue = Math.round(num / 1_000_000);
  return mValue.toLocaleString("ko-KR") + "M";
}

function formatPercent(num: number): string {
  return (num * 100).toFixed(0) + "%";
}

// 재고주수 계산 (소수점 1자리)
function calcStockWeeks(stockAmt: number, salesAmt: number, daysInMonth: number = 30): string {
  if (salesAmt <= 0) return "-";
  const weekSales = (salesAmt / daysInMonth) * 7;
  if (weekSales <= 0) return "-";
  const weeks = stockAmt / weekSales;
  return weeks.toFixed(1) + "주";
}

// 월의 일수 계산
function getDaysInMonth(yyyymm: string): number {
  if (yyyymm.length !== 6) return 30;
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return new Date(year, month, 0).getDate();
}

// 커스텀 툴팁 - 전년대비 모드
interface YoYTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  data2024: MonthSeasonData[];
  data2025: MonthSeasonData[];
}

const YoYTooltip = ({ active, payload, label, data2024, data2025 }: YoYTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  const chartData = payload[0]?.payload;
  if (!chartData) return null;

  const monthIdx = chartData.monthIdx;
  const curr = data2025[monthIdx];
  const prev = data2024[monthIdx];

  if (!curr) return null;

  // 전년 데이터가 실제로 존재하는지 확인 (차트 데이터 생성 로직과 동일)
  const showPrevData = !!prev && (prev.total_stock_amt > 0 || prev.total_sales_amt > 0);

  const daysInMonth = getDaysInMonth(curr.month);
  const yoy = showPrevData && prev?.total_stock_amt > 0 
    ? ((curr.total_stock_amt / prev.total_stock_amt) * 100).toFixed(1) 
    : "-";

  // X축 레이블에서 연도 추출 (chartData.month 형식: "2025-12", "2026-01")
  const [yearStr, monthStr] = chartData.month.split("-");
  const yearShort = yearStr.slice(-2); // "2025" → "25", "2026" → "26"
  const displayMonthNum = parseInt(monthStr);

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-3 text-xs shadow-lg min-w-[280px]">
      <div className="font-bold text-gray-800 mb-2 border-b pb-2">
        {yearShort}년 {displayMonthNum}월
      </div>
      <div className="space-y-1 mb-3">
        <div className="flex justify-between">
          <span className="text-gray-600">당년 재고액:</span>
          <span className="font-medium">{formatNumber(curr.total_stock_amt / 1_000_000)}M</span>
        </div>
        {showPrevData && (
          <>
            <div className="flex justify-between">
              <span className="text-gray-600">전년 재고액:</span>
              <span className="font-medium">{formatNumber((prev?.total_stock_amt || 0) / 1_000_000)}M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">YOY:</span>
              <span className="font-medium text-pink-500">{yoy}%</span>
            </div>
          </>
        )}
      </div>
      <div className="border-t pt-2">
        <div className="font-medium text-gray-700 mb-2">시즌별 상세 (당년 재고 기준):</div>
        <table className="w-full">
          <thead>
            <tr className="text-gray-600 border-b">
              <th className="text-left py-1 pr-2"></th>
              <th className="text-right py-1 px-2">당년</th>
              {showPrevData && <th className="text-right py-1 px-2">전년</th>}
              {showPrevData && <th className="text-right py-1 pl-2">YOY</th>}
            </tr>
          </thead>
          <tbody>
            {(["정체재고", "차기시즌", "당시즌", "과시즌"] as SeasonGroup[]).map((season) => {
              const currSeasonData = curr[season];
              const prevSeasonData = prev?.[season];
              const currAmt = currSeasonData?.stock_amt || 0;
              const prevAmt = prevSeasonData?.stock_amt || 0;
              const seasonYoy = showPrevData && prevAmt > 0 ? ((currAmt / prevAmt) * 100).toFixed(1) : "-";
              
              return (
                <tr key={season}>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span 
                        className="w-2 h-2 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: COLORS.curr[season] }}
                      />
                      <span className="text-gray-600">{season}</span>
                    </div>
                  </td>
                  <td className="text-right py-1 px-2 font-medium">
                    {formatNumber(currAmt / 1_000_000)}M
                  </td>
                  {showPrevData && (
                    <td className="text-right py-1 px-2">
                      {formatNumber(prevAmt / 1_000_000)}M
                    </td>
                  )}
                  {showPrevData && (
                    <td className="text-right py-1 pl-2 text-pink-500">
                      {seasonYoy === "-" ? "-" : `${seasonYoy}%`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// 커스텀 툴팁 - 매출액대비 모드
interface SalesTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  data2024: MonthSeasonData[];
  data2025: MonthSeasonData[];
}

const SalesTooltip = ({ active, payload, label, data2024, data2025 }: SalesTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  const chartData = payload[0]?.payload;
  if (!chartData) return null;

  const monthIdx = chartData.monthIdx;
  const curr = data2025[monthIdx];

  if (!curr) return null;

  const daysInMonth = getDaysInMonth(curr.month);

  // 테이블 행 데이터 구성: 전체, 차기시즌, 당시즌, 과시즌, 정체재고, 당월수량미달
  const rows = [
    {
      name: "전체",
      color: "#374151", // gray-700
      sale: curr.total_sales_amt,
      stock: curr.total_stock_amt,
    },
    {
      name: "차기시즌",
      color: COLORS.curr.차기시즌,
      sale: curr.차기시즌.sales_amt,
      stock: curr.차기시즌.stock_amt,
    },
    {
      name: "당시즌",
      color: COLORS.curr.당시즌,
      sale: curr.당시즌.sales_amt,
      stock: curr.당시즌.stock_amt,
    },
    {
      name: "과시즌",
      color: COLORS.curr.과시즌,
      sale: curr.과시즌.sales_amt,
      stock: curr.과시즌.stock_amt,
    },
    {
      name: "정체재고",
      color: COLORS.curr.정체재고,
      sale: curr.정체재고.sales_amt,
      stock: curr.정체재고.stock_amt,
    },
    {
      name: "당월수량미달",
      color: COLORS.curr.당월수량미달,
      sale: curr.당월수량미달.sales_amt,
      stock: curr.당월수량미달.stock_amt,
    },
  ];

  // 포맷 함수
  const fmtM = (v: number) => `${formatNumber(Math.round(v / 1_000_000))}M`;
  const fmtWeeks = (stock: number, sale: number) => {
    if (sale <= 0) return "-";
    const weekSales = (sale / daysInMonth) * 7;
    if (weekSales <= 0) return "-";
    return `${(stock / weekSales).toFixed(1)}주`;
  };

  // X축 레이블에서 연도 추출 (chartData.month 형식: "2025-12", "2026-01")
  const [yearStr, monthStr] = chartData.month.split("-");
  const yearShort = yearStr.slice(-2); // "2025" → "25", "2026" → "26"
  const displayMonthNum = parseInt(monthStr);

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-3 text-xs shadow-lg">
      <div className="font-bold text-gray-800 mb-2 pb-2 border-b">
        {yearShort}년 {displayMonthNum}월
      </div>
      
      <table className="w-full">
        <thead>
          <tr className="text-gray-600 border-b">
            <th className="text-left py-1 pr-3"></th>
            <th className="text-right py-1 px-2">판매금액</th>
            <th className="text-right py-1 px-2">재고금액</th>
            <th className="text-right py-1 pl-2">재고주수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr 
              key={row.name} 
              className={idx === 0 ? "font-semibold border-b" : ""}
            >
              <td className="py-1 pr-3">
                <div className="flex items-center gap-1.5">
                  <span 
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: row.color }}
                  />
                  <span>{row.name}</span>
                </div>
              </td>
              <td className="text-right py-1 px-2">{fmtM(row.sale)}</td>
              <td className="text-right py-1 px-2">{fmtM(row.stock)}</td>
              <td className="text-right py-1 pl-2">{fmtWeeks(row.stock, row.sale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function InventorySeasonChart({ brand, dimensionTab = "컬러&사이즈", onDimensionTabChange, thresholdPct = 0.01, minQty = 10, currentMonthMinQty = 10, itemTab = "ACC합계", onItemTabChange }: InventorySeasonChartProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InventorySeasonChartResponse | null>(null);
  const [mode, setMode] = useState<ChartMode>("전년대비");

  // 전역 기준월 사용 (API가 기준월 포함 12개월 반환)
  const { referenceMonth } = useReferenceMonth();

  const brandCode = BRAND_CODE_MAP[brand] || "M";

  // 데이터 로드 (dimensionTab, thresholdPct, minQty, currentMonthMinQty, itemTab 변경 시 다시 로드)
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          brand: brandCode,
          thresholdPct: String(thresholdPct),
          minQty: String(minQty),
          currentMonthMinQty: String(currentMonthMinQty),
          dimensionTab: dimensionTab,
          itemFilter: itemTab,
          referenceMonth: referenceMonth,
        });
        const response = await fetch(`/api/inventory-season-chart?${params}`);
        if (!response.ok) {
          throw new Error("데이터를 불러오는데 실패했습니다.");
        }
        const result: InventorySeasonChartResponse = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [brandCode, dimensionTab, thresholdPct, minQty, currentMonthMinQty, itemTab, referenceMonth]);

  // 차트 데이터 생성 (API가 기준월 포함 12개월·전년 12개월 반환)
  const chartData = useMemo(() => {
    if (!data) return [];

    const months2025 = data.year2025;
    return months2025.map((curr, idx) => {
      const prev = data.year2024[idx];
      const monthLabel = curr.month.length === 6
        ? `${curr.month.slice(0, 4)}-${curr.month.slice(4, 6)}`
        : curr.month;
      const monthNum = parseInt(curr.month.slice(-2), 10);

      if (mode === "전년대비") {
        // 전년대비 모드: 왼쪽=전년 재고, 오른쪽=당년 재고
        // 전년 데이터는 동일 인덱스(동월)로 매칭
        const showPrevData = !!prev && (prev.total_stock_amt > 0 || prev.total_sales_amt > 0);
        
        return {
          month: monthLabel,
          monthIdx: idx,
          // 전년 재고 (왼쪽 막대) - 1~5월은 0
          prev_당월수량미달: showPrevData ? (prev?.당월수량미달?.stock_amt || 0) / 1_000_000 : 0,
          prev_과시즌: showPrevData ? (prev?.과시즌?.stock_amt || 0) / 1_000_000 : 0,
          prev_당시즌: showPrevData ? (prev?.당시즌?.stock_amt || 0) / 1_000_000 : 0,
          prev_차기시즌: showPrevData ? (prev?.차기시즌?.stock_amt || 0) / 1_000_000 : 0,
          prev_정체재고: showPrevData ? (prev?.정체재고?.stock_amt || 0) / 1_000_000 : 0,
          // 당년 재고 (오른쪽 막대)
          curr_당월수량미달: (curr.당월수량미달?.stock_amt || 0) / 1_000_000,
          curr_과시즌: (curr.과시즌?.stock_amt || 0) / 1_000_000,
          curr_당시즌: (curr.당시즌?.stock_amt || 0) / 1_000_000,
          curr_차기시즌: (curr.차기시즌?.stock_amt || 0) / 1_000_000,
          curr_정체재고: (curr.정체재고?.stock_amt || 0) / 1_000_000,
          // 비율 라벨용 데이터
          prev_total: showPrevData ? (prev?.total_stock_amt || 0) / 1_000_000 : 0,
          curr_total: curr.total_stock_amt / 1_000_000,
          // 전년 데이터 표시 여부 (툴팁용)
          showPrevData,
        };
      } else {
        // 매출액대비 모드: 왼쪽=당년 판매, 오른쪽=당년 재고
        // [매출액 기준 YOY 계산] (전년 매출 / 당년 매출) * 100
        const salesYoy = curr.total_sales_amt > 0 
          ? ((prev?.total_sales_amt || 0) / curr.total_sales_amt) * 100 
          : 0;

        // 매출 비중(%) 계산
        const salesTotal = curr.total_sales_amt || 0;
        const sales당월수량미달 = curr.당월수량미달?.sales_amt || 0;
        const sales과시즌 = curr.과시즌?.sales_amt || 0;
        const sales당시즌 = curr.당시즌?.sales_amt || 0;
        const sales차기시즌 = curr.차기시즌?.sales_amt || 0;
        const sales정체재고 = curr.정체재고?.sales_amt || 0;

        return {
          month: monthLabel,
          monthIdx: idx,
          // 당년 판매 (왼쪽 막대)
          sales_당월수량미달: sales당월수량미달 / 1_000_000,
          sales_과시즌: sales과시즌 / 1_000_000,
          sales_당시즌: sales당시즌 / 1_000_000,
          sales_차기시즌: sales차기시즌 / 1_000_000,
          sales_정체재고: sales정체재고 / 1_000_000,
          // 매출 비중(%) - 소수점 0자리 반올림
          sales_당월수량미달_ratio: salesTotal > 0 ? Math.round((sales당월수량미달 / salesTotal) * 100) : 0,
          sales_과시즌_ratio: salesTotal > 0 ? Math.round((sales과시즌 / salesTotal) * 100) : 0,
          sales_당시즌_ratio: salesTotal > 0 ? Math.round((sales당시즌 / salesTotal) * 100) : 0,
          sales_차기시즌_ratio: salesTotal > 0 ? Math.round((sales차기시즌 / salesTotal) * 100) : 0,
          sales_정체재고_ratio: salesTotal > 0 ? Math.round((sales정체재고 / salesTotal) * 100) : 0,
          // 당년 재고 (오른쪽 막대)
          curr_당월수량미달: (curr.당월수량미달?.stock_amt || 0) / 1_000_000,
          curr_과시즌: (curr.과시즌?.stock_amt || 0) / 1_000_000,
          curr_당시즌: (curr.당시즌?.stock_amt || 0) / 1_000_000,
          curr_차기시즌: (curr.차기시즌?.stock_amt || 0) / 1_000_000,
          curr_정체재고: (curr.정체재고?.stock_amt || 0) / 1_000_000,
          // [매출액 기준 YOY] 매출액대비 탭에서만 사용
          yoy: salesYoy,
          // 합계
          sales_total: salesTotal / 1_000_000,
          curr_total: curr.total_stock_amt / 1_000_000,
        };
      }
    });
  }, [data, mode]);

  // Y축 포맷 (숫자 + M)
  const formatYAxis = (value: number) => {
    return Math.round(value).toLocaleString() + "M";
  };

  // 커스텀 라벨 렌더러 (막대 위에 비율 표시 - 매출액대비 탭용)
  const renderCustomLabel = (props: any) => {
    const { x, y, width, value, dataKey, index } = props;
    if (!chartData[index]) return null;

    const item = chartData[index];
    let labelText = "";
    let labelY = y - 5;

    if (mode === "전년대비") {
      // 전년대비 탭에서는 막대 안에 표시하므로 여기서는 생략
      return null;
    } else {
      // 매출액대비 모드
      const salesTotal = item.sales_total ?? 0;
      const currTotal = item.curr_total ?? 0;
      if (dataKey === "sales_정체재고" && salesTotal > 0) {
        const ratio = ((item.sales_정체재고 || 0) / salesTotal * 100).toFixed(0);
        labelText = `${ratio}%`;
      } else if (dataKey === "curr_정체재고" && currTotal > 0) {
        const ratio = ((item.curr_정체재고 || 0) / currTotal * 100).toFixed(0);
        labelText = `${ratio}%`;
      }
    }

    if (!labelText) return null;

    return (
      <text 
        x={x + width / 2} 
        y={labelY} 
        fill={COLORS.curr.정체재고}
        fontSize={10}
        fontWeight="bold"
        textAnchor="middle"
      >
        {labelText}
      </text>
    );
  };

  // 막대 안에 비율 표시 생성 함수 (전년대비 탭 전용)
  const createBarLabelRenderer = (dataKeyName: string, totalKey: "prev_total" | "curr_total") => (props: any) => {
    const { x, y, width, height, index } = props;
    if (!chartData[index] || mode !== "전년대비") return null;
    
    // 막대 높이가 너무 작으면 표시 안함 (18px 미만)
    if (height < 18) return null;
    
    const item = chartData[index];
    const total = (item as any)[totalKey] ?? 0;
    if (total <= 0) return null;
    
    const value = (item as any)[dataKeyName] || 0;
    const ratio = (value / total * 100).toFixed(0);
    
    // 비율이 5% 미만이면 표시 안함
    if (parseInt(ratio) < 5) return null;
    
    return (
      <text 
        x={x + width / 2} 
        y={y + height / 2 + 4}
        fill="#ffffff"
        fontSize={10}
        fontWeight="bold"
        textAnchor="middle"
        style={{ textShadow: "0 0 2px rgba(0,0,0,0.5)" }}
      >
        {ratio}%
      </text>
    );
  };

  // 각 시즌별 렌더러 (prev)
  const renderPrev과시즌Label = useMemo(() => createBarLabelRenderer("prev_과시즌", "prev_total"), [chartData, mode]);
  const renderPrev당시즌Label = useMemo(() => createBarLabelRenderer("prev_당시즌", "prev_total"), [chartData, mode]);
  const renderPrev차기시즌Label = useMemo(() => createBarLabelRenderer("prev_차기시즌", "prev_total"), [chartData, mode]);
  const renderPrev정체재고Label = useMemo(() => createBarLabelRenderer("prev_정체재고", "prev_total"), [chartData, mode]);

  // 각 시즌별 렌더러 (curr)
  const renderCurr과시즌Label = useMemo(() => createBarLabelRenderer("curr_과시즌", "curr_total"), [chartData, mode]);
  const renderCurr당시즌Label = useMemo(() => createBarLabelRenderer("curr_당시즌", "curr_total"), [chartData, mode]);
  const renderCurr차기시즌Label = useMemo(() => createBarLabelRenderer("curr_차기시즌", "curr_total"), [chartData, mode]);

  // 매출 비중(%) 라벨 렌더러 (매출액대비 탭 전용)
  const createSalesLabelRenderer = (ratioKey: string) => (props: any) => {
    const { x, y, width, height, index } = props;
    if (!chartData[index] || mode !== "매출액대비") return null;
    
    // 막대 높이가 너무 작으면 표시 안함 (18px 미만)
    if (height < 18) return null;
    
    const item = chartData[index];
    const ratio = (item as any)[ratioKey] || 0;
    
    // 비율이 5% 미만이면 표시 안함
    if (ratio < 5) return null;
    
    return (
      <text 
        x={x + width / 2} 
        y={y + height / 2 + 4}
        fill="#ffffff"
        fontSize={10}
        fontWeight="bold"
        textAnchor="middle"
        style={{ textShadow: "0 0 2px rgba(0,0,0,0.5)" }}
      >
        {ratio}%
      </text>
    );
  };

  // 각 시즌별 매출 비중 라벨 렌더러
  const renderSales과시즌Label = useMemo(() => createSalesLabelRenderer("sales_과시즌_ratio"), [chartData, mode]);
  const renderSales당시즌Label = useMemo(() => createSalesLabelRenderer("sales_당시즌_ratio"), [chartData, mode]);
  const renderSales차기시즌Label = useMemo(() => createSalesLabelRenderer("sales_차기시즌_ratio"), [chartData, mode]);
  const renderSales정체재고Label = useMemo(() => createSalesLabelRenderer("sales_정체재고_ratio"), [chartData, mode]);
  const renderCurr정체재고Label = useMemo(() => createBarLabelRenderer("curr_정체재고", "curr_total"), [chartData, mode]);

  // 매출액대비 탭용 재고 비중 라벨 렌더러
  const createCurrLabelForSalesTab = (dataKeyName: string) => (props: any) => {
    const { x, y, width, height, index } = props;
    if (!chartData[index] || mode !== "매출액대비") return null;
    
    if (height < 18) return null;
    
    const item = chartData[index];
    const total = item.curr_total ?? 0;
    if (total <= 0) return null;
    
    const value = (item as any)[dataKeyName] || 0;
    const ratio = (value / total * 100).toFixed(0);
    
    if (parseInt(ratio) < 5) return null;
    
    return (
      <text 
        x={x + width / 2} 
        y={y + height / 2 + 4}
        fill="#ffffff"
        fontSize={10}
        fontWeight="bold"
        textAnchor="middle"
        style={{ textShadow: "0 0 2px rgba(0,0,0,0.5)" }}
      >
        {ratio}%
      </text>
    );
  };

  const renderCurr과시즌LabelForSales = useMemo(() => createCurrLabelForSalesTab("curr_과시즌"), [chartData, mode]);
  const renderCurr당시즌LabelForSales = useMemo(() => createCurrLabelForSalesTab("curr_당시즌"), [chartData, mode]);
  const renderCurr차기시즌LabelForSales = useMemo(() => createCurrLabelForSalesTab("curr_차기시즌"), [chartData, mode]);
  const renderCurr정체재고LabelForSales = useMemo(() => createCurrLabelForSalesTab("curr_정체재고"), [chartData, mode]);

  // Y축 동적 범위 계산 (브랜드별 데이터 스케일에 맞게 자동 조정)
  const { inventoryTicks, inventoryDomain, salesTicks, salesDomain } = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return {
        inventoryTicks: [0, 1000, 2000, 3000, 4000, 5000],
        inventoryDomain: [0, 5000] as [number, number],
        salesTicks: [0, 200, 400, 600, 800, 1000],
        salesDomain: [0, 1000] as [number, number],
      };
    }

    // 재고금액/매출금액 최대값 계산
    let maxInventory = 0;
    let maxSales = 0;
    
    chartData.forEach((item: any) => {
      if (mode === "전년대비") {
        // 전년대비: prev_total, curr_total 비교
        const prevTotal = item.prev_total || 0;
        const currTotal = item.curr_total || 0;
        maxInventory = Math.max(maxInventory, prevTotal, currTotal);
      } else {
        // 매출액대비: curr_total (재고), sales_total (매출)
        const currTotal = item.curr_total || 0;
        const salesTotal = item.sales_total || 0;
        maxInventory = Math.max(maxInventory, currTotal);
        maxSales = Math.max(maxSales, salesTotal);
      }
    });

    // 적절한 Y축 최대값 계산 (깔끔한 숫자로 올림, 상한은 막대 최대값의 1.2배 이내로 캡)
    const NICE_STEPS = [1, 2, 2.5, 5, 10];
    const calcNiceMax = (max: number): number => {
      if (max <= 0) return 1000;
      const target = max * 1.15;
      const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
      const normalized = target / magnitude;
      let niceNormalized: number;
      if (normalized <= 1) niceNormalized = 1;
      else if (normalized <= 2) niceNormalized = 2;
      else if (normalized <= 2.5) niceNormalized = 2.5;
      else if (normalized <= 5) niceNormalized = 5;
      else niceNormalized = 10;
      let niceMax = niceNormalized * magnitude;
      const cap = max * 1.2;
      if (niceMax > cap) {
        const idx = NICE_STEPS.indexOf(niceNormalized);
        const prevNice = NICE_STEPS[Math.max(0, idx - 1)];
        niceMax = prevNice * magnitude;
      }
      return niceMax;
    };

    // 균등 간격 ticks 생성
    const calcTicks = (maxVal: number, count: number = 5): number[] => {
      const niceMax = calcNiceMax(maxVal);
      const step = niceMax / count;
      const ticks = [];
      for (let i = 0; i <= count; i++) {
        ticks.push(Math.round(step * i));
      }
      return ticks;
    };

    const niceMaxInv = calcNiceMax(maxInventory);
    const niceMaxSales = calcNiceMax(maxSales);

    return {
      inventoryTicks: calcTicks(maxInventory),
      inventoryDomain: [0, niceMaxInv] as [number, number],
      salesTicks: calcTicks(maxSales),
      salesDomain: [0, niceMaxSales] as [number, number],
    };
  }, [chartData, mode]);

  if (loading) {
    return (
      <div className="card mb-4">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-600">데이터 로딩 중...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card mb-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="card mb-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        {/* 왼쪽: 제목 + 분석 단위 탭 */}
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-purple-500">📊</span>
            (상품단위)정상,정체 재고금액 추이
          </h2>
          
          {/* 분석 단위 탭 제거: 컬러&사이즈만 사용하므로 탭 표시 불필요 */}
          
          {/* 아이템 필터 탭 */}
          {onItemTabChange && (
            <div className="flex p-1 bg-gray-100 rounded-lg">
              {ITEM_FILTER_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => onItemTabChange(tab)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                    itemTab === tab
                      ? "bg-orange-500 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* 오른쪽: 모드 전환 탭 */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {(["전년대비", "매출액대비"] as ChartMode[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setMode(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                mode === tab
                  ? "bg-purple-500 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* 차트 */}
      <div className="w-full h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 30, right: 60, left: 20, bottom: 5 }}
            barCategoryGap="15%"
            barGap={2}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="month" 
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#d1d5db" }}
              tickFormatter={(value) => `${value.slice(2, 4)}.${value.slice(5)}`} // "2025-01" -> "25.01"
            />
            {/* 재고금액용 Y축 - 전년대비:왼쪽, 매출액대비:오른쪽 (동적 범위) */}
            <YAxis 
              yAxisId="inventory"
              orientation={mode === "전년대비" ? "left" : "right"}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#d1d5db" }}
              tickFormatter={formatYAxis}
              ticks={inventoryTicks}
              domain={inventoryDomain}
            />
            
            {/* 매출액대비 탭에서만 추가 Y축들 */}
            {mode === "매출액대비" && (
              <>
                {/* 매출금액용 Y축 (왼쪽) - 동적 범위 */}
                <YAxis 
                  yAxisId="sales"
                  orientation="left"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={{ stroke: "#d1d5db" }}
                  tickFormatter={formatYAxis}
                  ticks={salesTicks}
                  domain={salesDomain}
                />
                
                {/* YOY용 Y축 (숨김 처리 - 스케일만 유지) */}
                <YAxis 
                  yAxisId="yoy"
                  orientation="right"
                  hide={true}
                  domain={[0, 150]}
                />
                
                {/* YOY 100% 기준선 */}
                <ReferenceLine
                  yAxisId="yoy"
                  y={100}
                  stroke="#ff6699"
                  strokeDasharray="4 2"
                  strokeOpacity={0.4}
                />
              </>
            )}
            
            <Tooltip 
              content={
                mode === "전년대비" 
                  ? <YoYTooltip data2024={data.year2024} data2025={data.year2025} />
                  : <SalesTooltip data2024={data.year2024} data2025={data.year2025} />
              }
            />

            {mode === "전년대비" ? (
              <>
                {/* 전년 재고 막대 (왼쪽) - 막대 안에 비율 표시 */}
                <Bar yAxisId="inventory" dataKey="prev_당월수량미달" stackId="prev" fill={COLORS.prev.당월수량미달} name="24년 당월수량미달" />
                <Bar yAxisId="inventory" dataKey="prev_과시즌" stackId="prev" fill={COLORS.prev.과시즌} name="24년 과시즌">
                  <LabelList content={renderPrev과시즌Label} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="prev_당시즌" stackId="prev" fill={COLORS.prev.당시즌} name="24년 당시즌">
                  <LabelList content={renderPrev당시즌Label} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="prev_차기시즌" stackId="prev" fill={COLORS.prev.차기시즌} name="24년 차기시즌">
                  <LabelList content={renderPrev차기시즌Label} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="prev_정체재고" stackId="prev" fill={COLORS.prev.정체재고} name="24년 정체재고">
                  <LabelList content={renderPrev정체재고Label} />
                </Bar>
                
                {/* 당년 재고 막대 (오른쪽) - 막대 안에 비율 표시 */}
                <Bar yAxisId="inventory" dataKey="curr_당월수량미달" stackId="curr" fill={COLORS.curr.당월수량미달} name="25년 당월수량미달" />
                <Bar yAxisId="inventory" dataKey="curr_과시즌" stackId="curr" fill={COLORS.curr.과시즌} name="25년 과시즌">
                  <LabelList content={renderCurr과시즌Label} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="curr_당시즌" stackId="curr" fill={COLORS.curr.당시즌} name="25년 당시즌">
                  <LabelList content={renderCurr당시즌Label} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="curr_차기시즌" stackId="curr" fill={COLORS.curr.차기시즌} name="25년 차기시즌">
                  <LabelList content={renderCurr차기시즌Label} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="curr_정체재고" stackId="curr" fill={COLORS.curr.정체재고} name="25년 정체재고">
                  <LabelList content={renderCurr정체재고Label} />
                </Bar>
                {/* [전년대비 탭] YOY 라인 렌더링 안함 - 막대차트만 표시 */}
              </>
            ) : (
              <>
                {/* 당년 판매 막대 - yAxisId="sales" (왼쪽 Y축) - 막대 안에 비율 표시 */}
                <Bar yAxisId="sales" dataKey="sales_당월수량미달" stackId="sales" fill={COLORS.prev.당월수량미달} name="25년 판매 당월수량미달" />
                <Bar yAxisId="sales" dataKey="sales_과시즌" stackId="sales" fill={COLORS.prev.과시즌} name="25년 판매 과시즌">
                  <LabelList content={renderSales과시즌Label} />
                </Bar>
                <Bar yAxisId="sales" dataKey="sales_당시즌" stackId="sales" fill={COLORS.prev.당시즌} name="25년 판매 당시즌">
                  <LabelList content={renderSales당시즌Label} />
                </Bar>
                <Bar yAxisId="sales" dataKey="sales_차기시즌" stackId="sales" fill={COLORS.prev.차기시즌} name="25년 판매 차기시즌">
                  <LabelList content={renderSales차기시즌Label} />
                </Bar>
                <Bar yAxisId="sales" dataKey="sales_정체재고" stackId="sales" fill={COLORS.prev.정체재고} name="25년 판매 정체재고">
                  <LabelList content={renderSales정체재고Label} />
                </Bar>
                
                {/* 당년 재고 막대 - yAxisId="inventory" (오른쪽 Y축) - 막대 안에 비율 표시 */}
                <Bar yAxisId="inventory" dataKey="curr_당월수량미달" stackId="curr" fill={COLORS.curr.당월수량미달} name="25년 재고 당월수량미달" />
                <Bar yAxisId="inventory" dataKey="curr_과시즌" stackId="curr" fill={COLORS.curr.과시즌} name="25년 재고 과시즌">
                  <LabelList content={renderCurr과시즌LabelForSales} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="curr_당시즌" stackId="curr" fill={COLORS.curr.당시즌} name="25년 재고 당시즌">
                  <LabelList content={renderCurr당시즌LabelForSales} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="curr_차기시즌" stackId="curr" fill={COLORS.curr.차기시즌} name="25년 재고 차기시즌">
                  <LabelList content={renderCurr차기시즌LabelForSales} />
                </Bar>
                <Bar yAxisId="inventory" dataKey="curr_정체재고" stackId="curr" fill={COLORS.curr.정체재고} name="25년 재고 정체재고">
                  <LabelList content={renderCurr정체재고LabelForSales} />
                </Bar>

                {/* [매출액대비 탭] YOY 라인 - yAxisId="yoy" (숨겨진 Y축) */}
                <Line 
                  yAxisId="yoy"
                  type="monotone"
                  dataKey="yoy"
                  stroke={COLORS.yoy}
                  strokeWidth={2}
                  dot={{ fill: COLORS.yoy, r: 4 }}
                  name="매출액 YOY"
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 범례 */}
      <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-gray-600">
          {/* 왼쪽: 색상 범례 */}
          <div className="flex flex-wrap items-center gap-6">
            {mode === "전년대비" ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-medium">전년-24년:</span>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.prev.과시즌 }}></span>
                    <span>과시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.prev.당시즌 }}></span>
                    <span>당시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.prev.차기시즌 }}></span>
                    <span>차기시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.prev.정체재고 }}></span>
                    <span>정체재고</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">당년-25년:</span>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.과시즌 }}></span>
                    <span>과시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.당시즌 }}></span>
                    <span>당시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.차기시즌 }}></span>
                    <span>차기시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.정체재고 }}></span>
                    <span>정체재고</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-medium">당년-판매(매출):</span>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.과시즌 }}></span>
                    <span>과시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.당시즌 }}></span>
                    <span>당시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.차기시즌 }}></span>
                    <span>차기시즌</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.curr.정체재고 }}></span>
                    <span>정체재고</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">당년-재고:</span>
                  <span className="text-gray-500">(동일 색상)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-0.5" style={{ backgroundColor: COLORS.yoy }}></span>
                  <span>매출액 YOY</span>
                </div>
              </>
            )}
          </div>
          
          {/* 오른쪽: 정체재고 기준 설명 */}
          <div className="flex items-center gap-1.5 text-red-700 font-medium">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS.curr.정체재고 }}></span>
            <span>정체재고: 과시즌 중 (1) 전월말 수량 ≥ {minQty}개 AND (2) (당월판매 ÷ 중분류 기말재고) {"<"} {thresholdPct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
