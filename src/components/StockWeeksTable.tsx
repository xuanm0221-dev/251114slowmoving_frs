"use client";

import { InventoryItemTabData, SalesItemTabData, StockWeekWindow } from "@/types/sales";
import { cn } from "@/lib/utils";
import { getWindowMonths, getDaysInMonthFromYm, computeStockWeeksForRowType, ProductTypeTab } from "@/utils/stockWeeks";

interface StockWeeksTableProps {
  inventoryData: InventoryItemTabData;
  salesData: SalesItemTabData;
  daysInMonth: { [month: string]: number };
  stockWeek: number;
  year: "2024" | "2025" | "2026";
  stockWeekWindow: StockWeekWindow;
  productTypeTab: ProductTypeTab;
}

const MONTHS_2024 = [
  "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
  "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12"
];

const MONTHS_2025 = [
  "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
  "2025.07", "2025.08", "2025.09", "2025.10", "2025.11", "2025.12"
];

const MONTHS_2026 = [
  "2026.01", "2026.02", "2026.03", "2026.04", "2026.05", "2026.06",
  "2026.07", "2026.08", "2026.09", "2026.10", "2026.11", "2026.12"
];

const STOCK_WEEKS_ROWS = [
  { label: "전체주수", isHeader: true, indent: false, type: "total", hasHeatmap: false },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, type: "total_core", hasHeatmap: true },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, type: "total_outlet", hasHeatmap: true },
  { label: "대리상주수", isHeader: true, indent: false, type: "frs", hasHeatmap: false },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, type: "frs_core", hasHeatmap: true },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, type: "frs_outlet", hasHeatmap: true },
  { label: "직영주력상품", isHeader: true, indent: false, type: "retail_core", hasHeatmap: false },
  { label: "창고주수", isHeader: true, indent: false, type: "warehouse", hasHeatmap: false },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, type: "warehouse_core", hasHeatmap: false },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, type: "warehouse_outlet", hasHeatmap: false },
];

// 히트맵 색상 결정 함수 (인라인 스타일 - Tailwind purge 방지)
function getHeatmapStyle(weeks: number): React.CSSProperties {
  if (weeks < 35) {
    return { backgroundColor: '#dcfce7' }; // green-100
  } else if (weeks >= 35 && weeks <= 40) {
    return { backgroundColor: '#fef9c3' }; // yellow-100
  } else if (weeks >= 41 && weeks <= 45) {
    return { backgroundColor: '#ffedd5' }; // orange-100
  } else if (weeks >= 46 && weeks <= 52) {
    return { backgroundColor: '#fee2e2' }; // red-100
  } else {
    return { backgroundColor: '#fecaca' }; // red-200 (53주 이상)
  }
}


