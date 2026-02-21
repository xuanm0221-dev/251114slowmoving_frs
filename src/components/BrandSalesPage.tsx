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
import DealerCoreOutletAnalysis from "./DealerCoreOutletAnalysis";
import SectionTitle from "./SectionTitle";
import { generateForecastForBrand } from "@/lib/forecast";
import { buildInventoryForecastForTab } from "@/lib/inventoryForecast";
import { computeStockWeeksForChart, StockWeeksChartPoint, ProductTypeTab, computeTargetInventoryDelta } from "@/utils/stockWeeks";
import { 
  loadForecastInventoryFromStorage, 
  saveForecastInventoryToStorage,
  buildEditableMonths 
} from "@/lib/forecastInventoryStorage";
import { PRODUCT_TYPE_RULES } from "@/constants/businessRules";
import { formatUpdateDate, formatUpdateDateTime, generateOneYearMonths, generateMonthsFromReference, generateMonthsForYearAndNextHalf, generateMonthsAroundReference, getMonthAfter } from "@/lib/utils";
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";

interface BrandSalesPageProps {
  brand: Brand;
  title: string;
}

export default function BrandSalesPage({ brand, title }: BrandSalesPageProps) {
  const { referenceMonth, setLastUpdatedDate: setContextLastUpdatedDate } = useReferenceMonth(); // 전역 기준월
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
  const [lastUpdatedDate, setLastUpdatedDate] = useState<string | null>(null); // 입고예정 마지막 업데이트 날짜
  
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
        // Snowflake API에서 판매 데이터 가져오기
        const salesResponse = await fetch(`/api/sales-data?brand=${brand}&referenceMonth=${referenceMonth}`);
        if (!salesResponse.ok) {
          throw new Error("판매 데이터를 불러오는데 실패했습니다.");
        }
        const salesJson: SalesSummaryData = await salesResponse.json();
        setSalesData(salesJson);
        
        // 디버그: unmapped 정보 로그
        if (salesJson.meta?.unmappedRecords && salesJson.meta.unmappedRecords > 0) {
          console.warn(
            `[sales-data] Unmapped records: ${salesJson.meta.unmappedRecords}, ` +
            `Amount: ${salesJson.meta.unmappedAmount ?? 0}`
          );
        }

        // Snowflake API에서 재고 데이터 가져오기
        const inventoryResponse = await fetch(`/api/inventory-data?brand=${brand}&referenceMonth=${referenceMonth}`);
        if (!inventoryResponse.ok) {
          throw new Error("재고 데이터를 불러오는데 실패했습니다.");
        }
        const inventoryJson: InventorySummaryData = await inventoryResponse.json();
        setInventoryData(inventoryJson);
        
        // 디버그: unmapped 정보 로그
        if (inventoryJson.meta?.unmappedRecords && inventoryJson.meta.unmappedRecords > 0) {
          console.warn(
            `[inventory-data] Unmapped records: ${inventoryJson.meta.unmappedRecords}, ` +
            `Amount: ${inventoryJson.meta.unmappedAmount ?? 0}`
          );
        }

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
            
            // 마지막 업데이트 날짜 로드
            if (forecastJson.metadata && forecastJson.metadata[brand]) {
              const lastUpdated = forecastJson.metadata[brand].lastUpdated;
              setLastUpdatedDate(lastUpdated);
              // Context에도 업데이트
              setContextLastUpdatedDate(brand, lastUpdated);
            }
          } else {
            console.warn("입고예정 재고자산 데이터를 불러오는데 실패했습니다.");
          }
        } catch (e) {
          console.warn("입고예정 재고자산 데이터 로드 중 오류:", e);
        }

        // 실제 입고 재고자산 데이터 로드 (Snowflake API)
        try {
          const actualArrivalResponse = await fetch(`/api/actual-arrival?brand=${brand}&referenceMonth=${referenceMonth}`);
          if (actualArrivalResponse.ok) {
            const actualArrivalJson: ActualArrivalData = await actualArrivalResponse.json();
            setActualArrivalData(actualArrivalJson);
          } else {
            console.warn("재고자산입고(실적) 데이터를 불러오는데 실패했습니다.");
          }
        } catch (e) {
          console.warn("재고자산입고(실적) 데이터 로드 중 오류:", e);
        }

        if (salesJson.unexpectedCategories && salesJson.unexpectedCategories.length > 0) {
          console.warn(
            "⚠ 판매 데이터 - 제품중분류에 예상치 못한 값이 포함되어 있습니다:",
            salesJson.unexpectedCategories
          );
        }
        if (inventoryJson.unexpectedCategories && inventoryJson.unexpectedCategories.length > 0) {
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
  }, [brand, referenceMonth]);

  // 입고예정 데이터 저장 핸들러
  const handleSaveForecastInventory = async () => {
    if (!editingForecastInventory) return;
    
    // 기준월 포함 데이터만 필터링 (기준월 이전은 절대 포함하지 않음)
    const filteredData: ForecastInventoryData = {};
    Object.keys(editingForecastInventory).forEach((month) => {
      if (month >= referenceMonth) {
        filteredData[month] = editingForecastInventory[month];
      } else {
        console.warn(`[입고예정 저장] 기준월(${referenceMonth}) 이전 데이터(${month})는 저장되지 않습니다.`);
      }
    });
    
    if (Object.keys(filteredData).length === 0) {
      alert("저장할 기준월 포함 데이터가 없습니다.");
      return;
    }
    
    try {
      // API로 JSON 파일에 저장
      const response = await fetch('/api/save-forecast-inventory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand,
          data: filteredData,
          referenceMonth,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '저장에 실패했습니다.');
      }

      // localStorage에도 백업 (필터링된 데이터)
      saveForecastInventoryToStorage(brand, filteredData);
      
      // 현재 날짜/시간으로 업데이트
      const now = new Date().toISOString();
      setLastUpdatedDate(now);
      // Context에도 업데이트
      setContextLastUpdatedDate(brand, now);
      
      // forecastInventoryData state 업데이트 (기존 데이터와 병합)
      // 기준월 이전 데이터는 절대 변경하지 않음
      if (forecastInventoryData) {
        const existingBrandData = forecastInventoryData.brands[brand] || {};
        const mergedData: ForecastInventoryData = {};
        
        // 기존 데이터에서 기준월 이전 및 기준월은 유지 (과거 데이터 보호)
        Object.keys(existingBrandData).forEach((month) => {
          if (month <= referenceMonth) {
            mergedData[month] = existingBrandData[month];
          }
        });
        
        // 기준월 이후 데이터만 업데이트
        Object.keys(filteredData).forEach((month) => {
          if (month > referenceMonth) {
            mergedData[month] = filteredData[month];
          }
        });
        
        const updatedData: ForecastInventorySummaryData = {
          ...forecastInventoryData,
          brands: {
            ...forecastInventoryData.brands,
            [brand]: mergedData,
          },
        };
        setForecastInventoryData(updatedData);
      }
      
      alert("입고예정 데이터가 JSON 파일에 저장되었습니다.\n이제 Git으로 커밋/푸시할 수 있습니다.");
    } catch (error) {
      console.error("저장 실패:", error);
      alert(`저장에 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
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
  
  // 기준월: 전역 Context에서 가져온 기준월 사용
  const latestActualYm = referenceMonth;
  
  // 편집 가능한 월 목록 (기준월 포함 12개월: 기준월 + 다음 11개월)
  const forecastInventoryMonths: string[] = useMemo(() => {
    return [referenceMonth, ...buildEditableMonths(referenceMonth, 11)];
  }, [referenceMonth]);

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
    months: inventoryMonthsWithForecastRaw,
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

  // 재고자산 표용: 24.01~26.12 고정 범위 필터링
  const inventoryMonthsWithForecast = useMemo(() => {
    return inventoryMonthsWithForecastRaw.filter(month => month >= "2024.01" && month <= "2026.12");
  }, [inventoryMonthsWithForecastRaw]);

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
    const monthsSet = new Set<string>();
    
    // 기존 실적 월 추가
    if (salesData?.months) {
      salesData.months.forEach(month => monthsSet.add(month));
    }
    
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
    
    // 24.01~26.12까지의 모든 월을 강제로 포함 (데이터가 없어도 표시)
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const monthStr = `${year}.${String(month).padStart(2, "0")}`;
        monthsSet.add(monthStr);
      }
    }
    
    // 월 정렬 (YYYY.MM 형식 기준)
    const sortedMonths = Array.from(monthsSet).sort((a, b) => {
      const [yearA, monthA] = a.split(".").map(Number);
      const [yearB, monthB] = b.split(".").map(Number);
      if (yearA !== yearB) return yearA - yearB;
      return monthA - monthB;
    });
    
    // 24.01~26.12 고정 범위 필터링 (판매매출 표용)
    return sortedMonths.filter(month => {
      return month >= "2024.01" && month <= "2026.12";
    });
  }, [salesData?.months, salesBrandData]);

  // 차트용 재고주수 월 목록: 전체(합계)는 기준월+6개월까지, 대리상은 기준월까지만 표시
  // 전체 차트를 위해 기준월+6개월까지 생성 (대리상은 차트 컴포넌트에서 필터링)
  const stockWeeksChartMonths = useMemo(() => {
    return generateMonthsAroundReference(referenceMonth, 11, 6);
  }, [referenceMonth]);

  const stockWeeksChartData = useMemo(() => {
    if (!salesTabData || !inventoryTabDataWithForecast || !inventoryData?.daysInMonth) {
      return null;
    }
    // 상품 타입 탭에 따라 차트 데이터 계산
    return computeStockWeeksForChart(
      stockWeeksChartMonths,
      inventoryTabDataWithForecast,
      salesTabData,
      inventoryData.daysInMonth,
      stockWeekWindow,
      productTypeTab
    );
  }, [salesTabData, inventoryTabDataWithForecast, inventoryData?.daysInMonth, stockWeekWindow, productTypeTab, stockWeeksChartMonths]);

  // 타겟월 (기준월에서 4개월 후) deltaInventory 계산
  const TARGET_MONTH = getMonthAfter(referenceMonth, 4);

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
    referenceMonth,
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
            {/* 재고주수 분석 섹션 제목 */}
            <SectionTitle title="1. 재고주수 분석" subtitle="weekcover 分析" colorClass="bg-blue-500" />

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
                targetMonth={TARGET_MONTH}
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
                referenceMonth={referenceMonth}
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
                referenceMonth={referenceMonth}
              />
            )}

            {/* 1.7. 재고,판매,입고 추이 표 */}
            {inventoryTabDataWithForecast && salesTabData && (
              <div className="card mb-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-indigo-500 text-xl">📈</span>
                  <div className="flex flex-col">
                    <h2 className="text-xl font-bold text-gray-800">
                      재고,판매,입고 추이
                    </h2>
                    <span className="text-[10px] text-gray-400 leading-tight">库存，零售，入库趋势</span>
                  </div>
                </div>
                <InventoryStockSummaryTable
                  selectedTab={selectedTab}
                  inventoryData={inventoryTabDataWithForecast}
                  salesData={salesTabData}
                  forecastInventoryData={forecastInventoryBrandData}
                  actualArrivalData={actualArrivalBrandData}
                  months={allMonths}
                  referenceMonth={referenceMonth}
                />
                
                {/* 범례 설명 */}
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex flex-col gap-2 text-xs text-gray-600">
                    {/* 한국어 범례 */}
                    <div className="flex flex-wrap items-start gap-6">
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
                    
                    {/* 중국어 범례 */}
                    <div className="flex flex-wrap items-start gap-6 text-gray-400 text-[10px]">
                      <div className="flex items-center gap-1">
                        <span>📊</span>
                        <span className="font-medium">预计零售计算方法:</span>
                        <span className="ml-2">去年同期整体销售实绩 × 增长率</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>📦</span>
                        <span className="font-medium">预计库存计算方法:</span>
                        <span className="ml-2">上月整体库存 + 预计入库 − 预计销售</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>🚚</span>
                        <span className="font-medium">预计入库:</span>
                        <span className="ml-2">以中国法人 SCM 饰品物流预计入库日为基准</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 1.72. 대리상 주력/아울렛 분석 */}
            <DealerCoreOutletAnalysis 
              brand={brand}
            />

            {/* 4~7. 재고,판매, 재고주수 히트맵 (참고용) - MOVED HERE */}
            <CollapsibleSection
              title="재고,판매, 재고주수 히트맵 (참고용)"
              icon="📋"
              iconColor="text-gray-500"
              defaultOpen={false}
            >
              <div className="space-y-4">
                {/* 1. 재고주수 히트맵 (2025년, 2024년) */}
                {salesTabData && inventoryTabDataWithForecast && inventoryData?.daysInMonth && (
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

                    {/* 2026년 재고주수 */}
                    {salesTabData && inventoryTabDataWithForecast && inventoryData?.daysInMonth && (
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-700 mb-3">2026년 재고주수</h3>
                        <StockWeeksTable
                          inventoryData={inventoryTabDataWithForecast}
                          salesData={salesTabData}
                          daysInMonth={inventoryData.daysInMonth}
                          stockWeek={stockWeeks[selectedTab]}
                          year="2026"
                          stockWeekWindow={stockWeekWindow}
                          productTypeTab={productTypeTab}
                        />
                      </div>
                    )}

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
                )}

                {/* 판매매출 */}
                <CollapsibleSection
                  title="판매매출"
                  icon="📊"
                  iconColor="text-blue-500"
                  defaultOpen={false}
                  legend={
                    <>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-4">
                          <span><span className="text-gray-400">전체판매:</span> FRS + OR</span>
                          <span><span className="text-gray-400">대리상판매:</span> Channel 2 = FRS</span>
                          <span><span className="text-gray-400">직영판매:</span> Channel 2 = OR</span>
                          <span><span className="text-gray-400">금액단위:</span> 1위안</span>
                        </div>
                        <div className="pt-2 border-t border-gray-300">
                          <div className="text-xs text-gray-500">
                            <span className="font-semibold">📦 데이터 소스:</span>
                            <span className="ml-2">Snowflake 테이블 - CHN.DW_SALE (매출), CHN.DW_SHOP_WH_DETAIL (매장), FNF.CHN.MST_PRDT_SCS (상품마스터)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">🔧 주요 컬럼:</span>
                            <span className="ml-2">sale_amt (판매금액), shop_id (매장ID), fr_or_cls (채널), prdt_cd (상품코드), parent_prdt_kind_cd (상위제품분류), prdt_kind_nm_en (제품분류영문명), brd_cd (브랜드), remark1~8 (운영기준), sesn (시즌)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">⚙️ 처리방식:</span>
                            <span className="ml-2">Python 스크립트 (scripts/sales_aggregation.py)로 월별/채널별/품목별 집계 → JSON 파일 생성</span>
                          </div>
                        </div>
                      </div>
                    </>
                  }
                >
                  {salesTabData && allMonths.length > 0 ? (
                    <SalesTable data={salesTabData} months={allMonths} referenceMonth={referenceMonth} />
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
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-4">
                          <span><span className="text-gray-400">전체재고:</span> FRS + HQ + OR</span>
                          <span><span className="text-gray-400">본사재고:</span> HQ + OR</span>
                          <span><span className="text-gray-400">직영재고:</span> OR판매 ÷ 일수 × 7 × {stockWeeks[selectedTab]}주</span>
                          <span><span className="text-gray-400">창고재고:</span> 본사재고 - 직영재고</span>
                        </div>
                        <div className="pt-2 border-t border-gray-300">
                          <div className="text-xs text-gray-500">
                            <span className="font-semibold">📦 데이터 소스:</span>
                            <span className="ml-2">Snowflake 테이블 - CHN.DW_STOCK_M (재고), CHN.DW_SHOP_WH_DETAIL (매장), FNF.CHN.MST_PRDT_SCS (상품마스터)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">🔧 주요 컬럼:</span>
                            <span className="ml-2">stock_amt (재고금액), shop_id (매장ID), fr_or_cls (채널), prdt_cd (상품코드), parent_prdt_kind_cd (상위제품분류), prdt_kind_nm_en (제품분류영문명), brd_cd (브랜드), remark1~8 (운영기준), sesn (시즌)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">⚙️ 처리방식:</span>
                            <span className="ml-2">Python 스크립트 (scripts/inventory_aggregation.py)로 월별/채널별/품목별 집계 → JSON 파일 생성</span>
                          </div>
                        </div>
                      </div>
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
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-4">
                          <span className="text-gray-400">
                            기준월 ({referenceMonth}) 포함 12개월 입고예정 (수기입력 가능)
                          </span>
                          <span className="text-gray-400">금액단위: 1위안</span>
                        </div>
                        <div className="pt-2 border-t border-gray-300">
                          <div className="text-xs text-gray-500">
                            <span className="font-semibold">📦 데이터 소스:</span>
                            <span className="ml-2">public/data/accessory_forecast_inventory_summary.json (서버 파일)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">⚙️ 처리방식:</span>
                            <span className="ml-2">대시보드에서 직접 수정 가능, 저장 버튼 클릭 시 JSON 파일에 영구 저장</span>
                          </div>
                          {lastUpdatedDate && (
                            <div className="text-xs text-gray-500 mt-1">
                              <span className="font-semibold">📅 마지막 업데이트:</span>
                              <span className="ml-2">{formatUpdateDateTime(lastUpdatedDate)}</span>
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">🔄 Git 연동:</span>
                            <span className="ml-2">JSON 파일이 직접 수정되므로 Git으로 커밋/푸시 가능, Vercel 배포 시 자동 반영</span>
                          </div>
                        </div>
                      </div>
                    </>
                  }
                  titleExtra={
                    <button
                      onClick={handleSaveForecastInventory}
                      className="group relative px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm rounded-lg font-semibold shadow-lg shadow-blue-500/50 hover:shadow-xl hover:shadow-blue-600/60 transition-all duration-300 flex items-center gap-2 transform hover:scale-105 active:scale-95"
                      title={lastUpdatedDate ? formatUpdateDateTime(lastUpdatedDate) : "입고예정 데이터 저장"}
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
                        {lastUpdatedDate ? `${formatUpdateDate(lastUpdatedDate)} 업데이트` : "저장"}
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
                        lastUpdatedDate={lastUpdatedDate}
                        referenceMonth={referenceMonth}
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
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-4">
                          <span className="text-gray-400">
                            snowflake의 SAP 수불부 기준
                          </span>
                          <span className="text-gray-400">금액단위: 1위안</span>
                        </div>
                        <div className="pt-2 border-t border-gray-300">
                          <div className="text-xs text-gray-500">
                            <span className="font-semibold">📦 데이터 소스:</span>
                            <span className="ml-2">Snowflake 테이블 - sap_fnf.dw_cn_ivtr_prdt_m (수불부), sap_fnf.mst_prdt (상품마스터)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">🔧 주요 컬럼:</span>
                            <span className="ml-2">trns_cls_cd (거래구분코드, '10'=입고), stock_amt (재고금액), prdt_cd (상품코드), prdt_kind_nm_en (제품분류영문명), brd_cd (브랜드)</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-semibold">⚙️ 처리방식:</span>
                            <span className="ml-2">API 실시간 조회 (/api/actual-arrival) - 페이지 로드 시 Snowflake에서 직접 조회</span>
                          </div>
                        </div>
                      </div>
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

            {/* 정체재고 분석 섹션 제목 */}
            <SectionTitle title="2. 정체재고 분석" subtitle="滞销库存分析" colorClass="bg-orange-500" />

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
          </>
        )}
      </main>
    </>
  );
}

