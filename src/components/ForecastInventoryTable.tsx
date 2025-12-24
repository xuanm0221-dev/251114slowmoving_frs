"use client";

import { useState, useEffect } from "react";
import { ForecastInventoryData, Brand } from "@/types/sales";
import { formatMonth, cn, formatUpdateDate, formatUpdateDateTime } from "@/lib/utils";

interface ForecastInventoryTableProps {
  data: ForecastInventoryData;
  months: string[];
  brand: Brand;
  onSave: (data: ForecastInventoryData) => void;
  onDataChange?: (data: ForecastInventoryData) => void; // 편집 중인 데이터를 부모에게 전달
  lastUpdatedDate?: string | null; // ISO 형식의 마지막 업데이트 날짜
}

const ITEM_ROWS: { label: string; dataKey: string; isHeader: boolean; editable: boolean }[] = [
  { label: "아이템합계", dataKey: "total", isHeader: true, editable: false },
  { label: "ㄴ 슈즈", dataKey: "Shoes", isHeader: false, editable: true },
  { label: "ㄴ 모자", dataKey: "Headwear", isHeader: false, editable: true },
  { label: "ㄴ 가방", dataKey: "Bag", isHeader: false, editable: true },
  { label: "ㄴ 기타", dataKey: "Acc_etc", isHeader: false, editable: true },
];

export default function ForecastInventoryTable({
  data,
  months,
  brand,
  onSave,
  onDataChange,
  lastUpdatedDate,
}: ForecastInventoryTableProps) {
  // 로컬 state로 편집 중인 데이터 관리
  const [editingData, setEditingData] = useState<ForecastInventoryData>(data);

  // props의 data가 변경되면 editingData도 업데이트
  useEffect(() => {
    setEditingData(data);
  }, [data]);

  // editingData가 변경될 때마다 부모에게 알림
  useEffect(() => {
    onDataChange?.(editingData);
  }, [editingData, onDataChange]);

  const getCellValue = (month: string, dataKey: string): number => {
    const monthData = editingData[month];
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

  const handleCellChange = (month: string, dataKey: string, value: string) => {
    const numValue = value === "" ? 0 : parseFloat(value.replace(/,/g, ""));
    if (isNaN(numValue) || numValue < 0) return;

    setEditingData((prev) => ({
      ...prev,
      [month]: {
        ...prev[month],
        [dataKey]: numValue,
      },
    }));
  };

  const handleSave = () => {
    onSave(editingData);
  };

  const formatNumber = (value: number): string => {
    return value.toLocaleString("en-US");
  };

  if (!months || months.length === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-gray-500">입고예정 재고자산 데이터가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 테이블 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="sales-table min-w-max">
          <thead>
            <tr>
              <th className="text-left min-w-[140px] sticky left-0 bg-gray-100 z-20">
                구분
              </th>
              {months.map((month) => (
                <th key={month} className="min-w-[120px] bg-blue-50">
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
                  
                  if (!row.editable) {
                    // 아이템합계는 읽기 전용
                    return (
                      <td
                        key={month}
                        className={cn(
                          row.isHeader && "row-header font-semibold",
                          "text-gray-700 bg-blue-50/50"
                        )}
                        title="아이템합계 (자동계산)"
                      >
                        {formatNumber(value)}
                      </td>
                    );
                  }

                  // 편집 가능한 셀
                  return (
                    <td
                      key={month}
                      className={cn(
                        "p-1 bg-blue-50/30"
                      )}
                      title="입고예정 재고자산 (편집 가능)"
                    >
                      <input
                        type="text"
                        value={formatNumber(value)}
                        onChange={(e) => handleCellChange(month, row.dataKey, e.target.value)}
                        onFocus={(e) => {
                          // 포커스시 쉼표 제거하여 편집 모드
                          const num = parseFloat(e.target.value.replace(/,/g, ""));
                          e.target.value = isNaN(num) ? "0" : num.toString();
                          e.target.select();
                        }}
                        onBlur={(e) => {
                          // 블러시 포맷팅 적용
                          const num = parseFloat(e.target.value.replace(/,/g, ""));
                          e.target.value = formatNumber(isNaN(num) ? 0 : num);
                        }}
                        className="w-full px-2 py-1 text-right border border-gray-300 rounded focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 안내 메시지 */}
      <div className="text-xs text-gray-500 italic">
        💡 숫자를 입력한 후 저장 버튼을 클릭하면 변경사항이 저장됩니다.
      </div>
    </div>
  );
}
