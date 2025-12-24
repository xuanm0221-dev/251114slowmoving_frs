"use client";

import { useState, useMemo } from "react";
import { 
  Brand, 
  ItemTab, 
  ITEM_TABS,
  InventoryBrandData, 
  SalesBrandData,
  InventoryItemTabData,
  SalesItemTabData,
  StockWeeksByItem,
  StockWeekWindow,
} from "@/types/sales";
import { cn } from "@/lib/utils";
import { computeStockWeeksForRowType, getWindowMonths } from "@/utils/stockWeeks";
import { PRODUCT_TYPE_RULES } from "@/constants/businessRules";

interface StockWeeksSummaryProps {
  brand: Brand;
  inventoryBrandData: InventoryBrandData;
  salesBrandData: SalesBrandData;
  daysInMonth: { [month: string]: number };
  stockWeeks: StockWeeksByItem;
  onStockWeekChange: (itemTab: ItemTab, value: number) => void;
  stockWeekWindow: StockWeekWindow;
}

// 아이템 탭 라벨 및 아이콘
const ITEM_TAB_INFO: Record<ItemTab, { icon: string; label: string }> = {
  전체: { icon: "📊", label: "전체" },
  Shoes: { icon: "👟", label: "신발" },
  Headwear: { icon: "🧢", label: "모자" },
  Bag: { icon: "👜", label: "가방" },
  Acc_etc: { icon: "⭐", label: "기타" },
};

// 브랜드별 "전체" 박스 연한 배경색 (파스텔 버전)
const BRAND_LIGHT_COLORS: Record<Brand, string> = {
  "MLB": "#E0F2FE",        // 파스텔 하늘색 (sky-100)
  "MLB KIDS": "#FEF9E7",   // 파스텔 노란색
  "DISCOVERY": "#E0F7F4",  // 파스텔 틸 그린
};

// Summary 행 정의 (새 구조: 전체 → 주력/아울렛 → 대리상/본사물류/직영)
const SUMMARY_ROWS = [
  { label: "전체주수", level: 0, type: "total" },           // 헤더 level 0
  { label: "ㄴ 주력상품", level: 1, type: "total_core" },   // 헤더 level 1
  { label: "- 대리상", level: 2, type: "frs_core" },        // 상세 level 2
  { label: "- 창고", level: 2, type: "warehouse_core" },    // 상세 level 2
  { label: "- 직영", level: 2, type: "retail_core" },        // 상세 level 2 (새로 추가)
  { label: "ㄴ 아울렛상품", level: 1, type: "total_outlet" }, // 헤더 level 1
  { label: "- 대리상", level: 2, type: "frs_outlet" },      // 상세 level 2
  { label: "- 직영", level: 2, type: "warehouse_outlet" },  // 창고 아울렛 (직영에서만 소진)
];

// 2025년 월 옵션
const MONTHS_2025 = Array.from({ length: 12 }, (_, i) => ({
  value: `2025.${String(i + 1).padStart(2, "0")}`,
  label: `${i + 1}월`,
}));


