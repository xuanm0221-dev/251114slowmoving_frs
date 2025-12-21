"use client";

import { useState, useEffect, useMemo } from "react";
import { 
  Brand, 
  SalesBrandData, 
  InventoryBrandData,
  ItemTab, 
  ChannelTab,
  SalesSummaryData, 
  InventorySummaryData,
  StockWeeksByItem,
  createDefaultStockWeeks,
  ForecastInventorySummaryData,
  ForecastInventoryData,
  ActualArrivalData,
  StockWeekWindow,
} from "@/types/sales";
import type { DimensionTab } from "@/types/stagnantStock";
import Navigation from "./Navigation";
import ItemTabs from "./ItemTabs";
import SalesTable from "./SalesTable";
import InventoryTable from "./InventoryTable";
import StockWeeksTable from "./StockWeeksTable";
import StockWeeksSummary from "./StockWeeksSummary";
import StockWeeksChart from "./StockWeeksChart";
import InventoryChart from "./InventoryChart";
import WarningBanner from "./WarningBanner";
import StockWeekInput from "./StockWeekInput";
import CollapsibleSection from "./CollapsibleSection";
import ForecastInventoryTable from "./ForecastInventoryTable";
import InventoryStockSummaryTable from "./InventoryStockSummaryTable";
import ActualArrivalTable from "./ActualArrivalTable";
import StagnantStockAnalysis from "./StagnantStockAnalysis";
import DealerStagnantStockAnalysis from "./DealerStagnantStockAnalysis";
import ShopStagnantStockAnalysis from "./ShopStagnantStockAnalysis";
import InventorySeasonChart from "./InventorySeasonChart";
import { generateForecastForBrand } from "@/lib/forecast";
import { buildInventoryForecastForTab } from "@/lib/inventoryForecast";
import { computeStockWeeksForChart, StockWeeksChartPoint, ProductTypeTab, computeTargetInventoryDelta } from "@/utils/stockWeeks";
import { 
  loadForecastInventoryFromStorage, 
  saveForecastInventoryToStorage,
  buildEditableMonths 
} from "@/lib/forecastInventoryStorage";
import { PRODUCT_TYPE_RULES } from "@/constants/businessRules";

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
  const [stockWeeks, setStockWeeks] = useState<StockWeeksByItem>(createDefaultStockWeeks());
  const [showAllItemsInChart, setShowAllItemsInChart] = useState(false); // 차트 모두선택 모드
  const [channelTab, setChannelTab] = useState<ChannelTab>("ALL"); // 채널 탭 (ALL, FRS, 창고)
  const [growthRate, setGrowthRate] = useState<number>(105); // 성장률 (기본값 105%)
  const [forecastInventoryData, setForecastInventoryData] = useState<ForecastInventorySummaryData | null>(null);
  const [actualArrivalData, setActualArrivalData] = useState<ActualArrivalData | null>(null);
  const [stockWeekWindow, setStockWeekWindow] = useState<StockWeekWindow>(1);
  const [productTypeTab, setProductTypeTab] = useState<ProductTypeTab>("전체"); // 상품 타입 탭 (전체/주력/아울렛)
  const [targetStockWeeks, setTargetStockWeeks] = useState<number>(40); // 목표재고주수 (기본값 40주)
  const [stagnantDimensionTab, setStagnantDimensionTab] = useState<DimensionTab>("컬러&사이즈"); // 정체재고 분석 단위
  const [stagnantThresholdPct, setStagnantThresholdPct] = useState<number>(0.01); // 정체재고 기준 %
  const [stagnantMinQty, setStagnantMinQty] = useState<number>(10); // 정체재고 최소 수량 기준 (기본값 10) - 전월말 기준
  const [stagnantItemTab, setStagnantItemTab] = useState<"ACC합계" | "신발" | "모자" | "가방" | "기타">("ACC합계"); // 정체재고 아이템 필터
  const [stagnantCurrentMonthMinQty, setStagnantCurrentMonthMinQty] = useState<number>(10); // 당월수량 기준 (기본값 10)
  const [editingForecastInventory, setEditingForecastInventory] = useState<ForecastInventoryData | null>(null); // 편집 중인 입고예정 데이터
  
  // 특정 아이템의 stockWeek 변경 핸들러
  const handleStockWeekChange = (itemTab: ItemTab, value: number) => {
    setStockWeeks(prev => ({
      ...prev,
      [itemTab]: value
    }));
  };

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

        // 입고예정 재고자산 데이터 로드 (JSON 파일 + localStorage 병합)
        try {
          const forecastResponse = await fetch("/data/accessory_forecast_inventory_summary.json");
          if (forecastResponse.ok) {
            const forecastJson: ForecastInventorySummaryData = await forecastResponse.json();
            
            // localStorage에서 저장된 데이터 로드
            const storedData = loadForecastInventoryFromStorage(brand);
            
            // JSON 데이터와 localStorage 데이터 병합 (localStorage 우선)
            const mergedBrandData = {
              ...forecastJson.brands[brand],
              ...storedData,
            };
            
            const mergedForecastData: ForecastInventorySummaryData = {
              ...forecastJson,
              brands: {
                ...forecastJson.brands,
                [brand]: mergedBrandData,
              },
            };
            
            setForecastInventoryData(mergedForecastData);
          } else {
            console.warn("입고예정 재고자산 데이터를 불러오는데 실패했습니다.");
          }
        } catch (e) {
          console.warn("입고예정 재고자산 데이터 로드 중 오류:", e);
        }

        // 실제 입고 재고자산 데이터 로드 (Snowflake API)
        try {
          const actualArrivalResponse = await fetch(`/api/actual-arrival?brand=${brand}`);
          if (actualArrivalResponse.ok) {
            const actualArrivalJson: ActualArrivalData = await actualArrivalResponse.json();
            setActualArrivalData(actualArrivalJson);
          } else {
            console.warn("재고자산입고(실적) 데이터를 불러오는데 실패했습니다.");
          }
        } catch (e) {
          console.warn("재고자산입고(실적) 데이터 로드 중 오류:", e);
        }

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
  }, [brand]);

  // 입고예정 데이터 저장 핸들러
  const handleSaveForecastInventory = () => {
    if (!editingForecastInventory) return;
    
    // localStorage에 저장
    const success = saveForecastInventoryToStorage(brand, editingForecastInventory);
    
    if (success) {
      // forecastInventoryData state 업데이트
      if (forecastInventoryData) {
        const updatedData: ForecastInventorySummaryData = {
          ...forecastInventoryData,
          brands: {
            ...forecastInventoryData.brands,
            [brand]: editingForecastInventory,
          },
        };
        setForecastInventoryData(updatedData);
      }
      alert("입고예정 데이터가 저장되었습니다.");
    } else {
      alert("저장에 실패했습니다.");
    }
  };

  // 원본 브랜드 데이터
  const originalSalesBrandData: SalesBrandData | undefined = salesData?.brands[brand];
  
  // Forecast가 포함된 브랜드 데이터
  const salesBrandData: SalesBrandData | undefined = useMemo(() => {
    if (!originalSalesBrandData) return undefined;
    return generateForecastForBrand(originalSalesBrandData, growthRate);
  }, [originalSalesBrandData, growthRate]);

  const salesTabData = salesBrandData?.[selectedTab];

  const inventoryBrandData: InventoryBrandData | undefined = inventoryData?.brands[brand];
  const inventoryTabData = inventoryBrandData?.[selectedTab];

  const forecastInventoryBrandData: ForecastInventoryData | undefined =
    forecastInventoryData?.brands[brand];
  
  // 기준월 계산 (inventoryData.months의 마지막 월)
  const latestActualYm = useMemo(() => {
    if (!inventoryData?.months || inventoryData.months.length === 0) return "2025.11";
    const sortedMonths = [...inventoryData.months].sort((a, b) => {
      const [yearA, monthA] = a.split(".").map(Number);
      const [yearB, monthB] = b.split(".").map(Number);
      if (yearA !== yearB) return yearA - yearB;
      return monthA - monthB;
    });
    return sortedMonths[sortedMonths.length - 1];
  }, [inventoryData?.months]);
  
  // 편집 가능한 월 목록 (기준월 + 1부터 6개월)
  const forecastInventoryMonths: string[] = useMemo(() => {
    return buildEditableMonths(latestActualYm, 6);
  }, [latestActualYm]);

  const actualArrivalBrandData: ActualArrivalData | undefined = actualArrivalData ?? undefined;
  // months는 데이터의 키에서 추출 (2025.01 ~ 2025.11)
  const actualArrivalMonths: string[] = actualArrivalData 
    ? Object.keys(actualArrivalData).sort()
    : [];

  const allUnexpectedCategories = [
    ...(salesData?.unexpectedCategories || []),
    ...(inventoryData?.unexpectedCategories || [])
  ].filter((v, i, a) => a.indexOf(v) === i);

  // 재고자산 표용: 25.10까지 Actual + 25.11~26.04 Forecast 재고자산
  const {
    months: inventoryMonthsWithForecast,
    data: inventoryTabDataWithForecast,
  } = useMemo(() => {
    if (
      !inventoryData?.months ||
      !inventoryBrandData ||
      !salesBrandData
    ) {
      return {
        months: inventoryData?.months || [],
        data: inventoryTabData || {},
      };
    }

    return buildInventoryForecastForTab({
      itemTab: selectedTab,
      inventoryBrandData,
      inventoryMonths: inventoryData.months,
      salesBrandDataWithForecast: salesBrandData,
      forecastInventoryBrandData,
    });
  }, [
    selectedTab,
    inventoryBrandData,
    inventoryData?.months,
    salesBrandData,
    forecastInventoryBrandData,
    inventoryTabData,
  ]);

  // 재고자산/재고자산 차트용: 선택된 탭에는 forecast 재고를 반영
  const inventoryBrandDataForChart: InventoryBrandData | undefined = useMemo(() => {
    if (!inventoryBrandData) return undefined;
    return {
      ...inventoryBrandData,
      [selectedTab]: inventoryTabDataWithForecast,
    };
  }, [inventoryBrandData, inventoryTabDataWithForecast, selectedTab]);

  // months 배열에 forecast 월 추가
  const allMonths = useMemo(() => {
    if (!salesData?.months) return [];
    const monthsSet = new Set(salesData.months);
    
    // Forecast 월 추가
    if (salesBrandData) {
      Object.values(salesBrandData).forEach((itemData) => {
        Object.keys(itemData).forEach((month) => {
          if (itemData[month]?.isForecast) {
            monthsSet.add(month);
          }
        });
      });
    }
    
    // 월 정렬 (YYYY.MM 형식 기준)
    return Array.from(monthsSet).sort((a, b) => {
      const [yearA, monthA] = a.split(".").map(Number);
      const [yearB, monthB] = b.split(".").map(Number);
      if (yearA !== yearB) return yearA - yearB;
      return monthA - monthB;
    });
  }, [salesData?.months, salesBrandData]);

  // 차트용 재고주수 데이터 계산 (히트맵과 동일한 계산 로직 사용)
  const MONTHS_2025_WITH_FORECAST = [
    "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
    "2025.07", "2025.08", "2025.09", "2025.10", "2025.11", "2025.12",
    "2026.01", "2026.02", "2026.03", "2026.04",
  ];

  const stockWeeksChartData = useMemo(() => {
    if (!salesTabData || !inventoryTabDataWithForecast || !inventoryData?.daysInMonth) {
      return null;
    }
    // 상품 타입 탭에 따라 차트 데이터 계산
    return computeStockWeeksForChart(
      MONTHS_2025_WITH_FORECAST,
      inventoryTabDataWithForecast,
      salesTabData,
      inventoryData.daysInMonth,
      stockWeekWindow,
      productTypeTab
    );
  }, [salesTabData, inventoryTabDataWithForecast, inventoryData?.daysInMonth, stockWeekWindow, productTypeTab]);

  // 타겟월 (26.03) deltaInventory 계산
  const TARGET_MONTH = "2026.03";

  const deltaInventoryResult = useMemo(() => {
    if (!salesBrandData || !inventoryTabDataWithForecast || !inventoryData?.daysInMonth) {
      return null;
    }

    // 선택된 탭의 예상 매출 데이터를 월별로 추출
    const projectedSalesByMonth: { [month: string]: number } = {};
    const salesTabDataLocal = salesBrandData[selectedTab];
    if (salesTabDataLocal) {
      Object.entries(salesTabDataLocal).forEach(([month, data]) => {
        // 예상 구간에서는 전체 필드 사용, 실적 구간에서는 core + outlet
        const total = data.전체 !== undefined 
          ? data.전체 
          : (data.전체_core || 0) + (data.전체_outlet || 0);
        projectedSalesByMonth[month] = total;
      });
    }

    // 선택된 탭의 예상 재고 데이터를 월별로 추출
    const projectedInventoryByMonth: { [month: string]: number } = {};
    Object.entries(inventoryTabDataWithForecast).forEach(([month, data]) => {
      // 예상 구간에서는 전체 필드 사용, 실적 구간에서는 core + outlet
      const total = data.전체 !== undefined 
        ? data.전체 
        : (data.전체_core || 0) + (data.전체_outlet || 0);
      projectedInventoryByMonth[month] = total;
    });

    return computeTargetInventoryDelta({
      targetMonth: TARGET_MONTH,
      weeksTarget: targetStockWeeks,
      monthBasis: stockWeekWindow,
      projectedSalesByMonth,
      projectedInventoryByMonth,
      daysInMonth: inventoryData.daysInMonth,
    });
  }, [
    salesBrandData,
    selectedTab,
    inventoryTabDataWithForecast,
    inventoryData?.daysInMonth,
    targetStockWeeks,
    stockWeekWindow,
  ]);

  return (
      <>
        <Navigation />
        <main className="max-w-[1800px] mx-auto px-6 py-6 mt-14">
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
            {/* 0. 재고주수 Summary 섹션 */}
            {inventoryBrandData && salesBrandData && inventoryData?.daysInMonth && (
              <StockWeeksSummary
                brand={brand}
                inventoryBrandData={inventoryBrandData}
                salesBrandData={salesBrandData}
                daysInMonth={inventoryData.daysInMonth}
                stockWeeks={stockWeeks}
                onStockWeekChange={handleStockWeekChange}
                stockWeekWindow={stockWeekWindow}
              />
            )}

            {/* 1. 아이템 탭 + 차트 모두선택 */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <ItemTabs 
                selectedTab={selectedTab} 
                onTabChange={setSelectedTab} 
                brand={brand}
                showAllItems={showAllItemsInChart}
                setShowAllItems={setShowAllItemsInChart}
                growthRate={growthRate}
                setGrowthRate={setGrowthRate}
                stockWeekWindow={stockWeekWindow}
                setStockWeekWindow={setStockWeekWindow}
                targetStockWeeks={targetStockWeeks}
                setTargetStockWeeks={setTargetStockWeeks}
                deltaInventory={deltaInventoryResult?.deltaInventory ?? null}
              />
            </div>

            {/* 1.5. 월별 재고주수 추이 차트 */}
            {stockWeeksChartData && (
              <StockWeeksChart
                key={`${selectedTab}-${growthRate}-${stockWeekWindow}`}
                selectedTab={selectedTab}
                chartData={stockWeeksChartData}
                showAllItems={showAllItemsInChart}
                allInventoryData={inventoryBrandData}
                allSalesData={salesBrandData}
                daysInMonth={inventoryData?.daysInMonth || {}}
                stockWeekWindow={stockWeekWindow}
                channelTab={channelTab}
                productTypeTab={productTypeTab}
                setProductTypeTab={setProductTypeTab}
              />
            )}

            {/* 1.6. 월별 재고자산 추이 막대차트 */}
            {inventoryBrandDataForChart && salesBrandData && inventoryData?.daysInMonth && (
              <InventoryChart
                selectedTab={selectedTab}
                // 선택 탭에는 forecast 재고자산(25.11~26.04) 포함
                inventoryBrandData={inventoryBrandDataForChart}
                salesBrandData={salesBrandData}
                channelTab={channelTab}
                setChannelTab={setChannelTab}
                daysInMonth={inventoryData.daysInMonth}
                stockWeekWindow={stockWeekWindow}
                stockWeek={stockWeeks[selectedTab]}
              />
            )}

            {/* 1.7. 재고,판매,입고 추이 표 */}
            {inventoryTabDataWithForecast && salesTabData && (
              <div className="card mb-4">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="text-indigo-500">📈</span>
                  재고,판매,입고 추이
                </h2>
                <InventoryStockSummaryTable
                  selectedTab={selectedTab}
                  inventoryData={inventoryTabDataWithForecast}
                  salesData={salesTabData}
                  forecastInventoryData={forecastInventoryBrandData}
                  actualArrivalData={actualArrivalBrandData}
                  months={allMonths}
                />
                
                {/* 범례 설명 */}
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex flex-wrap items-start gap-6 text-xs text-gray-600">
                    <div className="flex items-center gap-1">
                      <span>📊</span>
                      <span className="font-medium">예상판매매출 계산식:</span>
                      <span className="ml-2">전년동월 전체판매 실적 × 성장률</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>📦</span>
                      <span className="font-medium">예상재고자산 계산식:</span>
                      <span className="ml-2">이전월 전체재고 + 입고예정 - 판매예정</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>🚚</span>
                      <span className="font-medium">입고예정재고:</span>
                      <span className="ml-2">중국법인 SCM 악세 물류 입고예정일 기준</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 1.75. 재고택금액 추이 (시즌별) - 전년대비/매출액대비 전환 차트 */}
            <InventorySeasonChart 
              brand={brand} 
              dimensionTab={stagnantDimensionTab} 
              onDimensionTabChange={setStagnantDimensionTab}
              thresholdPct={stagnantThresholdPct}
              minQty={stagnantMinQty}
              currentMonthMinQty={stagnantCurrentMonthMinQty}
              itemTab={stagnantItemTab}
              onItemTabChange={setStagnantItemTab}
            />

            {/* 1.8. 정체재고 분석 */}
            <StagnantStockAnalysis 
              brand={brand} 
              dimensionTab={stagnantDimensionTab}
              onDimensionTabChange={setStagnantDimensionTab}
              thresholdPct={stagnantThresholdPct}
              onThresholdPctChange={setStagnantThresholdPct}
              minQty={stagnantMinQty}
              onMinQtyChange={setStagnantMinQty}
              currentMonthMinQty={stagnantCurrentMonthMinQty}
              onCurrentMonthMinQtyChange={setStagnantCurrentMonthMinQty}
              itemTab={stagnantItemTab}
              onItemTabChange={setStagnantItemTab}
            />

            {/* 1.9. 대리상 단위 정체재고 분석 (FR 기준) */}
            <DealerStagnantStockAnalysis 
              brand={brand}
              thresholdPct={stagnantThresholdPct}
              onThresholdPctChange={setStagnantThresholdPct}
              minQty={stagnantMinQty}
              onMinQtyChange={setStagnantMinQty}
            />

            {/* 1.10. 직영매장 단위 정체재고 분석 (OR 기준) */}
            <ShopStagnantStockAnalysis 
              brand={brand}
              thresholdPct={stagnantThresholdPct}
              onThresholdPctChange={setStagnantThresholdPct}
              minQty={stagnantMinQty}
              onMinQtyChange={setStagnantMinQty}
            />

            {/* 2. 재고주수 히트맵 (2025년, 2024년) */}
            {salesTabData && inventoryTabDataWithForecast && inventoryData?.daysInMonth && (
              <div className="mb-4">
                <CollapsibleSection
                  title="재고주수 히트맵"
                  icon="📅"
                  iconColor="text-yellow-500"
                  defaultOpen={false}
                >
                  {/* 2025년 재고주수 */}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">2025년 재고주수</h3>
                    <StockWeeksTable
                      inventoryData={inventoryTabDataWithForecast}
                      salesData={salesTabData}
                      daysInMonth={inventoryData.daysInMonth}
                      stockWeek={stockWeeks[selectedTab]}
                      year="2025"
                      stockWeekWindow={stockWeekWindow}
                      productTypeTab={productTypeTab}
                    />
                  </div>

                  {/* 재고주수 계산식 범례 */}
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="text-xs font-medium text-yellow-600 mb-2">📅 재고주수 계산식</h3>
                    <div className="grid md:grid-cols-3 gap-4 text-xs">
                      <div className="space-y-2">
                        <div>
                          <span className="text-gray-600">1. 전체주수 = 전체재고 ÷ (전체판매 ÷ 일수 × 7)</span>
                        </div>
                        <div>
                          <span className="text-gray-600">2. 대리상주수 = 대리상재고 ÷ (대리상판매 ÷ 일수 × 7)</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-600 space-y-1">
                          <div>3. 직영주력상품 = stockWeek (직영판매예정재고 주수, 주력만 적용)</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-600 space-y-1">
                          <div>4. 창고주수(전체) = 창고재고(전체) ÷ [(주력 대리상판매 + 주력 직영판매 + 아울렛 직영판매) ÷ 일수 × 7]</div>
                          <div className="pl-2">ㄴ 주력 = 창고 주력재고 ÷ [(주력 대리상판매 + 주력 직영판매) ÷ 일수 × 7]</div>
                          <div className="pl-2">ㄴ 아울렛 = 본사아울렛재고 ÷ (아울렛 직영판매 ÷ 일수 × 7)</div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-300">
                      <div className="grid md:grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="text-gray-500 font-medium">{PRODUCT_TYPE_RULES.core.label} 분류 기준:</span>{" "}
                          <span className="text-gray-600">{PRODUCT_TYPE_RULES.core.criteria}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 font-medium">{PRODUCT_TYPE_RULES.outlet.label} 분류 기준:</span>{" "}
                          <span className="text-gray-600">{PRODUCT_TYPE_RULES.outlet.criteria}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2024년 재고주수 */}
                  {salesTabData && inventoryTabData && inventoryData?.daysInMonth && (
                    <div className="mt-6">
                      <h3 className="text-lg font-semibold text-gray-700 mb-3">2024년 재고주수</h3>
                      <StockWeeksTable
                        inventoryData={inventoryTabData}
                        salesData={salesTabData}
                        daysInMonth={inventoryData.daysInMonth}
                        stockWeek={stockWeeks[selectedTab]}
                        year="2024"
                        stockWeekWindow={stockWeekWindow}
                        productTypeTab={productTypeTab}
                      />
                    </div>
                  )}
                </CollapsibleSection>
              </div>
            )}

            {/* 4~7. 재고,판매 데이터 (참고용) - 4개 섹션을 하나로 묶음 */}
            <CollapsibleSection
              title="재고,판매 데이터 (참고용)"
              icon="📋"
              iconColor="text-gray-500"
              defaultOpen={false}
            >
              <div className="space-y-4">
                {/* 판매매출 */}
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
                      <span><span className="text-gray-400">금액단위:</span> 1위안</span>
                    </>
                  }
                >
                  {salesTabData && allMonths.length > 0 ? (
                    <SalesTable data={salesTabData} months={allMonths} />
                  ) : (
                    <div className="flex items-center justify-center py-10">
                      <p className="text-gray-500">판매 데이터가 없습니다.</p>
                    </div>
                  )}
                </CollapsibleSection>

                {/* 재고자산 */}
                <CollapsibleSection
                  title="재고자산"
                  icon="📦"
                  iconColor="text-green-500"
                  defaultOpen={false}
                  legend={
                    <>
                      <span><span className="text-gray-400">전체재고:</span> FRS + HQ + OR</span>
                      <span><span className="text-gray-400">본사재고:</span> HQ + OR</span>
                      <span><span className="text-gray-400">직영재고:</span> OR판매 ÷ 일수 × 7 × {stockWeeks[selectedTab]}주</span>
                      <span><span className="text-gray-400">창고재고:</span> 본사재고 - 직영재고</span>
                    </>
                  }
                >
                  {inventoryTabDataWithForecast &&
                  inventoryMonthsWithForecast.length > 0 &&
                  inventoryData?.daysInMonth ? (
                    <InventoryTable 
                      data={inventoryTabDataWithForecast} 
                      months={inventoryMonthsWithForecast}
                      daysInMonth={inventoryData.daysInMonth}
                      stockWeek={stockWeeks[selectedTab]}
                    />
                  ) : (
                    <div className="flex items-center justify-center py-10">
                      <p className="text-gray-500">재고 데이터가 없습니다.</p>
                    </div>
                  )}
                </CollapsibleSection>

                {/* 입고예정 재고자산 */}
                <CollapsibleSection
                  title="입고예정 재고자산"
                  icon="📥"
                  iconColor="text-purple-500"
                  defaultOpen={false}
                  legend={
                    <>
                      <span className="text-gray-400">
                        기준월 ({latestActualYm}) 이후 6개월 입고예정 (수기입력 가능)
                      </span>
                      <span className="text-gray-400">금액단위: 1위안</span>
                    </>
                  }
                  titleExtra={
                    <button
                      onClick={handleSaveForecastInventory}
                      className="group relative px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm rounded-lg font-semibold shadow-lg shadow-blue-500/50 hover:shadow-xl hover:shadow-blue-600/60 transition-all duration-300 flex items-center gap-2 transform hover:scale-105 active:scale-95"
                    >
                      <svg 
                        className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2.5} 
                          d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" 
                        />
                      </svg>
                      <span className="relative">
                        저장
                        <span className="absolute -bottom-0.5 left-0 w-0 h-0.5 bg-white/50 group-hover:w-full transition-all duration-300"></span>
                      </span>
                    </button>
                  }
                >
                  {forecastInventoryBrandData && forecastInventoryMonths.length > 0 ? (
                    <>
                      <div className="mb-3 text-xs text-gray-500">
                        표시 기간:{" "}
                        {forecastInventoryMonths.length > 0
                          ? `${forecastInventoryMonths[0]} ~ ${
                              forecastInventoryMonths[forecastInventoryMonths.length - 1]
                            }`
                          : "데이터 없음"}
                      </div>
                      <ForecastInventoryTable
                        data={forecastInventoryBrandData}
                        months={forecastInventoryMonths}
                        brand={brand}
                        onSave={handleSaveForecastInventory}
                        onDataChange={setEditingForecastInventory}
                      />
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-10">
                      <p className="text-gray-500">입고예정 재고자산 데이터가 없습니다.</p>
                    </div>
                  )}
                </CollapsibleSection>

                {/* 재고자산입고(실적) */}
                <CollapsibleSection
                  title="재고자산입고(실적)"
                  icon="📦"
                  iconColor="text-orange-500"
                  defaultOpen={false}
                  legend={
                    <>
                      <span className="text-gray-400">
                        snowflake의 SAP 수불부 기준
                      </span>
                      <span className="text-gray-400">금액단위: 1위안</span>
                    </>
                  }
                >
                  {actualArrivalBrandData && actualArrivalMonths.length > 0 ? (
                    <>
                      <div className="mb-3 text-xs text-gray-500">
                        표시 기간:{" "}
                        {`${actualArrivalMonths[0]} ~ ${
                          actualArrivalMonths[actualArrivalMonths.length - 1]
                        }`}
                      </div>
                      <ActualArrivalTable
                        data={actualArrivalBrandData}
                        months={actualArrivalMonths}
                      />
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-10">
                      <p className="text-gray-500">
                        재고자산입고(실적) 데이터가 없습니다.
                      </p>
                    </div>
                  )}
                </CollapsibleSection>
              </div>
            </CollapsibleSection>
          </>
        )}
      </main>
    </>
  );
}
