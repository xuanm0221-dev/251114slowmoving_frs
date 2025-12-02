"use client";

import { ForecastInventoryData } from "@/types/sales";
import { formatAmountWon, formatMonth, cn } from "@/lib/utils";

interface ForecastInventoryTableProps {
  data: ForecastInventoryData;
  months: string[];
}

const ITEM_ROWS: { label: string; dataKey: string; isHeader: boolean }[] = [
  { label: "아이템합계", dataKey: "total", isHeader: true },
  { label: "ㄴ 슈즈", dataKey: "Shoes", isHeader: false },
  { label: "ㄴ 모자", dataKey: "Headwear", isHeader: false },
  { label: "ㄴ 가방", dataKey: "Bag", isHeader: false },
  { label: "ㄴ 기타", dataKey: "Acc_etc", isHeader: false },
];

export default function ForecastInventoryTable({
  data,
  months,
}: ForecastInventoryTableProps) {
  const getCellValue = (month: string, dataKey: string): number => {
    const monthData = data[month];
    if (!monthData) return 0;

    if (dataKey === "total") {
      return (
        (monthData.Shoes || 0) +
        (monthData.Headwear || 0) +
        (monthData.Bag || 0) +
        (monthData.Acc_etc || 0)
      );
    }

    const raw = monthData[dataKey as keyof typeof monthData];
    return typeof raw === "number" ? raw : 0;
  };

  if (!months || months.length === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-gray-500">입고예정 재고자산 데이터가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="sales-table min-w-max">
        <thead>
          <tr>
            <th className="text-left min-w-[140px] sticky left-0 bg-gray-100 z-20">
              구분
            </th>
            {months.map((month) => (
              <th key={month} className="min-w-[80px] bg-blue-50">
                <div className="flex items-center justify-center gap-1">
                  {formatMonth(month)}
                  <span className="text-xs text-blue-600" title="입고예정">
                    F
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ITEM_ROWS.map((row, idx) => (
            <tr key={idx}>
              <td
                className={cn(
                  "text-left sticky left-0 bg-white z-10",
                  row.isHeader && "row-header font-semibold text-gray-800",
                  !row.isHeader && "row-indent"
                )}
              >
                {row.label}
              </td>
              {months.map((month) => {
                const value = getCellValue(month, row.dataKey);
                return (
                  <td
                    key={month}
                    className={cn(
                      row.isHeader && "row-header font-semibold",
                      "text-gray-500 italic bg-blue-50/30"
                    )}
                    title="입고예정 재고자산"
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




