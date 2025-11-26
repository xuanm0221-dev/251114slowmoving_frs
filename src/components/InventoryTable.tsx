"use client";

import { InventoryItemTabData, InventoryMonthData, INVENTORY_TABLE_ROWS } from "@/types/sales";
import { formatAmountM, formatMonth, cn } from "@/lib/utils";

interface InventoryTableProps {
  data: InventoryItemTabData;
  months: string[];
  daysInMonth: { [month: string]: number };
  stockWeek: number;
}

export default function InventoryTable({ data, months, daysInMonth, stockWeek }: InventoryTableProps) {
  const calculateRetailStock = (orSales: number, days: number): number => {
    if (days === 0) return 0;
    const stockAmount = (orSales / days) * 7 * stockWeek;
    return Math.round(stockAmount / 1_000_000);
  };

  const getCellValue = (month: string, dataKey: string): number => {
    const monthData: InventoryMonthData | undefined = data[month];
    if (!monthData) return 0;

    const days = daysInMonth[month] || 30;

    const retailStockCore = calculateRetailStock(monthData.OR_sales_core || 0, days);
    const retailStockOutlet = calculateRetailStock(monthData.OR_sales_outlet || 0, days);

    const warehouseStockCore = (monthData.HQ_OR_core || 0) - retailStockCore;
    const warehouseStockOutlet = (monthData.HQ_OR_outlet || 0) - retailStockOutlet;

    if (dataKey === "전체") {
      return (monthData.전체_core || 0) + (monthData.전체_outlet || 0);
    }
    if (dataKey === "FRS") {
      return (monthData.FRS_core || 0) + (monthData.FRS_outlet || 0);
    }
    if (dataKey === "HQ_OR") {
      return (monthData.HQ_OR_core || 0) + (monthData.HQ_OR_outlet || 0);
    }
    if (dataKey === "직영") {
      return retailStockCore + retailStockOutlet;
    }
    if (dataKey === "창고") {
      return warehouseStockCore + warehouseStockOutlet;
    }

    if (dataKey === "전체_core") return monthData.전체_core || 0;
    if (dataKey === "전체_outlet") return monthData.전체_outlet || 0;
    if (dataKey === "FRS_core") return monthData.FRS_core || 0;
    if (dataKey === "FRS_outlet") return monthData.FRS_outlet || 0;
    if (dataKey === "HQ_OR_core") return monthData.HQ_OR_core || 0;
    if (dataKey === "HQ_OR_outlet") return monthData.HQ_OR_outlet || 0;
    if (dataKey === "직영_core") return retailStockCore;
    if (dataKey === "직영_outlet") return retailStockOutlet;
    if (dataKey === "창고_core") return warehouseStockCore;
    if (dataKey === "창고_outlet") return warehouseStockOutlet;

    return 0;
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="sales-table min-w-max">
        <thead>
          <tr>
            <th className="text-left min-w-[140px] sticky left-0 bg-gray-100 z-20">
              구분
            </th>
            {months.map((month) => (
              <th key={month} className="min-w-[80px]">
                {formatMonth(month)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {INVENTORY_TABLE_ROWS.map((row, idx) => {
            // 직영재고, 창고재고는 연한 회색 배경
            const isGrayRow = row.dataKey === "직영" || row.dataKey === "창고";
            // 인라인 스타일로 배경색 적용 (globals.css 우선순위 문제 해결)
            const grayBgStyle = isGrayRow ? { backgroundColor: '#f3f4f6' } : undefined;
            
            return (
              <tr key={idx}>
                <td
                  className={cn(
                    "text-left sticky left-0 z-10",
                    row.isHeader && !isGrayRow && "row-header font-semibold text-gray-800",
                    row.isHeader && isGrayRow && "font-semibold text-gray-800",
                    !row.isHeader && "bg-white",
                    row.indent && "row-indent"
                  )}
                  style={grayBgStyle}
                >
                  {row.label}
                </td>
                {months.map((month) => {
                  const value = getCellValue(month, row.dataKey);
                  return (
                    <td
                      key={month}
                      className={cn(
                        row.isHeader && !isGrayRow && "row-header font-semibold",
                        row.isHeader && isGrayRow && "font-semibold"
                      )}
                      style={grayBgStyle}
                    >
                      {formatAmountM(value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
