"use client";

import { ItemTab, ITEM_TABS, Brand, BRANDS } from "@/types/sales";
import { cn } from "@/lib/utils";

interface ItemTabsProps {
  selectedTab: ItemTab;
  onTabChange: (tab: ItemTab) => void;
  brand: Brand;
}

export default function ItemTabs({ selectedTab, onTabChange, brand }: ItemTabsProps) {
  // 현재 브랜드의 색상 정보 가져오기
  const brandInfo = BRANDS.find(b => b.key === brand);

  const tabLabels: Record<ItemTab, { icon: string; label: string }> = {
    전체: { icon: "👋", label: "전체" },
    Shoes: { icon: "👟", label: "슈즈" },
    Headwear: { icon: "🧢", label: "모자" },
    Bag: { icon: "👜", label: "가방" },
    Acc_etc: { icon: "⭐", label: "기타악세" },
  };

  return (
    <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
