"use client";

import { useState, useEffect } from "react";
import { ItemTab, InventoryScsDetailResponse } from "@/types/sales";
import { toYYYYMM } from "@/lib/inventoryCalculations";

// BRAND_NAME_TO_CODE 상수 정의 (lib/snowflakeQueries.ts에서 가져올 수 없으므로 직접 정의)
const BRAND_NAME_TO_CODE: Record<string, string> = {
  "MLB": "M",
  "MLB KIDS": "I",
  "DISCOVERY": "X",
};

interface InventoryScsDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  brand: string;
  month: string;          // 'YYYY.MM'
  itemTab: ItemTab;
  scope: 'total' | 'frs' | 'warehouse' | 'retail';
  segment: 'core' | 'outlet';
  stockWeek: number;
  title: string;          // "전체기준 - 주력"
}

export default function InventoryScsDetailModal({
  isOpen,
  onClose,
  brand,
  month,
  itemTab,
  scope,
  segment,
  stockWeek,
  title,
}: InventoryScsDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<InventoryScsDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const brandCode = BRAND_NAME_TO_CODE[brand]; // 'MLB' -> 'M'
        const monthYYYYMM = toYYYYMM(month);           // '2025.11' -> '202511'
        const itemCategory = itemTab === '전체' ? 'ALL' : itemTab;

        const queryParams = new URLSearchParams({
          brand: brandCode,
          month: monthYYYYMM,
          itemTab: itemCategory,
          scope,
          segment,
          stockWeek: stockWeek.toString(),
        });

        const response = await fetch(`/api/inventory-scs-detail?${queryParams}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.details || errorData.error || "데이터를 불러오는데 실패했습니다.";
          throw new Error(errorMsg);
        }

        const result: InventoryScsDetailResponse = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, brand, month, itemTab, scope, segment, stockWeek]);

  if (!isOpen) return null;

  const formatAmount = (amount: number): string => {
    const millions = amount / 1_000_000;
    return `${millions.toFixed(1)} M`;
  };

  const formatQty = (qty: number): string => {
    return qty.toLocaleString();
  };

  return (
    <>
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* 모달 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-800">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* 컨텐츠 */}
          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-500">데이터 로딩 중...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <p className="text-red-500 mb-2">❌ 데이터 로드 실패</p>
                  <p className="text-gray-500 text-sm">
                    {error || "서버 오류가 발생했습니다."}
                  </p>
                </div>
              </div>
            ) : data && data.items.length > 0 ? (
              <>
                <div className="mb-4 text-sm text-gray-600">
                  기준월: {month} | 아이템: {itemTab === '전체' ? '전체' : itemTab} | 총 {data.meta.recordCount}개
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          품번
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          상품명
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          재고금액
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          수량
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {data.items.map((item, index) => (
                        <tr
                          key={`${item.prdt_scs_cd}-${index}`}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {item.prdt_scs_cd}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {item.prdt_nm_cn || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                            {formatAmount(item.stock_amt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-700">
                            {formatQty(item.stock_qty)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-20">
                <p className="text-gray-500">해당 조건의 데이터가 없습니다.</p>
              </div>
            )}
          </div>

          {/* 하단 Summary */}
          {data && data.items.length > 0 && (
            <div className="border-t border-gray-200 bg-gray-50 p-6">
              <div className="flex justify-end items-center gap-8 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">총 재고금액:</span>
                  <span className="font-bold text-lg text-blue-600">
                    {formatAmount(data.meta.totalAmt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">총 수량:</span>
                  <span className="font-bold text-lg text-green-600">
                    {formatQty(data.meta.totalQty)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

