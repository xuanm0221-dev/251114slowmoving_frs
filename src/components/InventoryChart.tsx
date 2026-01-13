"use client";

import { useState, useMemo } from "react";
import {
  ComposedChart,
  Bar,
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
  ChannelTab,
  CHANNEL_TABS,
  InventoryBrandData,
  SalesBrandData,
  InventoryMonthData,
  SalesMonthData,
} from "@/types/sales";
import { cn, generateMonthsForYearAndNextHalf } from "@/lib/utils";
import { computeStockWeeksForRowType, StockWeekWindow } from "@/utils/stockWeeks";

interface InventoryChartProps {
  selectedTab: ItemTab;
  inventoryBrandData: InventoryBrandData;
  salesBrandData: SalesBrandData;
  channelTab: ChannelTab;
  setChannelTab: (tab: ChannelTab) => void;
  daysInMonth: { [month: string]: number };
  stockWeekWindow: StockWeekWindow;
  stockWeek: number;
  referenceMonth: string; // 기준월 추가
}

// 색상 정의 (주력: 진한 계열, 아울렛: 연한 계열)
const COLORS = {
  // 24년 (전년)
  prev_core: "#6B7280",    // 진한 회색
  prev_outlet: "#D1D5DB",  // 연한 회색
  // 25년 (당년)
  curr_core: "#2563EB",    // 진한 파랑
  curr_outlet: "#93C5FD",  // 연한 파랑
  // 예상 구간
  forecast_inventory: "#16A34A",  // 초록색 (재고자산 예상)
  forecast_sales: "#86EFAC",      // 연한 초록색 (판매매출 예상)
  // YOY 라인
  yoy: "#DC2626",          // 빨간색
};

// 아이템 라벨
const ITEM_LABELS: Record<ItemTab, string> = {
  전체: "전체",
  Shoes: "신발",
  Headwear: "모자",
  Bag: "가방",
  Acc_etc: "기타",
};

// 채널 라벨
const CHANNEL_LABELS: Record<ChannelTab, string> = {
  ALL: "전체",
  FRS: "대리상",
  창고: "창고",
};

// 연도 탭 타입
type YearTab = "당년" | "전년";

// 연도 탭 목록
const YEAR_TABS: YearTab[] = ["당년", "전년"];

// ✅ 선택된 탭의 재고/판매에서 실제 존재하는 월 목록을 뽑아서 연도에 따라 필터링
const getMonthsForChart = (
  inventoryBrandData: InventoryBrandData,
  salesBrandData: SalesBrandData,
  selectedTab: ItemTab,
  yearTab: YearTab,
  referenceMonth: string // 기준월 추가
): string[] => {
  const invItem = inventoryBrandData[selectedTab] || {};
  const salesItem = salesBrandData[selectedTab] || {};

  const monthSet = new Set<string>([
    ...Object.keys(invItem),
    ...Object.keys(salesItem),
  ]);

  // 연도에 따라 필터링
  let filteredMonths: string[];
  if (yearTab === "당년") {
    // 당년: 기준월이 속한 연도의 1월~12월 전체 + 다음 연도 1월~6월
    const [refYear, refMonth] = referenceMonth.split(".").map(Number);
    const allMonths: string[] = [];
    
    // 기준월이 속한 연도의 1월~12월 전체
    for (let month = 1; month <= 12; month++) {
      allMonths.push(`${refYear}.${String(month).padStart(2, "0")}`);
    }
    
    // 다음 연도 1월~6월
    const nextYear = refYear + 1;
    for (let month = 1; month <= 6; month++) {
      allMonths.push(`${nextYear}.${String(month).padStart(2, "0")}`);
    }
    
    // 실제 데이터가 있는 월만 포함 (forecast 월은 salesBrandData에 포함되어 있음)
    filteredMonths = allMonths.filter(m => monthSet.has(m));
  } else {
    // 전년: 2024.01 ~ 2024.12
    filteredMonths = Array.from(monthSet).filter(m => m >= "2024.01" && m <= "2024.12");
  }

  return filteredMonths.sort((a, b) => {
    const [ya, ma] = a.split(".").map(Number);
    const [yb, mb] = b.split(".").map(Number);
    if (ya !== yb) return ya - yb;
    return ma - mb;
  });
};

