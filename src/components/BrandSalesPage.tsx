"use client";

import { useState, useEffect } from "react";
import { 
  Brand, 
  SalesBrandData, 
  InventoryBrandData,
  ItemTab, 
  SalesSummaryData, 
  InventorySummaryData,
  DEFAULT_STOCK_WEEK 
} from "@/types/sales";
import Navigation from "./Navigation";
import ItemTabs from "./ItemTabs";
import SalesTable from "./SalesTable";
import InventoryTable from "./InventoryTable";
import StockWeeksTable from "./StockWeeksTable";
import WarningBanner from "./WarningBanner";
import StockWeekInput from "./StockWeekInput";
import CollapsibleSection from "./CollapsibleSection";

interface BrandSalesPageProps {
  brand: Brand;
  title: string;
}

export default function BrandSalesPage({ brand, title }: BrandSalesPageProps) {
  const [selectedTab, setSelectedTab] = useState<ItemTab>("전체");
  const [salesData, setSalesData] = useState<SalesSummaryData | null>(null);
  const [inventoryData, setInventoryData] = useState<InventorySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stockWeek, setStockWeek] = useState<number>(DEFAULT_STOCK_WEEK);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const salesResponse = await fetch("/data/accessory_sales_summary.json");
        if (!salesResponse.ok) {
          throw new Error("판매 데이터를 불러오는데 실패했습니다.");
        }
        const salesJson: SalesSummaryData = await salesResponse.json();
        setSalesData(salesJson);

        const inventoryResponse = await fetch("/data/accessory_inventory_summary.json");
        if (!inventoryResponse.ok) {
          throw new Error("재고 데이터를 불러오는데 실패했습니다.");
        }
        const inventoryJson: InventorySummaryData = await inventoryResponse.json();
        setInventoryData(inventoryJson);

        if (salesJson.unexpectedCategories?.length > 0) {
          console.warn(
            "⚠ 판매 데이터 - 제품중분류에 예상치 못한 값이 포함되어 있습니다:",
            salesJson.unexpectedCategories
          );
        }
        if (inventoryJson.unexpectedCategories?.length > 0) {
          console.warn(
            "⚠ 재고 데이터 - 제품중분류에 예상치 못한 값이 포함되어 있습니다:",
            inventoryJson.unexpectedCategories
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const salesBrandData: SalesBrandData | undefined = salesData?.brands[brand];
  const salesTabData = salesBrandData?.[selectedTab];

  const inventoryBrandData: InventoryBrandData | undefined = inventoryData?.brands[brand];
  const inventoryTabData = inventoryBrandData?.[selectedTab];

  const allUnexpectedCategories = [
    ...(salesData?.unexpectedCategories || []),
    ...(inventoryData?.unexpectedCategories || [])
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <>
      <Navigation />
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {/* 예상치 못한 중분류 경고 */}
        {allUnexpectedCategories.length > 0 && (
          <WarningBanner categories={allUnexpectedCategories} />
        )}

        {/* 로딩/에러 */}
        {loading ? (
          <div className="card">
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-500">데이터 로딩 중...</p>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <p className="text-red-500 mb-2">❌ {error}</p>
                <p className="text-gray-500 text-sm">
                  전처리 스크립트를 먼저 실행해주세요: python scripts/preprocess_sales.py
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 1. 아이템 탭 + Stock Week 입력 */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <ItemTabs selectedTab={selectedTab} onTabChange={setSelectedTab} brand={brand} />
              <StockWeekInput value={stockWeek} onChange={setStockWeek} />
            </div>

            {/* 2. 2025년 재고주수 표 */}
            {salesTabData && inventoryTabData && inventoryData?.daysInMonth && (
              <div className="card mb-4">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="text-yellow-500">📅</span>
                  2025년 재고주수
                </h2>
                <StockWeeksTable
                  inventoryData={inventoryTabData}
                  salesData={salesTabData}
                  daysInMonth={inventoryData.daysInMonth}
                  stockWeek={stockWeek}
                  year="2025"
                />

                {/* 재고주수 계산식 범례 */}
                <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-xs font-medium text-yellow-600 mb-2">📅 재고주수 계산식</h3>
                  <div className="grid md:grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">전체주수:</span>{" "}
                      <span className="text-gray-600">전체재고 ÷ (전체판매 ÷ 일수 × 7)</span>
                    </div>
                    <div>
                      <span className="text-gray-500">대리상주수:</span>{" "}
                      <span className="text-gray-600">대리상재고 ÷ (대리상판매 ÷ 일수 × 7)</span>
                    </div>
                    <div>
                      <span className="text-gray-500">창고주수:</span>{" "}
                      <span className="text-gray-600">창고재고 ÷ (전체판매 ÷ 일수 × 7)</span>
                    </div>
                  </div>
                </div>

                {/* 주력/아울렛 분류 기준 */}
                <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-xs font-medium text-gray-600 mb-2">주력/아울렛 분류 기준</h3>
                  <div className="grid md:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">주력상품:</span>{" "}
                      <span className="text-gray-600">INTRO/FOCUS 또는 24FW~26SS 시즌</span>
                    </div>
                    <div>
                      <span className="text-gray-500">아울렛상품:</span>{" "}
                      <span className="text-gray-600">OUTLET/CARE/DONE 또는 기타</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. 2024년 재고주수 표 */}
            {salesTabData && inventoryTabData && inventoryData?.daysInMonth && (
              <div className="card mb-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="text-yellow-500">📅</span>
                  2024년 재고주수
                </h2>
                <StockWeeksTable
                  inventoryData={inventoryTabData}
                  salesData={salesTabData}
                  daysInMonth={inventoryData.daysInMonth}
                  stockWeek={stockWeek}
                  year="2024"
                />
              </div>
            )}

            {/* 4. 판매매출 표 (토글 기능 - 기본 접힘) */}
            <div className="mb-4">
              <CollapsibleSection
                title="판매매출"
                icon="📊"
                iconColor="text-blue-500"
                defaultOpen={false}
                legend={
                  <>
                    <span><span className="text-gray-400">전체판매:</span> FRS + OR</span>
                    <span><span className="text-gray-400">대리상판매:</span> Channel 2 = FRS</span>
                    <span><span className="text-gray-400">직영판매:</span> Channel 2 = OR</span>
                    <span><span className="text-gray-400">금액 단위:</span> M (백만 위안)</span>
                  </>
                }
              >
                {salesTabData && salesData?.months ? (
                  <SalesTable data={salesTabData} months={salesData.months} />
                ) : (
                  <div className="flex items-center justify-center py-10">
                    <p className="text-gray-500">판매 데이터가 없습니다.</p>
                  </div>
                )}
              </CollapsibleSection>
            </div>

            {/* 5. 재고자산 표 (토글 기능 - 기본 접힘) */}
            <div>
              <CollapsibleSection
                title="재고자산"
                icon="📦"
                iconColor="text-green-500"
                defaultOpen={false}
                legend={
                  <>
                    <span><span className="text-gray-400">전체재고:</span> FRS + HQ + OR</span>
                    <span><span className="text-gray-400">본사재고:</span> HQ + OR</span>
                    <span><span className="text-gray-400">직영재고:</span> OR판매 ÷ 일수 × 7 × {stockWeek}주</span>
                    <span><span className="text-gray-400">창고재고:</span> 본사재고 - 직영재고</span>
                  </>
                }
              >
                {inventoryTabData && inventoryData?.months && inventoryData?.daysInMonth ? (
                  <InventoryTable 
                    data={inventoryTabData} 
                    months={inventoryData.months}
                    daysInMonth={inventoryData.daysInMonth}
                    stockWeek={stockWeek}
                  />
                ) : (
                  <div className="flex items-center justify-center py-10">
                    <p className="text-gray-500">재고 데이터가 없습니다.</p>
                  </div>
                )}
              </CollapsibleSection>
            </div>
          </>
        )}
      </main>
    </>
  );
}