export default function StockWeeksSummary({
  brand,
  inventoryBrandData,
  salesBrandData,
  daysInMonth,
  stockWeeks,
  onStockWeekChange,
  stockWeekWindow,
}: StockWeeksSummaryProps) {
  // 가장 최근 데이터가 있는 월 찾기
  const getLatestMonth = (): string => {
    const allData = inventoryBrandData["전체"];
    for (let i = 11; i >= 0; i--) {
      const month = `2025.${String(i + 1).padStart(2, "0")}`;
      if (allData[month]) {
        return month;
      }
    }
    return "2025.10"; // 기본값
  };

  const [selectedMonth, setSelectedMonth] = useState<string>(getLatestMonth());

  // 직영재고 계산 함수 (retail_core 행 타입용)
  const calculateRetailStock = (orSales: number, days: number, itemTab: ItemTab): number => {
    if (days === 0) return 0;
    return (orSales / days) * 7 * stockWeeks[itemTab];
  };

  // 특정 아이템, 월, 행 타입에 대한 데이터 계산
  const getRowData = (
    itemTab: ItemTab,
    month: string,
    rowType: string
  ): { weeks: number; inventory: number } => {
    const invData = inventoryBrandData[itemTab]?.[month];
    const slsData = salesBrandData[itemTab]?.[month];

    if (!invData || !slsData) {
      return { weeks: 0, inventory: 0 };
    }

    // retail_core는 공통 함수를 사용하지 않고 별도 처리
    if (rowType === "retail_core") {
      const days = daysInMonth[month] || 30;
      const orSalesCore = invData.OR_sales_core || 0;
      const retailStockCore = calculateRetailStock(orSalesCore, days, itemTab);
      return {
        weeks: stockWeeks[itemTab], // 직영 주수는 stockWeeks 값 그대로 사용
        inventory: retailStockCore,
      };
    }

    // 공통 함수로 계산 (히트맵과 동일한 로직)
    const result = computeStockWeeksForRowType(
      month,
      rowType,
      invData,
      slsData,
      inventoryBrandData[itemTab],
      salesBrandData[itemTab],
      daysInMonth,
      stockWeekWindow,
      stockWeeks[itemTab] // 직영재고 계산용
    );

    if (result === null) {
      return { weeks: 0, inventory: 0 };
    }

    return {
      weeks: result.weeks ?? 0,
      inventory: result.inventory,
    };
  };

  // YOY 증감 포맷팅
  const formatWeeksDiff = (diff: number): { text: string; color: string } => {
    if (diff === 0) return { text: "-", color: "text-gray-500" };
    if (diff > 0) {
      return { text: `+${diff.toFixed(1)}주`, color: "text-red-500" };
    }
    return { text: `△${Math.abs(diff).toFixed(1)}주`, color: "text-blue-500" };
  };

  const formatInventoryYOY = (current: number, previous: number): { text: string; color: string } => {
    if (previous === 0) return { text: "-", color: "text-gray-500" };
    const yoy = (current / previous) * 100;
    if (yoy === 100) return { text: "100%", color: "text-gray-500" };
    if (yoy > 100) {
      return { text: `${yoy.toFixed(0)}%`, color: "text-red-500" };
    }
    return { text: `${yoy.toFixed(0)}%`, color: "text-blue-500" };
  };

  // 재고금액 증감 포맷팅 (백만원 단위 + 퍼센트)
  const formatInventoryDiff = (diff: number, current: number, previous: number): { text: string; color: string } => {
    if (diff === 0) return { text: "-", color: "text-gray-500" };
    
    // 백만원 단위로 변환
    const diffInMillion = diff / 1000000;
    const diffFormatted = formatWithComma(Math.round(diffInMillion));
    
    // 퍼센트 계산
    let percentText = "";
    if (previous !== 0) {
      const percent = (current / previous) * 100;
      percentText = ` (${percent.toFixed(0)}%)`;
    }
    
    if (diff > 0) {
      return { text: `+${diffFormatted}${percentText}`, color: "text-red-500" };
    }
    return { text: `△${diffFormatted}${percentText}`, color: "text-blue-500" };
  };

  // 전년 동월 계산
  const getPreviousYearMonth = (month: string): string => {
    return month.replace("2025", "2024");
  };

  // 천단위 콤마 포맷
  const formatWithComma = (num: number): string => {
    return Math.round(num).toLocaleString();
  };

  // 현재 월에 적용된 remark 정보 계산 (당년 + 전년)
  const getRemarkInfo = (month: string): { current: string; previous: string } => {
    const calculateRemark = (yearMonth: string): string => {
      const [yearStr, monthStr] = yearMonth.split(".");
      const year = parseInt(yearStr);
      const monthNum = parseInt(monthStr);
      
      // 23.12 기준으로 remark 번호 계산
      const baseYear = 2023;
      const baseMonth = 12;
      
      const monthsSinceBase = (year - baseYear) * 12 + (monthNum - baseMonth);
      const remarkNum = Math.floor(monthsSinceBase / 3) + 1;
      
      // remark 기간 계산
      const startMonthsSinceBase = (remarkNum - 1) * 3;
      const startYear = baseYear + Math.floor((baseMonth + startMonthsSinceBase) / 12);
      const startMonth = ((baseMonth + startMonthsSinceBase - 1) % 12) + 1;
      
      const endMonthsSinceBase = remarkNum * 3 - 1;
      const endYear = baseYear + Math.floor((baseMonth + endMonthsSinceBase) / 12);
      const endMonth = ((baseMonth + endMonthsSinceBase - 1) % 12) + 1;
      
      const startYY = String(startYear).slice(2);
      const endYY = String(endYear).slice(2);
      
      return `remark${remarkNum}: ${startYY}.${String(startMonth).padStart(2, '0')}~${endYY}.${String(endMonth).padStart(2, '0')}`;
    };

    const current = calculateRemark(month);
    const prevMonth = getPreviousYearMonth(month);
    const previous = calculateRemark(prevMonth);

    return { current, previous };
  };

  // 현재 월 기준 주력/아울렛 시즌 예시 계산
  const getProductTypeExamples = (month: string): { core: string; outlet: string } => {
    const [yearStr] = month.split(".");
    const year = parseInt(yearStr);
    const yy = String(year).slice(2);
    const nextYy = String(year + 1).slice(2);
    
    // 주력: INTRO, FOCUS, 해당 연도 SS/FW, 다음 연도 SS/FW
    const coreExample = `INTRO, FOCUS, ${yy}SS, ${yy}FW, ${nextYy}SS, ${nextYy}FW 이상`;
    
    // 아울렛: OUTLET, CARE, DONE, 전년 FW 이하
    const prevYy = String(year - 1).slice(2);
    const outletExample = `OUTLET, CARE, DONE, ${prevYy}FW 이하`;
    
    return { core: coreExample, outlet: outletExample };
  };

  // 카드 렌더링
  const renderCard = (itemTab: ItemTab) => {
    const info = ITEM_TAB_INFO[itemTab];
    const prevMonth = getPreviousYearMonth(selectedMonth);
    
    // "전체" 박스는 브랜드별 연한 배경색 적용
    const isAllTab = itemTab === "전체";
    const cardBgColor = isAllTab ? BRAND_LIGHT_COLORS[brand] : "#ffffff";

    return (
      <div
        key={itemTab}
        className="border border-gray-200 rounded-xl shadow-sm overflow-hidden"
        style={{ backgroundColor: cardBgColor }}
      >
        {/* 카드 헤더 */}
        <div 
          className="px-3 py-2 border-b border-gray-200 flex items-center justify-between"
          style={{ backgroundColor: isAllTab ? 'rgba(0,0,0,0.05)' : '#f9fafb' }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-base">{info.icon}</span>
            <span className="font-semibold text-gray-800 text-sm">{info.label}</span>
          </div>
          
          {/* StockWeek 입력 (작은 버전) */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">직영판매예정재고:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const newValue = Math.max(0, stockWeeks[itemTab] - 1);
                  onStockWeekChange(itemTab, newValue);
                }}
                className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs transition-colors"
              >
                -
              </button>
              <input
                type="number"
                value={stockWeeks[itemTab]}
                onChange={(e) => {
                  const newValue = parseInt(e.target.value, 10);
                  if (!isNaN(newValue) && newValue >= 0 && newValue <= 52) {
                    onStockWeekChange(itemTab, newValue);
                  }
                }}
                min={0}
                max={52}
                className="w-12 h-6 text-center bg-white border border-gray-300 rounded text-xs text-gray-800 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  const newValue = Math.min(52, stockWeeks[itemTab] + 1);
                  onStockWeekChange(itemTab, newValue);
                }}
                className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs transition-colors"
              >
                +
              </button>
            </div>
            <span className="text-xs text-gray-500">주</span>
          </div>
        </div>

        {/* 테이블 */}
        <div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100 text-gray-600">
                <th className="px-1.5 py-1 text-left font-medium">구분</th>
                <th className="px-1.5 py-1 text-right font-medium">당년주수</th>
                <th className="px-1.5 py-1 text-right font-medium">전년비</th>
                <th className="px-1.5 py-1 text-right font-medium">당년재고</th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY_ROWS.map((row, idx) => {
                const currentData = getRowData(itemTab, selectedMonth, row.type);
                const prevData = getRowData(itemTab, prevMonth, row.type);
                
                const weeksDiff = currentData.weeks - prevData.weeks;
                const weeksDiffFormatted = formatWeeksDiff(weeksDiff);

                // level 0, 1은 헤더 스타일 (회색 배경 + 구분선)
                const isHeader = row.level === 0 || row.level === 1;
                // 들여쓰기: level 1 = pl-2, level 2 = pl-4
                const paddingClass = row.level === 0 ? "" : row.level === 1 ? "pl-2" : "pl-4";
                
                // 주력상품 아래 직영 행은 연한 회색 텍스트로 표시
                const isRetailCore = row.type === "retail_core";
                // 주력상품 아래 대리상, 본사물류는 검정 텍스트로 표시
                const isCoreDetail = row.type === "frs_core" || row.type === "warehouse_core";

                return (
                  <tr
                    key={idx}
                    className={cn(
                      isHeader && "border-b border-gray-300"
                    )}
                    style={isHeader ? { backgroundColor: '#f3f4f6' } : undefined}
                  >
                    <td
                      className={cn(
                        "px-1.5 py-1 text-left whitespace-nowrap",
                        isHeader ? "font-semibold text-gray-800" : 
                        isRetailCore ? "text-gray-400" : 
                        isCoreDetail ? "text-gray-800" : 
                        "text-gray-600",
                        paddingClass
                      )}
                    >
                      {row.label}
                    </td>
                    <td className={cn(
                      "px-1.5 py-1 text-right font-medium whitespace-nowrap",
                      isRetailCore ? "text-gray-400" : "text-gray-800"
                    )}>
                      {currentData.weeks === 0 ? "-" : `${currentData.weeks.toFixed(1)}주`}
                    </td>
                    <td className={cn(
                      "px-1.5 py-1 text-right font-medium whitespace-nowrap",
                      weeksDiffFormatted.color,
                      isRetailCore && "text-gray-400"
                    )}>
                      {weeksDiffFormatted.text}
                    </td>
                    <td className={cn(
                      "px-1.5 py-1 text-right whitespace-nowrap",
                      isRetailCore ? "text-gray-400" : "text-gray-500"
                    )}>
                      {currentData.inventory === 0 ? "-" : (() => {
                        const inventoryM = formatWithComma(currentData.inventory / 1000000);
                        
                        // "전체주수" 행에만 전년비 표시
                        if (row.type === "total" && prevData.inventory > 0) {
                          const yoyPercent = Math.round((currentData.inventory / prevData.inventory) * 100);
                          return `${inventoryM}(${yoyPercent}%)`;
                        }
                        
                        return inventoryM;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="card mb-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <span className="text-blue-500">📋</span>
          {brand} 아이템별 재고 SUMMARY
        </h2>
        
        {/* 월 선택 드롭다운 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">기준 월:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {MONTHS_2025.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {ITEM_TABS.map((tab) => renderCard(tab))}
      </div>

      {/* 범례 */}
      <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <div className="flex flex-col">
              <span className="font-medium">주력상품:</span>
              <span className="text-gray-400 text-[10px] leading-tight">主力商品</span>
            </div>
            <span>{getProductTypeExamples(selectedMonth).core}</span>
          </div>
          <div className="border-l border-gray-300 pl-4 ml-2 flex items-center gap-1">
            <div className="flex flex-col">
              <span className="font-medium">아울렛상품:</span>
              <span className="text-gray-400 text-[10px] leading-tight">奥莱商品</span>
            </div>
            <span>{getProductTypeExamples(selectedMonth).outlet}</span>
          </div>
          <div className="border-l border-gray-300 pl-4 ml-2 flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-indigo-600 font-medium">당년 적용: {getRemarkInfo(selectedMonth).current}</span>
              <span className="text-indigo-400 text-[10px] leading-tight">今年标准</span>
            </div>
            <span className="text-gray-400">|</span>
            <div className="flex flex-col">
              <span className="text-indigo-600 font-medium">전년 적용: {getRemarkInfo(selectedMonth).previous}</span>
              <span className="text-indigo-400 text-[10px] leading-tight">去年标准</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

