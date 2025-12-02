"use client";

import { InventoryItemTabData, SalesItemTabData } from "@/types/sales";
import { cn } from "@/lib/utils";

interface StockWeeksTableProps {
  inventoryData: InventoryItemTabData;
  salesData: SalesItemTabData;
  daysInMonth: { [month: string]: number };
  stockWeek: number;
  year: "2024" | "2025";
}

const MONTHS_2024 = [
  "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
  "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12"
];

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

const STOCK_WEEKS_ROWS = [
  { label: "전체주수", isHeader: true, indent: false, type: "total", hasHeatmap: false },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, type: "total_core", hasHeatmap: true },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, type: "total_outlet", hasHeatmap: true },
  { label: "대리상주수", isHeader: true, indent: false, type: "frs", hasHeatmap: false },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, type: "frs_core", hasHeatmap: true },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, type: "frs_outlet", hasHeatmap: true },
  { label: "창고재고주수", isHeader: true, indent: false, type: "warehouse", hasHeatmap: false },
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

// daysInMonth에 값이 없는 월(26.01~26.04 등)은 캘린더 기준으로 일수 계산
function getDaysInMonthFromYm(month: string): number {
  const [yearStr, monthStr] = month.split(".");
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (!year || !m) return 30; // 안전한 기본값
  // JS Date: month는 1월=1 기준에서 마지막 날 구하기 위해 (year, m, 0)
  return new Date(year, m, 0).getDate();
}

export default function StockWeeksTable({ 
  inventoryData, 
  salesData, 
  daysInMonth, 
  stockWeek,
  year 
}: StockWeeksTableProps) {
  const months = year === "2024" ? MONTHS_2024 : MONTHS_2025_WITH_FORECAST;
  
  const calculateWeeks = (inventory: number, sales: number, days: number): { display: string; value: number } => {
    if (sales === 0) {
      return { display: "판매0", value: -1 };
    }
    const dailySales = sales / days;
    const weeklySales = dailySales * 7;
    if (weeklySales === 0) {
      return { display: "판매0", value: -1 };
    }
    const weeks = inventory / weeklySales;
    // 마이너스 값은 △ 기호로 표시
    if (weeks < 0) {
      return { display: `△${Math.abs(weeks).toFixed(1)}주`, value: weeks };
    }
    return { display: `${weeks.toFixed(1)}주`, value: weeks };
  };

  const calculateRetailStock = (orSales: number, days: number): number => {
    if (days === 0) return 0;
    return (orSales / days) * 7 * stockWeek;
  };

  const getCellData = (month: string, rowType: string): { display: string; value: number } => {
    const invData = inventoryData[month];
    const slsData = salesData[month];
    const days = daysInMonth[month] || getDaysInMonthFromYm(month);

    if (!invData || !slsData) {
      return { display: "-", value: -1 };
    }

    const totalStockCore = invData.전체_core || 0;
    const totalStockOutlet = invData.전체_outlet || 0;
    const frsStockCore = invData.FRS_core || 0;
    const frsStockOutlet = invData.FRS_outlet || 0;
    const hqOrStockCore = invData.HQ_OR_core || 0;
    const hqOrStockOutlet = invData.HQ_OR_outlet || 0;

    const orSalesCore = invData.OR_sales_core || 0;
    const orSalesOutlet = invData.OR_sales_outlet || 0;

    // forecast 월에서는 전체주수(전체/주력/아울렛)만 사용하고
    // 대리상/창고 관련 주수는 계산하지 않으므로 공백으로 표시
    const isForecast = slsData.isForecast;
    if (
      isForecast &&
      rowType !== "total" &&
      rowType !== "total_core" &&
      rowType !== "total_outlet"
    ) {
      return { display: "", value: -1 };
    }

    // 모든 데이터는 원 단위로 저장되어 있음
    const retailStockCore = calculateRetailStock(orSalesCore, days);
    const retailStockOutlet = calculateRetailStock(orSalesOutlet, days);

    const warehouseStockCore = hqOrStockCore - retailStockCore;
    const warehouseStockOutlet = hqOrStockOutlet - retailStockOutlet;

    const totalSalesCore = slsData.전체_core || 0;
    const totalSalesOutlet = slsData.전체_outlet || 0;
    const frsSalesCore = slsData.FRS_core || 0;
    const frsSalesOutlet = slsData.FRS_outlet || 0;

    switch (rowType) {
      case "total":
        return calculateWeeks(
          totalStockCore + totalStockOutlet,
          totalSalesCore + totalSalesOutlet,
          days
        );
      case "total_core":
        return calculateWeeks(totalStockCore, totalSalesCore, days);
      case "total_outlet":
        return calculateWeeks(totalStockOutlet, totalSalesOutlet, days);

      case "frs":
        return calculateWeeks(
          frsStockCore + frsStockOutlet,
          frsSalesCore + frsSalesOutlet,
          days
        );
      case "frs_core":
        return calculateWeeks(frsStockCore, frsSalesCore, days);
      case "frs_outlet":
        return calculateWeeks(frsStockOutlet, frsSalesOutlet, days);

      case "warehouse":
        // 창고재고주수(전체) = 창고재고(전체) ÷ [(주력상품 대리상판매 + 주력상품 직영판매 + 아울렛상품 직영판매) ÷ 일수 × 7]
        const warehouseSales = frsSalesCore + (slsData.OR_core || 0) + (slsData.OR_outlet || 0);
        return calculateWeeks(
          warehouseStockCore + warehouseStockOutlet,
          warehouseSales,
          days
        );
      case "warehouse_core":
        return calculateWeeks(warehouseStockCore, totalSalesCore, days);
      case "warehouse_outlet":
        // 창고재고(아울렛) ÷ (직영판매 아울렛 ÷ 일수 × 7)
        // 모든 데이터는 원 단위로 저장되어 있음
        return calculateWeeks(warehouseStockOutlet, orSalesOutlet, days);

      default:
        return { display: "-", value: -1 };
    }
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
            {STOCK_WEEKS_ROWS.map((row, idx) => (
              <tr key={idx}>
                <td
                  className={cn(
                    "text-left sticky left-0 z-10",
                    row.isHeader && "font-semibold text-gray-800",
                    !row.isHeader && "bg-white",
                    row.indent && "row-indent"
                  )}
                  style={row.isHeader ? { backgroundColor: '#f3f4f6' } : undefined}
                >
                  {row.label}
                </td>
                {months.map((month) => {
                  const cellData = getCellData(month, row.type);
                  const isNoData = cellData.display === "-";
                  const isZeroSales = cellData.display === "판매0";
                  const hasHeatmap = row.hasHeatmap && cellData.value >= 0;
                  
                  // 헤더 행은 연한 회색 배경, 히트맵이 있는 셀은 히트맵 색상
                  const cellStyle = row.isHeader 
                    ? { backgroundColor: '#f3f4f6' } 
                    : (hasHeatmap ? getHeatmapStyle(cellData.value) : undefined);
                  
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
            ))}
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
