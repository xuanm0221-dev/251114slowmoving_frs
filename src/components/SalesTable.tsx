"use client";

import { SalesItemTabData, SalesMonthData, SALES_TABLE_ROWS } from "@/types/sales";
import { formatAmountWon, formatMonth, cn } from "@/lib/utils";

interface SalesTableProps {
  data: SalesItemTabData;
  months: string[];
}

export default function SalesTable({ data, months }: SalesTableProps) {
  const getCellValue = (month: string, dataKey: string): number => {
    const monthData: SalesMonthData | undefined = data[month];
    if (!monthData) return 0;

    if (dataKey === "전체") {
      // 예상 구간: 전체 필드가 있으면 그것을 사용 (주력/아울렛 구분 없음)
      if (monthData.전체 !== undefined) {
        return monthData.전체;
      }
      // 실적 구간: 전체_core + 전체_outlet
      return monthData.전체_core + monthData.전체_outlet;
    }
    if (dataKey === "FRS") {
      return monthData.FRS_core + monthData.FRS_outlet;
    }
    if (dataKey === "OR") {
      return monthData.OR_core + monthData.OR_outlet;
    }

    // 'isForecast'는 boolean 타입이므로, 여기서는 숫자 필드만 사용하도록 안전하게 처리
    const raw = monthData[dataKey as keyof SalesMonthData];
    return typeof raw === "number" ? raw : 0;
  };

  const isForecastMonth = (month: string): boolean => {
    // 26.01~26.12까지는 모두 forecast로 판단
    const [year, monthNum] = month.split(".").map(Number);
    if (year === 2026 && monthNum >= 1 && monthNum <= 12) {
      return true;
    }
    return data[month]?.isForecast === true;
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="sales-table min-w-max">
        <thead>
          <tr>
            <th className="text-left min-w-[140px] sticky left-0 bg-gray-100 z-20">
              구분
            </th>
            {months.map((month) => {
              const isForecast = isForecastMonth(month);
              return (
                <th
                  key={month}
                  className={cn(
                    "min-w-[80px]",
                    isForecast && "bg-blue-50"
                  )}
                  title={isForecast ? "예상 판매매출" : ""}
                >
                  <div className="flex items-center justify-center gap-1">
                    {formatMonth(month)}
                    {isForecast && (
                      <span className="text-xs text-blue-600" title="예상치">
                        F
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {SALES_TABLE_ROWS.map((row, idx) => (
            <tr key={idx}>
              <td
                className={cn(
                  "text-left sticky left-0 bg-white z-10",
                  row.isHeader && "row-header font-semibold text-gray-800",
                  row.indent && "row-indent"
                )}
              >
                {row.label}
              </td>
              {months.map((month) => {
                const value = getCellValue(month, row.dataKey);
                const isForecast = isForecastMonth(month);
                // JSON에 저장된 값은 이미 원 단위
                return (
                  <td
                    key={month}
                    className={cn(
                      row.isHeader && "row-header font-semibold",
                      isForecast && "text-gray-500 italic bg-blue-50/30"
                    )}
                    title={isForecast ? "예상 판매매출" : ""}
                  >
                    {formatAmountWon(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