export default function StockWeeksTable({ 
  inventoryData, 
  salesData, 
  daysInMonth, 
  stockWeek,
  year,
  stockWeekWindow,
  productTypeTab,
}: StockWeeksTableProps) {
  // 연도별 고정 월 배열 사용
  const months = year === "2024" 
    ? MONTHS_2024 
    : year === "2025"
    ? MONTHS_2025
    : MONTHS_2026;
  
  // 선택된 행인지 확인하는 함수
  const isRowSelected = (rowType: string): boolean => {
    if (productTypeTab === "전체") {
      // 전체 선택 시: "전체주수", "대리상주수" 헤더 행 표시
      return rowType === "total" || rowType === "frs";
    } else if (productTypeTab === "주력") {
      // 주력상품 선택 시 (직영주력상품 포함)
      return rowType === "total_core" || rowType === "frs_core" || rowType === "retail_core";
    } else if (productTypeTab === "아울렛") {
      // 아울렛상품 선택 시
      return rowType === "total_outlet" || rowType === "frs_outlet";
    }
    return false;
  };
  
  // 주수 포맷팅 함수 (히트맵 표시용)
  const formatWeeks = (weeks: number | null): { display: string; value: number } => {
    if (weeks === null) {
      return { display: "판매0", value: -1 };
    }
    // 마이너스 값은 △ 기호로 표시
    if (weeks < 0) {
      return { display: `△${Math.abs(weeks).toFixed(1)}주`, value: weeks };
    }
    return { display: `${weeks.toFixed(1)}주`, value: weeks };
  };

  const getCellData = (month: string, rowType: string): { display: string; value: number } => {
    const invData = inventoryData[month];
    const slsData = salesData[month];

    if (!invData || !slsData) {
      return { display: "-", value: -1 };
    }

    // 공통 함수로 계산
    const result = computeStockWeeksForRowType(
      month,
      rowType,
      invData,
      slsData,
      inventoryData,
      salesData,
      daysInMonth,
      stockWeekWindow,
      stockWeek
    );

    if (result === null) {
      // forecast 월에서 대리상/창고 관련 주수는 공백 표시
      if (slsData.isForecast && rowType !== "total" && rowType !== "total_core" && rowType !== "total_outlet") {
        return { display: "", value: -1 };
      }
      return { display: "-", value: -1 };
    }

    return formatWeeks(result.weeks);
  };

  const getMonthHeader = (month: string): string => {
    const [yearStr, monthStr] = month.split(".");
    // "25.01", "26.01" 형식으로 표시
    return `${yearStr.slice(-2)}.${monthStr}`;
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="sales-table min-w-max">
          <thead>
            <tr>
              <th className="text-left min-w-[120px] sticky left-0 bg-[#1B365D] text-white z-20">
                구분
              </th>
              {months.map((month) => (
                <th key={month} className="min-w-[70px] bg-[#1B365D] text-white">
                  {getMonthHeader(month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STOCK_WEEKS_ROWS.map((row, idx) => {
              const isSelected = isRowSelected(row.type);
              
              return (
                <tr 
                  key={idx}
                  className={cn(
                    isSelected && "ring-2 ring-blue-500 ring-offset-1"
                  )}
                >
                  <td
                    className={cn(
                      "text-left sticky left-0 z-10",
                      row.isHeader && "font-semibold text-gray-800",
                      !row.isHeader && "bg-white",
                      row.indent && "row-indent",
                      isSelected && "bg-blue-50"
                    )}
                    style={row.isHeader && !isSelected ? { backgroundColor: '#f3f4f6' } : undefined}
                  >
                    {row.label}
                  </td>
                  {months.map((month) => {
                    const cellData = getCellData(month, row.type);
                    const isNoData = cellData.display === "-";
                    const isZeroSales = cellData.display === "판매0";
                    const hasHeatmap = row.hasHeatmap && cellData.value >= 0;
                    
                    // 헤더 행은 연한 회색 배경, 히트맵이 있는 셀은 히트맵 색상
                    // 선택된 행이면 배경색 조정
                    let cellStyle: React.CSSProperties | undefined;
                    if (row.isHeader) {
                      cellStyle = isSelected ? { backgroundColor: '#dbeafe' } : { backgroundColor: '#f3f4f6' };
                    } else if (hasHeatmap) {
                      const heatmapStyle = getHeatmapStyle(cellData.value);
                      cellStyle = isSelected 
                        ? { ...heatmapStyle, border: '2px solid #3b82f6' }
                        : heatmapStyle;
                    } else if (isSelected) {
                      cellStyle = { backgroundColor: '#dbeafe' };
                    }
                    
                    return (
                      <td
                        key={month}
                        className={cn(
                          "text-center",
                          row.isHeader && "font-semibold text-gray-800",
                          isNoData && "text-gray-400",
                          isZeroSales && "text-amber-600 text-xs"
                        )}
                        style={cellStyle}
                      >
                        {cellData.display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 히트맵 범례 */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="font-medium">재고주수:</span>
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 bg-green-100 border border-gray-300 rounded"></span>
          <span>~35주</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 bg-yellow-100 border border-gray-300 rounded"></span>
          <span>36-40주</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 bg-orange-100 border border-gray-300 rounded"></span>
          <span>41-45주</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 bg-red-100 border border-gray-300 rounded"></span>
          <span>46-52주</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 bg-red-200 border border-gray-300 rounded"></span>
          <span>53주~</span>
        </div>
      </div>
    </div>
  );
}
