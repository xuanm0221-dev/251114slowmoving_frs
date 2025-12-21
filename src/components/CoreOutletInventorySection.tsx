"use client";

import { ItemTab, InventoryItemTabData } from "@/types/sales";
import { getCoreOutletCardValues, getDaysInMonth } from "@/lib/inventoryCalculations";
import { formatAmountWon } from "@/lib/utils";

interface CoreOutletInventorySectionProps {
  brand: string;
  selectedMonth: string;
  selectedTab: ItemTab;
  inventoryTabData: InventoryItemTabData;
  daysInMonth: { [month: string]: number };
  stockWeek: number;
  onCardClick: (
    scope: 'total' | 'frs' | 'warehouse' | 'retail',
    segment: 'core' | 'outlet',
    title: string
  ) => void;
}

export default function CoreOutletInventorySection({
  brand,
  selectedMonth,
  selectedTab,
  inventoryTabData,
  daysInMonth,
  stockWeek,
  onCardClick,
}: CoreOutletInventorySectionProps) {
  const monthData = inventoryTabData[selectedMonth];
  const days = getDaysInMonth(selectedMonth, daysInMonth);
  const cardValues = getCoreOutletCardValues(monthData, days, stockWeek);

  const handleClick = (
    scope: 'total' | 'frs' | 'warehouse' | 'retail',
    segment: 'core' | 'outlet'
  ) => {
    const scopeLabels: Record<string, string> = {
      total: '전체기준',
      frs: '대리상',
      warehouse: '창고',
      retail: '직영',
    };
    const segmentLabel = segment === 'core' ? '주력' : '아울렛';
    const title = `${scopeLabels[scope]} - ${segmentLabel}`;
    onCardClick(scope, segment, title);
  };

  const formatValue = (value: number): string => {
    // M 단위로 표시 (백만)
    const millions = value / 1_000_000;
    return `${millions.toFixed(1)} M`;
  };

  const cards = [
    {
      scope: 'total' as const,
      title: '전체기준',
      icon: '🎯',
      color: 'blue',
      values: cardValues.total,
    },
    {
      scope: 'frs' as const,
      title: '대리상',
      icon: '🏪',
      color: 'green',
      values: cardValues.frs,
    },
    {
      scope: 'warehouse' as const,
      title: '창고',
      icon: '📦',
      color: 'orange',
      values: cardValues.warehouse,
    },
    {
      scope: 'retail' as const,
      title: '직영',
      icon: '🏬',
      color: 'purple',
      values: cardValues.retail,
    },
  ];

  const colorClasses: Record<string, { bg: string; border: string; hover: string; text: string }> = {
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      hover: 'hover:border-blue-400',
      text: 'text-blue-700',
    },
    green: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      hover: 'hover:border-green-400',
      text: 'text-green-700',
    },
    orange: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      hover: 'hover:border-orange-400',
      text: 'text-orange-700',
    },
    purple: {
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      hover: 'hover:border-purple-400',
      text: 'text-purple-700',
    },
  };

  return (
    <div className="mb-4">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <span className="text-2xl">📊</span>
            주력/아울렛 재고 분석
          </h3>
          <div className="text-sm text-gray-500">
            기준월: {selectedMonth} | 재고주수: {stockWeek}주
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => {
            const colors = colorClasses[card.color];
            return (
              <div
                key={card.scope}
                className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-4 transition-all duration-200`}
              >
                {/* 카드 헤더 */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{card.icon}</span>
                  <h4 className={`font-semibold ${colors.text}`}>{card.title}</h4>
                </div>

                {/* 주력 */}
                <button
                  onClick={() => handleClick(card.scope, 'core')}
                  className={`w-full text-left px-3 py-2 rounded ${colors.bg} ${colors.hover} border ${colors.border} hover:shadow-md transition-all duration-150 mb-2`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">주력</span>
                    <span className={`text-base font-bold ${colors.text}`}>
                      {formatValue(card.values.core)}
                    </span>
                  </div>
                </button>

                {/* 아울렛 */}
                <button
                  onClick={() => handleClick(card.scope, 'outlet')}
                  className={`w-full text-left px-3 py-2 rounded ${colors.bg} ${colors.hover} border ${colors.border} hover:shadow-md transition-all duration-150`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">아울렛</span>
                    <span className={`text-base font-bold ${colors.text}`}>
                      {formatValue(card.values.outlet)}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* 설명 */}
        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="text-xs text-gray-600 space-y-1">
            <div>
              <span className="font-medium">• 전체기준:</span> 전체재고 (대리상 + 본사)
            </div>
            <div>
              <span className="font-medium">• 대리상:</span> 대리상재고
            </div>
            <div>
              <span className="font-medium">• 창고:</span> 본사재고 - 직영판매예정분
            </div>
            <div>
              <span className="font-medium">• 직영:</span> 직영판매예정분 (OR 판매 ÷ 일수 × 7 × {stockWeek}주)
            </div>
            <div className="pt-2 border-t border-gray-300 mt-2">
              <span className="text-gray-500">클릭하면 품번(SCS) 단위 상세 리스트를 확인할 수 있습니다.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