// 커스텀 Tooltip 컴포넌트
interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    name: string;
    payload: {
      month: string;
      isForecast?: boolean;
      yearLabel: string;  // "25년" 또는 "24년"
      "0_재고자산_주력": number;
      "0_재고자산_아울렛": number;
      "1_판매매출_주력": number;
      "1_판매매출_아울렛": number;
      "0_재고자산_전체"?: number;
      "1_판매매출_전체"?: number;
      "2_재고주수"?: number | null;
    };
  }>;
  inventoryBrandData?: InventoryBrandData;
  salesBrandData?: SalesBrandData;
  selectedTab?: ItemTab;
  daysInMonth?: { [month: string]: number };
  stockWeekWindow?: StockWeekWindow;
}

const CustomTooltip = ({ 
  active, 
  payload, 
  inventoryBrandData,
  salesBrandData,
  selectedTab,
  daysInMonth,
  stockWeekWindow
}: TooltipProps) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // 데이터 추출
  const data = payload[0]?.payload;
  if (!data) return null;

  const isForecast = data.isForecast || false;
  const yearLabel = data.yearLabel || "25년";

  // 포맷팅
  const formatValue = (value: number) => {
    const roundedValue = Math.round(value / 1_000_000);
    return roundedValue.toLocaleString() + "M";
  };

  // 재고주수 포맷팅
  const formatStockWeeks = (weeks: number | null | undefined) => {
    if (weeks === null || weeks === undefined) return "-";
    return Math.round(weeks).toLocaleString() + "주";
  };

  const stockWeeks = data["2_재고주수"];

  // 전년 동월 데이터 조회 (이미 계산된 데이터 활용)
  const getPrevYearValue = (dataType: "inventory" | "sales", field: "주력" | "아울렛") => {
    if (!inventoryBrandData || !salesBrandData || !selectedTab) return 0;
    
    const [yearStr, monthPart] = data.month.split(".");
    const month = monthPart.replace("(F)", "").trim(); // "01(F)" → "01"
    // 2자리 연도(25)를 4자리(2025)로 변환 후 전년 계산
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    const prevYear = year - 1;
    const prevMonth = `${prevYear}.${month}`;  // "2024.08" 형식
    
    if (dataType === "inventory") {
      const itemData = inventoryBrandData[selectedTab];
      const monthData = itemData?.[prevMonth];
      const fieldKey = field === "주력" ? "전체_core" : "전체_outlet";
      return monthData?.[fieldKey] || 0;
    } else {
      const itemData = salesBrandData[selectedTab];
      const monthData = itemData?.[prevMonth];
      const fieldKey = field === "주력" ? "전체_core" : "전체_outlet";
      return monthData?.[fieldKey] || 0;
    }
  };

  // 전년 재고주수 조회 (computeStockWeeksForRowType 재사용)
  const getPrevYearStockWeeks = () => {
    if (!inventoryBrandData || !salesBrandData || !selectedTab || !daysInMonth) return null;
    
    const [yearStr, monthPart] = data.month.split(".");
    const month = monthPart.replace("(F)", "").trim(); // "01(F)" → "01"
    // 2자리 연도(25)를 4자리(2025)로 변환 후 전년 계산
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    const prevYear = year - 1;
    const prevMonth = `${prevYear}.${month}`;  // "2024.08" 형식
    
    const invItem = inventoryBrandData[selectedTab];
    const salesItem = salesBrandData[selectedTab];
    const invData = invItem?.[prevMonth];
    const slsData = salesItem?.[prevMonth];
    
    if (!invData || !slsData) return null;
    
    const result = computeStockWeeksForRowType(
      prevMonth,
      "total", // rowType
      invData,
      slsData,
      invItem,
      salesItem,
      daysInMonth,
      stockWeekWindow || 1,
      0 // stockWeek
    );
    
    return result?.weeks || null;
  };

  // 전년 동월 전체 데이터 조회 (26년 예상 구간용)
  const getPrevYearTotalValue = (dataType: "inventory" | "sales"): number => {
    if (!inventoryBrandData || !salesBrandData || !selectedTab) {
      console.log("🚨 데이터 없음:", { inventoryBrandData, salesBrandData, selectedTab });
      return 0;
    }
    
    const [yearStr, monthPart] = data.month.split(".");
    const month = monthPart.replace("(F)", "").trim(); // "01(F)" → "01"
    // 2자리 연도(26)를 4자리(2026)로 변환 후 전년 계산
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    const prevYear = year - 1;
    const prevMonth = `${prevYear}.${month}`;  // "2025.01" 형식
    
    console.log("🔍 전년 전체 데이터 조회:", { 
      currentMonth: data.month, 
      yearStr,
      year,
      prevYear,
      prevMonth, 
      dataType,
      selectedTab 
    });
    
    if (dataType === "inventory") {
      const itemData = inventoryBrandData[selectedTab];
      const monthData = itemData?.[prevMonth];
      const core = monthData?.["전체_core"] || 0;
      const outlet = monthData?.["전체_outlet"] || 0;
      const total = core + outlet;
      
      console.log("📦 재고 전체 데이터:", { 
        prevMonth, 
        core,
        outlet,
        total,
        monthData,
        availableMonths: itemData ? Object.keys(itemData).filter(k => k.startsWith("2025")) : []
      });
      
      return total;
    } else {
      const itemData = salesBrandData[selectedTab];
      const monthData = itemData?.[prevMonth];
      const core = monthData?.["전체_core"] || 0;
      const outlet = monthData?.["전체_outlet"] || 0;
      const total = core + outlet;
      
      console.log("💰 판매 전체 데이터:", { 
        prevMonth, 
        core,
        outlet,
        total,
        monthData 
      });
      
      return total;
    }
  };

  // YOY 계산 (재고자산, 판매매출용)
  const calculateYoY = (currentValue: number, prevValue: number): string | null => {
    // 25.01~26.12 표시
    const [yearStr, monthPart] = data.month.split(".");
    const month = monthPart.replace("(F)", "").trim(); // "01(F)" → "01"
    // 2자리 연도(25)를 4자리(2025)로 변환
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    
    console.log("📊 YOY 계산:", { 
      month: data.month,
      yearStr,
      year,
      currentValue, 
      prevValue,
      isForecast: data.isForecast
    });
    
    if (year < 2025) {
      console.log("⏭️ 24년 이전 제외");
      return null;
    }
    if (year > 2026) {
      console.log("⏭️ 26년 이후 제외");
      return null;
    }
    
    if (prevValue === 0) {
      console.log("⚠️ prevValue가 0이므로 YOY 계산 불가");
      return null;
    }
    
    const yoy = Math.round((currentValue / prevValue) * 100);
    console.log("✅ YOY 계산 완료:", `${yoy}%`);
    return `${yoy}%`;
  };

  // 재고주수 차이 계산
  const calculateStockWeeksDiff = (currentWeeks: number | null | undefined, prevWeeks: number | null | undefined): string | null => {
    // 25.01~26.12 표시
    const [yearStr, monthPart] = data.month.split(".");
    const month = monthPart.replace("(F)", "").trim(); // "01(F)" → "01"
    // 2자리 연도(25)를 4자리(2025)로 변환
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    if (year < 2025) return null; // 24년 이전 제외
    if (year > 2026) return null; // 26년 이후 제외
    
    if (currentWeeks === null || currentWeeks === undefined || prevWeeks === null || prevWeeks === undefined) return null;
    const diff = Math.round(currentWeeks - prevWeeks);
    return diff >= 0 ? `+${diff}주` : `${diff}주`;
  };

  // 전년 데이터 조회
  const prevInventoryCore = getPrevYearValue("inventory", "주력");
  const prevInventoryOutlet = getPrevYearValue("inventory", "아울렛");
  const prevSalesCore = getPrevYearValue("sales", "주력");
  const prevSalesOutlet = getPrevYearValue("sales", "아울렛");
  const prevStockWeeks = getPrevYearStockWeeks();

  // 예상 구간: 전체만 표시
  if (isForecast) {
    const inventoryTotal = data["0_재고자산_전체"] || 0;
    const salesTotal = data["1_판매매출_전체"] || 0;

    // 전년 전체 데이터 및 YOY 계산
    const prevInventoryTotal = getPrevYearTotalValue("inventory");
    const prevSalesTotal = getPrevYearTotalValue("sales");
    // prevStockWeeks는 이미 285번 라인에서 계산됨
    
    const inventoryTotalYoY = calculateYoY(inventoryTotal, prevInventoryTotal);
    const salesTotalYoY = calculateYoY(salesTotal, prevSalesTotal);
    const stockWeeksDiff = calculateStockWeeksDiff(stockWeeks, prevStockWeeks);

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs shadow-lg">
        <div className="font-bold text-gray-800 mb-2">
          {data.month} (예상)
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded" 
              style={{ backgroundColor: COLORS.forecast_inventory }}
            ></div>
            <span>{yearLabel} 재고자산 전체: {formatValue(inventoryTotal)} {inventoryTotalYoY ? `(${inventoryTotalYoY})` : ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded" 
              style={{ backgroundColor: COLORS.forecast_sales }}
            ></div>
            <span>{yearLabel} 판매매출 전체: {formatValue(salesTotal)} {salesTotalYoY ? `(${salesTotalYoY})` : ''}</span>
          </div>
          <div className="flex items-center gap-2 border-t border-gray-200 pt-1.5 mt-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: "#DC2626" }}
            ></div>
            <span className="font-medium text-red-600">재고주수: {formatStockWeeks(stockWeeks)} {stockWeeksDiff ? `(${stockWeeksDiff})` : ''}</span>
          </div>
        </div>
      </div>
    );
  }

  // 실적 구간: 주력/아울렛 구분 표시
  const inventoryCore = data["0_재고자산_주력"] || 0;
  const inventoryOutlet = data["0_재고자산_아울렛"] || 0;
  const salesCore = data["1_판매매출_주력"] || 0;
  const salesOutlet = data["1_판매매출_아울렛"] || 0;

  // YOY 계산 (이미 위에서 전년 데이터 조회함)
  const inventoryOutletYoY = calculateYoY(inventoryOutlet, prevInventoryOutlet);
  const inventoryCoreYoY = calculateYoY(inventoryCore, prevInventoryCore);
  const salesOutletYoY = calculateYoY(salesOutlet, prevSalesOutlet);
  const salesCoreYoY = calculateYoY(salesCore, prevSalesCore);
  const stockWeeksDiff = calculateStockWeeksDiff(stockWeeks, prevStockWeeks);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs shadow-lg">
      <div className="font-bold text-gray-800 mb-2">
        {data.month}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded" 
            style={{ backgroundColor: COLORS.curr_outlet }}
          ></div>
          <span>{yearLabel} 재고자산 아울렛: {formatValue(inventoryOutlet)} {inventoryOutletYoY ? `(${inventoryOutletYoY})` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded" 
            style={{ backgroundColor: COLORS.curr_core }}
          ></div>
          <span>{yearLabel} 재고자산 주력: {formatValue(inventoryCore)} {inventoryCoreYoY ? `(${inventoryCoreYoY})` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded" 
            style={{ backgroundColor: COLORS.prev_outlet }}
          ></div>
          <span>{yearLabel} 판매매출 아울렛: {formatValue(salesOutlet)} {salesOutletYoY ? `(${salesOutletYoY})` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded" 
            style={{ backgroundColor: COLORS.prev_core }}
          ></div>
          <span>{yearLabel} 판매매출 주력: {formatValue(salesCore)} {salesCoreYoY ? `(${salesCoreYoY})` : ''}</span>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-200 pt-1.5 mt-1">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: "#DC2626" }}
          ></div>
          <span className="font-medium text-red-600">재고주수: {formatStockWeeks(stockWeeks)} {stockWeeksDiff ? `(${stockWeeksDiff})` : ''}</span>
        </div>
      </div>
    </div>
  );
};

export default function InventoryChart({
  selectedTab,
  inventoryBrandData,
  salesBrandData,
  channelTab,
  setChannelTab,
  daysInMonth,
  stockWeekWindow,
  stockWeek,
  referenceMonth,
}: InventoryChartProps) {
  // 연도 탭 상태 (당년/전년)
  const [yearTab, setYearTab] = useState<YearTab>("당년");

  const months = useMemo(
    () => getMonthsForChart(inventoryBrandData, salesBrandData, selectedTab, yearTab, referenceMonth),
    [inventoryBrandData, salesBrandData, selectedTab, yearTab, referenceMonth]
  );

  // 채널별 재고 데이터 가져오기
  const getChannelInventory = (
    invData: InventoryMonthData | undefined,
    slsData?: SalesMonthData
  ) => {
    if (!invData) return { core: 0, outlet: 0 };

    // ✅ forecast 월 처리
    if (slsData?.isForecast) {
      if (channelTab === "ALL") {
        // 전체 탭: 예상 구간에서는 전체 필드 사용 (주력/아울렛 구분 없음)
        const totalInventory = invData.전체 !== undefined 
          ? invData.전체 
          : (invData.전체_core || 0) + (invData.전체_outlet || 0);
        return {
          core: Math.round(totalInventory),
          outlet: 0,
        };
      }
      // 대리상/창고 탭: forecast 구간은 막대 없음
      return { core: 0, outlet: 0 };
    }

    // (실적 구간) 채널별 분기
    switch (channelTab) {
      case "FRS":
        return {
          core: Math.round(invData.FRS_core || 0),
          outlet: Math.round(invData.FRS_outlet || 0),
        };
      case "창고":
        // 창고 = 본사재고(HQ_OR)로 표시 (직영재고 제외 전)
        return {
          core: Math.round(invData.HQ_OR_core || 0),
          outlet: Math.round(invData.HQ_OR_outlet || 0),
        };
      case "ALL":
      default:
        return {
          core: Math.round(invData.전체_core || 0),
          outlet: Math.round(invData.전체_outlet || 0),
        };
    }
  };

  // 채널별 판매매출 데이터 가져오기
  const getChannelSales = (slsData: SalesMonthData | undefined) => {
    if (!slsData) return { core: 0, outlet: 0 };

    // ✅ forecast 월 처리
    if (slsData.isForecast) {
      if (channelTab === "ALL") {
        // 전체 탭: 예상 구간에서는 전체 필드 사용 (주력/아울렛 구분 없음)
        const totalSales = slsData.전체 !== undefined 
          ? slsData.전체 
          : (slsData.전체_core || 0) + (slsData.전체_outlet || 0);
        // 예상 구간에서는 주력/아울렛 구분 없으므로 전체를 core에 표시
        return {
          core: Math.round(totalSales),
          outlet: 0,
        };
      }
      // 대리상/창고 탭: forecast 구간은 막대 없음
      return { core: 0, outlet: 0 };
    }

    // (실적 구간) 채널별 분기
    switch (channelTab) {
      case "FRS":
        return {
          core: Math.round(slsData.FRS_core || 0),
          outlet: Math.round(slsData.FRS_outlet || 0),
        };
      case "창고":
        // 창고는 전체 판매로 표시
        return {
          core: Math.round(slsData.전체_core || 0),
          outlet: Math.round(slsData.전체_outlet || 0),
        };
      case "ALL":
      default:
        return {
          core: Math.round(slsData.전체_core || 0),
          outlet: Math.round(slsData.전체_outlet || 0),
        };
    }
  };
  // 채널탭에 따른 재고주수 rowType 매핑
  const getStockWeeksRowType = (): string => {
    switch (channelTab) {
      case "ALL": return "total";
      case "FRS": return "frs";
      case "창고": return "warehouse";
      default: return "total";
    }
  };

  // 차트 데이터 생성 (전년 막대 = 판매매출, 당년 막대 = 재고자산 + forecast)
  const chartData = useMemo(() => {
    // 연도 라벨 (툴팁용)
    const yearLabel = yearTab === "당년" ? "25년" : "24년";
    const rowType = getStockWeeksRowType();

    return months.map((monthYm) => {
      const invData = inventoryBrandData[selectedTab]?.[monthYm];
      const slsData = salesBrandData[selectedTab]?.[monthYm];
      const isForecast = slsData?.isForecast || false;

      // "전년" 역할: 해당 월의 판매매출 (채널별)
      const prev = getChannelSales(slsData);
      // "당년" 역할: 해당 월의 재고자산 (채널별, forecast 포함)
      const curr = getChannelInventory(invData, slsData);

      // 재고주수 계산 (히트맵과 동일한 로직 사용)
      let stockWeeks: number | null = null;
      if (invData && slsData) {
        const stockWeeksResult = computeStockWeeksForRowType(
          monthYm,
          rowType,
          invData,
          slsData,
          inventoryBrandData[selectedTab] || {},
          salesBrandData[selectedTab] || {},
          daysInMonth,
          stockWeekWindow,
          stockWeek
        );
        stockWeeks = stockWeeksResult?.weeks ?? null;
      }

      // 월 레이블을 "25.01", "26.01" 형식으로 변환, 예상 월은 (F) 추가
      const [yearStr, monthStr] = monthYm.split(".");
      const yearShort = yearStr.slice(-2); // "2025" -> "25"
      const monthLabel = isForecast 
        ? `${yearShort}.${monthStr}(F)`
        : `${yearShort}.${monthStr}`;

      // 예상 구간: 전체만 표시 (주력/아울렛 구분 없음)
      if (isForecast && channelTab === "ALL") {
        return {
          month: monthLabel,
          isForecast: true,
          yearLabel,
          "0_재고자산_전체": curr.core,  // 전체 재고자산
          "0_재고자산_주력": 0,
          "0_재고자산_아울렛": 0,
          "1_판매매출_전체": prev.core,  // 전체 판매매출
          "1_판매매출_주력": 0,
          "1_판매매출_아울렛": 0,
          "2_재고주수": stockWeeks,
        };
      }

      // 실적 구간: 주력/아울렛 구분 표시
      return {
        month: monthLabel,
        isForecast: false,
        yearLabel,
        "0_재고자산_주력": curr.core,      // 재고자산 주력
        "0_재고자산_아울렛": curr.outlet,  // 재고자산 아울렛
        "1_판매매출_주력": prev.core,      // 판매매출 주력
        "1_판매매출_아울렛": prev.outlet,  // 판매매출 아울렛
        "2_재고주수": stockWeeks,
      };
    });
  }, [months, inventoryBrandData, salesBrandData, selectedTab, channelTab, yearTab, daysInMonth, stockWeekWindow, stockWeek]);

  // Y축 최대값 계산 (재고자산 + 판매매출 통합) - 2024년+2025년 모두 고려하여 동일한 Y축 범위 유지
  const maxYAxis = useMemo(() => {
    let maxInv = 0;
    let maxSales = 0;
    
    // 2024년 + 기준월이 속한 연도의 1월부터 기준월까지 + 다음 연도 1월~6월까지 모든 월 데이터에서 재고자산 최대값 계산
    const targetMonths = generateMonthsForYearAndNextHalf(referenceMonth);
    const allInvMonths = Object.keys(inventoryBrandData[selectedTab] || {}).filter(
      (m) => m >= "2024.01" && m <= "2024.12" || targetMonths.includes(m)
    );
    
    allInvMonths.forEach((monthYm) => {
      const invData = inventoryBrandData[selectedTab]?.[monthYm];
      const slsData = salesBrandData[selectedTab]?.[monthYm];
      if (invData) {
        const inventory = getChannelInventory(invData, slsData);
        const total = inventory.core + inventory.outlet;
        if (total > maxInv) maxInv = total;
      }
    });
    
    // 2024년 + 기준월이 속한 연도의 1월부터 기준월까지 + 다음 연도 1월~6월까지 모든 월 데이터에서 판매매출 최대값 계산
    const allSalesMonths = Object.keys(salesBrandData[selectedTab] || {}).filter(
      (m) => m >= "2024.01" && m <= "2024.12" || targetMonths.includes(m)
    );
    
    allSalesMonths.forEach((monthYm) => {
      const slsData = salesBrandData[selectedTab]?.[monthYm];
      if (slsData) {
        const sales = getChannelSales(slsData);
        const total = sales.core + sales.outlet;
        if (total > maxSales) maxSales = total;
      }
    });
    
    // 재고자산과 판매매출 중 최대값 사용
    const max = Math.max(maxInv, maxSales);
    return Math.max(Math.ceil(max * 1.1), 100);
  }, [inventoryBrandData, salesBrandData, selectedTab, channelTab]);

  // 재고주수 최대값 계산 (우측 Y축용)
  const maxStockWeeks = useMemo(() => {
    let max = 0;
    chartData.forEach((d) => {
      const weeks = d["2_재고주수"];
      if (weeks !== null && weeks !== undefined && weeks > max) {
        max = weeks;
      }
    });
    return Math.max(Math.ceil(max * 1.2), 10);
  }, [chartData]);

  const itemLabel = ITEM_LABELS[selectedTab];
  const channelLabel = CHANNEL_LABELS[channelTab];

  // Y축 포맷 (M 단위 숫자, 천단위 콤마, 소수점 없음)
  const formatYAxis = (value: number) => {
    return Math.round(value / 1_000_000).toLocaleString();
  };

  // 재고주수 Y축 포맷
  const formatStockWeeksYAxis = (value: number) => {
    return Math.round(value).toLocaleString() + "주";
  };

  return (
    <div className="card mb-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-green-500 text-xl">📊</span>
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-gray-800">
              월별 {channelLabel} 재고자산 추이 ({itemLabel}) - {yearTab === "당년" ? "2025년" : "2024년"}
            </h2>
            <span className="text-[10px] text-gray-400 leading-tight">库存趋势</span>
          </div>
        </div>
        
        {/* 채널 탭 (ALL, 대리상, 창고) - 제목 바로 옆 */}
        <div className="flex flex-wrap items-center gap-2">
          {CHANNEL_TABS.map((tab) => {
            const chineseLabels = { ALL: "Total", FRS: "FR", 창고: "仓库" };
            return (
              <button
                key={tab}
                onClick={() => setChannelTab(tab)}
                className={cn(
                  "px-3 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex flex-col items-center gap-0.5",
                  channelTab === tab
                    ? "bg-gray-700 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                <span>{CHANNEL_LABELS[tab]}</span>
                <span className={cn(
                  "text-[10px] leading-tight",
                  channelTab === tab ? "text-gray-300" : "text-gray-400"
                )}>{chineseLabels[tab]}</span>
              </button>
            );
          })}
        </div>

        {/* 구분선 */}
        <div className="h-8 w-px bg-gray-300"></div>

        {/* 연도 탭 (당년/전년) */}
        <div className="flex flex-wrap items-center gap-2">
          {YEAR_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setYearTab(tab)}
              className={cn(
                "px-3 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex flex-col items-center gap-0.5",
                yearTab === tab
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <span>{tab}</span>
              <span className={cn(
                "text-[10px] leading-tight",
                yearTab === tab ? "text-indigo-200" : "text-gray-400"
              )}>{tab === "당년" ? "25年" : "24年"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 차트 */}
      <div className="w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="month" 
              tick={{ fontSize: 12, fill: "#6b7280" }}
              axisLine={{ stroke: "#d1d5db" }}
            />
            {/* 좌측 Y축: 재고자산 + 판매매출 통합 (M) */}
            <YAxis 
              yAxisId="left"
              tick={{ fontSize: 12, fill: "#6b7280" }}
              axisLine={{ stroke: "#d1d5db" }}
              tickFormatter={formatYAxis}
              domain={[0, maxYAxis]}
              label={{ 
                value: "금액 (M)", 
                angle: -90, 
                position: "insideLeft",
                style: { fontSize: 12, fill: "#6b7280" }
              }}
            />
            {/* 우측 Y축: 재고주수 */}
            <YAxis 
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12, fill: "#DC2626" }}
              axisLine={{ stroke: "#DC2626" }}
              tickFormatter={formatStockWeeksYAxis}
              domain={[0, maxStockWeeks]}
              label={{ 
                value: "재고주수", 
                angle: 90, 
                position: "insideRight",
                style: { fontSize: 12, fill: "#DC2626" }
              }}
            />
            <Tooltip 
              content={
                <CustomTooltip 
                  inventoryBrandData={inventoryBrandData}
                  salesBrandData={salesBrandData}
                  selectedTab={selectedTab}
                  daysInMonth={daysInMonth}
                  stockWeekWindow={stockWeekWindow}
                />
              }
            />
            {/* 예상 구간 막대 (25.12부터) - 전체만 표시, 같은 stackId 사용하여 폭 일관성 유지 */}
            {/* 예상 구간에서는 0_재고자산_전체만 값이 있고 주력/아울렛은 0이므로 같은 stackId 사용해도 전체 막대만 표시됨 */}
            <Bar 
              yAxisId="left"
              dataKey="0_재고자산_전체" 
              stackId="inventory"
              fill={COLORS.forecast_inventory}
              name="25년 재고자산 전체 (예상)"
            />
            <Bar 
              yAxisId="left"
              dataKey="1_판매매출_전체" 
              stackId="sales"
              fill={COLORS.forecast_sales}
              name="25년 판매매출 전체 (예상)"
            />
            {/* 실적 구간 막대 (주력 + 아울렛 스택) */}
            {/* 실적 구간에서는 0_재고자산_주력/아울렛만 값이 있고 전체는 0이므로 주력/아울렛 스택 막대만 표시됨 */}
            <Bar 
              yAxisId="left"
              dataKey="0_재고자산_주력" 
              stackId="inventory" 
              fill={COLORS.curr_core}
              name="25년 재고자산 주력"
            />
            <Bar 
              yAxisId="left"
              dataKey="0_재고자산_아울렛" 
              stackId="inventory" 
              fill={COLORS.curr_outlet}
              name="25년 재고자산 아울렛"
            />
            {/* 25년 판매매출 막대 (주력 + 아울렛 스택) - 좌측 Y축 사용 (통합) */}
            <Bar 
              yAxisId="left"
              dataKey="1_판매매출_주력" 
              stackId="sales" 
              fill={COLORS.prev_core}
              name="25년 판매매출 주력"
            />
            <Bar 
              yAxisId="left"
              dataKey="1_판매매출_아울렛" 
              stackId="sales" 
              fill={COLORS.prev_outlet}
              name="25년 판매매출 아울렛"
            />
            {/* 재고주수 꺾은선 그래프 - 우측 Y축 사용 */}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="2_재고주수"
              stroke="#DC2626"
              strokeWidth={2}
              dot={{ r: 4, fill: "#DC2626" }}
              activeDot={{ r: 6, fill: "#DC2626" }}
              name="재고주수"
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 범례 설명 */}
      <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex flex-wrap items-start gap-4 text-xs text-gray-600">
          <div className="flex items-start gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{yearTab === "당년" ? "25년" : "24년"} 재고자산</span>
              <span className="text-gray-400 text-[10px] leading-tight">{yearTab === "당년" ? "25年" : "24年"}库存</span>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {yearTab === "당년" && (
                  <div className="flex items-center gap-1">
                    <span className="w-4 h-3 rounded" style={{ backgroundColor: COLORS.forecast_inventory }}></span>
                    <span>전체</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="w-4 h-3 rounded" style={{ backgroundColor: COLORS.curr_core }}></span>
                  <span>주력</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-4 h-3 rounded" style={{ backgroundColor: COLORS.curr_outlet }}></span>
                  <span>아울렛</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-[10px]">
                {yearTab === "당년" && <span className="ml-5">预估</span>}
                <span className={yearTab === "당년" ? "ml-3" : ""}>主力</span>
                <span className="ml-3">奥莱</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{yearTab === "당년" ? "25년" : "24년"}판매매출</span>
              <span className="text-gray-400 text-[10px] leading-tight">{yearTab === "당년" ? "25年" : "24年"}零售</span>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {yearTab === "당년" && (
                  <div className="flex items-center gap-1">
                    <span className="w-4 h-3 rounded" style={{ backgroundColor: COLORS.forecast_sales }}></span>
                    <span>전체</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="w-4 h-3 rounded" style={{ backgroundColor: COLORS.prev_core }}></span>
                  <span>주력</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-4 h-3 rounded" style={{ backgroundColor: COLORS.prev_outlet }}></span>
                  <span>아울렛</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-[10px]">
                {yearTab === "당년" && <span className="ml-5">预估</span>}
                <span className={yearTab === "당년" ? "ml-3" : ""}>主力</span>
                <span className="ml-3">奥莱</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="flex flex-col">
              <span className="font-medium">재고주수</span>
              <span className="text-gray-400 text-[10px] leading-tight">weekcover</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

