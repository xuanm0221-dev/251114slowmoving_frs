"use client";

import { useState } from "react";
import { 
  InventoryItemTabData, 
  SalesItemTabData, 
  ForecastInventoryData,
  SalesMonthData,
  ItemTab,
  ActualArrivalData,
} from "@/types/sales";
import { formatAmountM, formatMonth, cn, generateMonthsFromReference } from "@/lib/utils";

interface InventoryStockSummaryTableProps {
  selectedTab: ItemTab;
  inventoryData: InventoryItemTabData;
  salesData: SalesItemTabData;
  forecastInventoryData?: ForecastInventoryData;
  actualArrivalData?: ActualArrivalData;
  months: string[];
  referenceMonth: string;
}

export default function InventoryStockSummaryTable({
  selectedTab,
  inventoryData,
  salesData,
  forecastInventoryData,
  actualArrivalData,
  months,
  referenceMonth,
}: InventoryStockSummaryTableProps) {
  // 2024년 데이터 표시 여부 상태 (기본값: 접힌 상태)
  const [show2024, setShow2024] = useState(false);
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
  // 1) 실제 입고액(ActualArrival)이 있으면 우선 사용 (값이 0이면 입고예정으로 fall-through)
  // 2) 없거나 실적 0이면 입고예정(ForecastInventory) 사용
  // 3) 26.07~26.12 구간에서는 데이터가 없어도 0 반환
  // 4) 그 외는 null
  const getArrivalValue = (month: string): number | null => {
    // 1. 실제 입고 데이터 (0이면 입고예정 사용)
    const actualMonth = actualArrivalData?.[month];
    if (actualMonth) {
      if (selectedTab === "전체") {
        const total =
          (actualMonth.Shoes || 0) +
          (actualMonth.Headwear || 0) +
          (actualMonth.Bag || 0) +
          (actualMonth.Acc_etc || 0);
        const valueM = Math.round(total / 1_000_000);
        if (valueM > 0) return valueM;
      } else {
        const itemValue =
          actualMonth[selectedTab as keyof typeof actualMonth];
        if (typeof itemValue === "number") {
          const valueM = Math.round(itemValue / 1_000_000);
          if (valueM > 0) return valueM;
        }
      }
    }

    // 2. 입고예정 데이터
    const forecastMonth = forecastInventoryData?.[month];
    if (forecastMonth) {
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
    }

    // 3. 26.07~26.12 구간에서는 데이터가 없어도 0 반환
    const [year, monthNum] = month.split(".").map(Number);
    if (year === 2026 && monthNum >= 7 && monthNum <= 12) {
      return 0;
    }

    // 4. 그 외는 null 반환
    return null;
  };

  // forecast 월인지 확인 (기준월 초과이면 예상)
  const isForecastMonth = (month: string): boolean => {
    if (month > referenceMonth) return true;
    return salesData[month]?.isForecast === true;
  };

  // YOY 계산 헬퍼 (재고자산용)
  const getInventoryYoY = (month: string): number | null => {
    const [year, monthNum] = month.split(".").map(Number);
    
    // 2025년 또는 2026년만 YOY 계산
    if (year !== 2025 && year !== 2026) return null;
    
    const currentValue = getInventoryValue(month);
    if (currentValue === 0) return null;
    
    // 전년 동월
    const prevYear = year - 1;
    const prevMonth = `${prevYear}.${String(monthNum).padStart(2, "0")}`;
    const prevValue = getInventoryValue(prevMonth);
    
    if (prevValue === 0) return null;
    return Math.round((currentValue / prevValue) * 100);
  };

  // YOY 계산 헬퍼 (판매매출용)
  const getSalesYoY = (month: string): number | null => {
    const [year, monthNum] = month.split(".").map(Number);
    
    // 2025년 또는 2026년만 YOY 계산
    if (year !== 2025 && year !== 2026) return null;
    
    const currentValue = getSalesValue(month);
    if (currentValue === 0) return null;
    
    // 전년 동월
    const prevYear = year - 1;
    const prevMonth = `${prevYear}.${String(monthNum).padStart(2, "0")}`;
    const prevValue = getSalesValue(prevMonth);
    
    if (prevValue === 0) return null;
    return Math.round((currentValue / prevValue) * 100);
  };

  // YOY 계산 헬퍼 (입고금액용)
  const getArrivalYoY = (month: string): number | null => {
    const [year, monthNum] = month.split(".").map(Number);
    
    // 2025년 또는 2026년만 YOY 계산
    if (year !== 2025 && year !== 2026) return null;
    
    const currentValue = getArrivalValue(month);
    if (currentValue === null || currentValue === 0) return null;
    
    // 전년 동월
    const prevYear = year - 1;
    const prevMonth = `${prevYear}.${String(monthNum).padStart(2, "0")}`;
    const prevValue = getArrivalValue(prevMonth);
    
    if (prevValue === null || prevValue === 0) return null;
    return Math.round((currentValue / prevValue) * 100);
  };

  // 표에 표시할 월 필터링 (24.01부터 26.12까지, 2024년은 토글 상태에 따라)
  const displayMonths = months.filter((m) => {
    // 24.01~26.12 범위 확인
    if (m < "2024.01" || m > "2026.12") return false;
    
    // 2024년 데이터는 토글 상태에 따라 표시
    if (m >= "2024.01" && m <= "2024.12") {
      return show2024;
    }
    
    // 2025년, 2026년은 항상 표시
    return true;
  });

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
      getValue: getInventoryValue,
      getYoY: getInventoryYoY
    },
    { 
      label: "판매매출(M)", 
      labelChinese: "零售",
      getValue: getSalesValue,
      getYoY: getSalesYoY
    },
    { 
      label: "재고입고금액(M)", 
      labelChinese: "入库",
      getValue: getArrivalValue,
      getYoY: getArrivalYoY
    },
  ];

  return (
    <div>
      {/* 2024년 데이터 토글 버튼 */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setShow2024(!show2024)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors",
            show2024
              ? "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
              : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
          )}
        >
          <span className="text-xs">{show2024 ? "▼" : "▶"}</span>
          <span>2024년 데이터</span>
          <span className="text-xs text-gray-500">(24.01~24.12)</span>
        </button>
      </div>

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
                const yoy = row.getYoY ? row.getYoY(month) : null;
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
                    <div className="flex flex-col items-center">
                      <span>{value === null ? "" : formatAmountM(value)}</span>
                      {yoy !== null && (
                        <span className="text-[10px] text-gray-400 mt-0.5 font-normal">
                          ({yoy}%)
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}


