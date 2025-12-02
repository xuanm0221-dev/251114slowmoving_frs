"use client";

import { 
  InventoryItemTabData, 
  SalesItemTabData, 
  ForecastInventoryData,
  SalesMonthData,
  ItemTab 
} from "@/types/sales";
import { formatAmountM, formatMonth, cn } from "@/lib/utils";

interface InventoryStockSummaryTableProps {
  selectedTab: ItemTab;
  inventoryData: InventoryItemTabData;
  salesData: SalesItemTabData;
  forecastInventoryData?: ForecastInventoryData;
  months: string[];
}

export default function InventoryStockSummaryTable({
  selectedTab,
  inventoryData,
  salesData,
  forecastInventoryData,
  months,
}: InventoryStockSummaryTableProps) {
  // 재고자산(M) 계산: 전체재고 ÷ 1,000,000
  const getInventoryValue = (month: string): number => {
    const monthData = inventoryData[month];
    if (!monthData) return 0;
    const total = (monthData.전체_core || 0) + (monthData.전체_outlet || 0);
    return Math.round(total / 1_000_000);
  };

  // 판매매출(M) 계산: 전체판매 ÷ 1,000,000
  const getSalesValue = (month: string): number => {
    const monthData = salesData[month];
    if (!monthData) return 0;
    const total = (monthData.전체_core || 0) + (monthData.전체_outlet || 0);
    return Math.round(total / 1_000_000);
  };

  // 입고예정재고(M) 계산: 전체 또는 아이템별 금액 ÷ 1,000,000
  const getForecastInventoryValue = (month: string): number | null => {
    const monthData = forecastInventoryData?.[month];
    if (!monthData) return null;
    
    // selectedTab에 따라 아이템별 또는 전체 계산
    if (selectedTab === "전체") {
      // 전체: 모든 아이템 합계
      const total = 
        (monthData.Shoes || 0) +
        (monthData.Headwear || 0) +
        (monthData.Bag || 0) +
        (monthData.Acc_etc || 0);
      return Math.round(total / 1_000_000);
    } else {
      // 아이템별: 선택된 탭의 금액만
      const itemValue = monthData[selectedTab];
      if (itemValue === undefined) return null;
      return Math.round(itemValue / 1_000_000);
    }
  };

  // forecast 월인지 확인
  const isForecastMonth = (month: string): boolean => {
    return salesData[month]?.isForecast === true;
  };

  // 표에 표시할 월 필터링 (25.01 ~ 26.04)
  const displayMonths = months.filter(
    (m) => m >= "2025.01" && m <= "2026.04"
  );

  if (displayMonths.length === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-gray-500">표시할 데이터가 없습니다.</p>
      </div>
    );
  }

  const rows = [
    { label: "재고자산(M)", getValue: getInventoryValue },
    { label: "판매매출(M)", getValue: getSalesValue },
    { label: "입고예정재고(M)", getValue: getForecastInventoryValue },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="sales-table min-w-max">
        <thead>
          <tr>
            <th className="text-left min-w-[140px] sticky left-0 bg-gray-100 z-20">
              구분
            </th>
            {displayMonths.map((month) => {
              const isForecast = isForecastMonth(month);
              return (
                <th key={month} className="min-w-[80px] bg-gray-50">
                  <div className="flex items-center justify-center gap-1">
                    {formatMonth(month)}
                    {isForecast && (
                      <span className="text-xs text-blue-600" title="예상">
                        (F)
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              <td className="text-left sticky left-0 bg-white z-10 row-header font-semibold text-gray-800">
                {row.label}
              </td>
              {displayMonths.map((month) => {
                const value = row.getValue(month);
                const isForecast = isForecastMonth(month);
                const isForecastRow = row.label === "입고예정재고(M)";
                
                return (
                  <td
                    key={month}
                    className={cn(
                      "row-header font-semibold",
                      isForecast && "text-gray-500 italic bg-blue-50/30",
                      isForecastRow && value === null && "bg-gray-100"
                    )}
                    title={
                      isForecastRow && value === null
                        ? "실적 데이터 없음"
                        : isForecast
                        ? "예상 데이터"
                        : ""
                    }
                  >
                    {value === null ? "" : formatAmountM(value)}
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


