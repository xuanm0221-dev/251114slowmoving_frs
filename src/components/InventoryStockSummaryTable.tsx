"use client";

import { 
  InventoryItemTabData, 
  SalesItemTabData, 
  ForecastInventoryData,
  SalesMonthData,
  ItemTab,
  ActualArrivalData,
} from "@/types/sales";
import { formatAmountM, formatMonth, cn } from "@/lib/utils";

interface InventoryStockSummaryTableProps {
  selectedTab: ItemTab;
  inventoryData: InventoryItemTabData;
  salesData: SalesItemTabData;
  forecastInventoryData?: ForecastInventoryData;
  actualArrivalData?: ActualArrivalData;
  months: string[];
}

export default function InventoryStockSummaryTable({
  selectedTab,
  inventoryData,
  salesData,
  forecastInventoryData,
  actualArrivalData,
  months,
}: InventoryStockSummaryTableProps) {
  // 재고자산(M) 계산: 전체재고 ÷ 1,000,000
  const getInventoryValue = (month: string): number => {
    const monthData = inventoryData[month];
    if (!monthData) return 0;
    // 예상 구간: 전체 필드가 있으면 그것을 사용 (주력/아울렛 구분 없음)
    const total = monthData.전체 !== undefined 
      ? monthData.전체 
      : (monthData.전체_core || 0) + (monthData.전체_outlet || 0);
    return Math.round(total / 1_000_000);
  };

  // 판매매출(M) 계산: 전체판매 ÷ 1,000,000
  const getSalesValue = (month: string): number => {
    const monthData = salesData[month];
    if (!monthData) return 0;
    // 예상 구간: 전체 필드가 있으면 그것을 사용 (주력/아울렛 구분 없음)
    const total = monthData.전체 !== undefined 
      ? monthData.전체 
      : (monthData.전체_core || 0) + (monthData.전체_outlet || 0);
    return Math.round(total / 1_000_000);
  };

  // 재고입고금액(M) 계산:
  // 1) 실제 입고액(ActualArrival)이 있으면 우선 사용
  // 2) 없으면 입고예정(ForecastInventory)을 사용
  // 3) 모두 없으면 null
  const getArrivalValue = (month: string): number | null => {
    // 1. 실제 입고 데이터
    const actualMonth = actualArrivalData?.[month];
    if (actualMonth) {
      if (selectedTab === "전체") {
        const total =
          (actualMonth.Shoes || 0) +
          (actualMonth.Headwear || 0) +
          (actualMonth.Bag || 0) +
          (actualMonth.Acc_etc || 0);
        return Math.round(total / 1_000_000);
      } else {
        const itemValue =
          actualMonth[selectedTab as keyof typeof actualMonth];
        if (typeof itemValue !== "number") return null;
        return Math.round(itemValue / 1_000_000);
      }
    }

    // 2. 입고예정 데이터
    const forecastMonth = forecastInventoryData?.[month];
    if (!forecastMonth) return null;

    if (selectedTab === "전체") {
      const total =
        (forecastMonth.Shoes || 0) +
        (forecastMonth.Headwear || 0) +
        (forecastMonth.Bag || 0) +
        (forecastMonth.Acc_etc || 0);
      return Math.round(total / 1_000_000);
    } else {
      const itemValue = forecastMonth[selectedTab];
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
    { 
      label: "재고자산(M)", 
      labelChinese: "库存",
      getValue: getInventoryValue 
    },
    { 
      label: "판매매출(M)", 
      labelChinese: "零售",
      getValue: getSalesValue 
    },
    { 
      label: "재고입고금액(M)", 
      labelChinese: "入库",
      getValue: getArrivalValue 
    },
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
                <div className="flex flex-col">
                  <span>{row.label}</span>
                  <span className="text-[10px] text-gray-400 font-normal leading-tight">{row.labelChinese}</span>
                </div>
              </td>
              {displayMonths.map((month) => {
                const value = row.getValue(month);
                const isForecast = isForecastMonth(month);
                const isForecastRow = row.label === "재고입고금액(M)";
                
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


