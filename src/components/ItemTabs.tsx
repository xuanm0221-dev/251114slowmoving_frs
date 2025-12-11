"use client";

import { ItemTab, ITEM_TABS, Brand, BRANDS, StockWeekWindow } from "@/types/sales";
import { cn } from "@/lib/utils";

interface ItemTabsProps {
  selectedTab: ItemTab;
  onTabChange: (tab: ItemTab) => void;
  brand: Brand;
  // 모두비교 모드
  showAllItems: boolean;
  setShowAllItems: (show: boolean) => void;
  // 성장률 관련 props
  growthRate: number;
  setGrowthRate: (value: number) => void;
  // 재고주수 계산 기간 (1/2/3개월)
  stockWeekWindow: StockWeekWindow;
  setStockWeekWindow: (value: StockWeekWindow) => void;
  // 목표 재고주수 및 신규발주가능 금액 (새로 추가)
  targetStockWeeks: number;
  setTargetStockWeeks: (value: number) => void;
  deltaInventory: number | null;
}

export default function ItemTabs({ 
  selectedTab, 
  onTabChange, 
  brand,
  showAllItems,
  setShowAllItems,
  growthRate,
  setGrowthRate,
  stockWeekWindow,
  setStockWeekWindow,
  targetStockWeeks,
  setTargetStockWeeks,
  deltaInventory,
}: ItemTabsProps) {
  // 현재 브랜드의 색상 정보 가져오기
  const brandInfo = BRANDS.find(b => b.key === brand);

  const tabLabels: Record<ItemTab, { icon: string; label: string }> = {
    전체: { icon: "👋", label: "아이템합계" },
    Shoes: { icon: "👟", label: "슈즈" },
    Headwear: { icon: "🧢", label: "모자" },
    Bag: { icon: "👜", label: "가방" },
    Acc_etc: { icon: "⭐", label: "기타악세" },
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 아이템 탭 */}
      {ITEM_TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={cn(
            "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2",
            selectedTab === tab 
              ? `${brandInfo?.activeColor} ${brandInfo?.activeTextColor}` 
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          <span>{tabLabels[tab].icon}</span>
          <span>{tabLabels[tab].label}</span>
        </button>
      ))}

      {/* 재고주수 한번에 보기 버튼 */}
      <button
        onClick={() => setShowAllItems(!showAllItems)}
        className={cn(
          "px-3 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-1.5 border",
          showAllItems
            ? "bg-purple-600 text-white border-purple-600"
            : "bg-white text-purple-600 border-purple-300 hover:bg-purple-50"
        )}
        title="차트에서 모든 아이템 비교"
      >
        <span>📊</span>
        <span>재고주수 한번에 보기</span>
      </button>

      {/* 성장률 + 재고주수 기준 기간 */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 shadow-sm">
        {/* 성장률 입력 필드 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 text-lg">📈</span>
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              성장률
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={growthRate}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value) && value > 0) {
                  setGrowthRate(value);
                }
              }}
              className="w-16 px-3 py-1.5 bg-white border border-blue-300 rounded-md text-sm font-semibold text-gray-800 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              min="1"
              step="1"
              title="전년동월 대비 성장률 (%)"
            />
            <span className="text-xs text-gray-500 font-medium">%</span>
          </div>
          <span className="text-xs text-gray-500 ml-1" title="전년동월 대비 성장률">
            (전년동월 대비)
          </span>
        </div>

        {/* 재고주수 계산 기준 기간 탭 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
            재고주수 기준:
          </span>
          <div className="flex rounded-lg bg-white/60 border border-blue-200 overflow-hidden">
            {[1, 2, 3].map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => setStockWeekWindow(window as StockWeekWindow)}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors",
                  window === stockWeekWindow
                    ? "bg-blue-600 text-white"
                    : "text-blue-700 hover:bg-blue-100"
                )}
              >
                {window}개월
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 목표 재고주수 + 신규발주가능 금액 (26.03 기준) */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg border border-emerald-200 shadow-sm">
        {/* 목표재고주수 입력 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-emerald-600 text-lg">🎯</span>
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              목표재고주수
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={targetStockWeeks}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value) && value >= 0) {
                  setTargetStockWeeks(value);
                }
              }}
              className="w-16 px-3 py-1.5 bg-white border border-emerald-300 rounded-md text-sm font-semibold text-gray-800 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
              min="0"
              step="1"
              title="목표 재고주수 (26년 3월 기준)"
            />
            <span className="text-xs text-gray-500 font-medium">주</span>
          </div>
        </div>

        {/* 구분선 */}
        <div className="h-6 w-px bg-emerald-200"></div>

        {/* 신규발주가능 금액 표시 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
            신규발주 가능금액:
          </span>
            <span
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-bold min-w-[80px] text-center",
                deltaInventory === null
                  ? "bg-gray-100 text-gray-500"
                  : deltaInventory >= 0
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                  : "bg-red-100 text-red-700 border border-red-300"
              )}
              title="26년 3월 목표 재고 대비 증감액 (백만 위안)"
            >
              {deltaInventory === null
                ? "-"
                : deltaInventory >= 0
                ? `+${Math.round(Math.abs(deltaInventory) / 1000000).toLocaleString("ko-KR")}M`
                : `△${Math.round(Math.abs(deltaInventory) / 1000000).toLocaleString("ko-KR")}M`}
            </span>
        </div>
      </div>
    </div>
  );
}
