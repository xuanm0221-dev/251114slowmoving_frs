"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Brand } from "@/types/sales";
import { BRAND_CODE_MAP } from "@/types/stagnantStock";
import CollapsibleSection from "./CollapsibleSection";

interface DealerSegmentData {
  stock_amt: number;
  sales_amt: number;
  stock_weeks: number | null;
}

interface DealerData {
  account_id: string;
  account_nm_en: string;
  account_nm_kr: string;
  current: {
    total: DealerSegmentData;
    core: DealerSegmentData;
    outlet: DealerSegmentData;
  };
  prior: {
    total: DealerSegmentData;
    core: DealerSegmentData;
    outlet: DealerSegmentData;
  };
}

interface ProductData {
  account_id: string;
  account_nm_en: string;
  account_nm_kr: string;
  prdt_scs_cd: string;
  prdt_nm_cn: string;
  segment: 'core' | 'outlet';
  current: DealerSegmentData;
  prior: DealerSegmentData;
}

interface ApiResponse {
  dealers: DealerData[];
  products: ProductData[];
  meta: {
    baseMonth: string;
    priorMonth: string;
    daysInMonth: number;
  };
}

interface DealerCoreOutletAnalysisProps {
  brand: Brand;
}

// 숫자 포맷팅 함수
function formatAmountK(num: number): string {
  const kValue = Math.round(num / 1000);
  return kValue.toLocaleString("ko-KR") + "K";
}

function formatStockWeeks(weeks: number | null): string {
  if (weeks === null) return "판매0";
  return weeks.toFixed(1) + "주";
}

function formatYoyPercent(current: number, prior: number): string {
  if (prior === 0) return current > 0 ? "N/A" : "-";
  const yoy = (current / prior) * 100;
  return Math.round(yoy) + "%";
}

function formatYoyWeeks(currentWeeks: number | null, priorWeeks: number | null): string {
  if (currentWeeks === null || priorWeeks === null) return "-";
  const diff = currentWeeks - priorWeeks;
  const sign = diff >= 0 ? "+" : "△";
  return sign + Math.abs(diff).toFixed(1) + "주";
}

function formatMonth(ym: string): string {
  if (ym.length !== 6) return ym;
  return `${ym.slice(0, 4)}.${ym.slice(4)}`;
}

// 상품 상세 모달 컴포넌트
function ProductDetailModal({
  isOpen,
  onClose,
  products,
  dealerName,
  segment,
  baseMonth,
  priorMonth,
}: {
  isOpen: boolean;
  onClose: () => void;
  products: ProductData[];
  dealerName: string;
  segment: 'core' | 'outlet';
  baseMonth: string;
  priorMonth: string;
}) {
  if (!isOpen) return null;

  const segmentLabel = segment === 'core' ? '주력상품' : '아울렛상품';
  const filteredProducts = products.filter(p => p.segment === segment);
  
  // 합계 계산
  const totals = useMemo(() => {
    const currentStockSum = filteredProducts.reduce((sum, p) => sum + p.current.stock_amt, 0);
    const currentSalesSum = filteredProducts.reduce((sum, p) => sum + p.current.sales_amt, 0);
    const priorStockSum = filteredProducts.reduce((sum, p) => sum + p.prior.stock_amt, 0);
    const priorSalesSum = filteredProducts.reduce((sum, p) => sum + p.prior.sales_amt, 0);
    
    // 당월 일수 계산 (baseMonth YYYYMM 형식)
    const year = parseInt(baseMonth.substring(0, 4));
    const month = parseInt(baseMonth.substring(4, 6));
    const daysInMonth = new Date(year, month, 0).getDate();
    
    // 재고주수 계산
    const calcStockWeeks = (stock: number, sales: number) => {
      if (sales <= 0) return null;
      const weekSales = (sales / daysInMonth) * 7;
      return weekSales > 0 ? stock / weekSales : null;
    };
    
    return {
      currentStockSum,
      currentSalesSum,
      priorStockSum,
      priorSalesSum,
      currentStockWeeks: calcStockWeeks(currentStockSum, currentSalesSum),
      priorStockWeeks: calcStockWeeks(priorStockSum, priorSalesSum),
    };
  }, [filteredProducts, baseMonth]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-6xl max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800">
              {dealerName} - {segmentLabel}
            </h3>
            <p className="text-sm text-gray-500">prdt_scs_cd 단위 상세 | {filteredProducts.length}개 품목</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-light">×</button>
        </div>

        {/* 테이블 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="text-left py-2 px-3 font-medium text-gray-600" rowSpan={2}>prdt_scs_cd</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600" rowSpan={2}>품명</th>
                <th className="text-center py-2 px-3 font-medium text-gray-600 border-l border-gray-300" colSpan={3}>
                  당월 ({formatMonth(baseMonth)})
                </th>
                <th className="text-center py-2 px-3 font-medium text-gray-600 border-l border-gray-300" colSpan={3}>
                  전년동월 ({formatMonth(priorMonth)})
                </th>
              </tr>
              <tr>
                <th className="text-right py-2 px-3 font-medium text-gray-600 border-l border-gray-300">기말재고(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">판매매출(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">재고주수</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600 border-l border-gray-300">기말재고(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">판매매출(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">재고주수</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>
              ) : (
                <>
                  {/* 합계 행 */}
                  <tr className="bg-yellow-50 border-b-2 border-yellow-300 font-bold">
                    <td className="py-2 px-3 text-gray-800" colSpan={2}>합계</td>
                    <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300">{formatAmountK(totals.currentStockSum)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(totals.currentSalesSum)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(totals.currentStockWeeks)}</td>
                    <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300">{formatAmountK(totals.priorStockSum)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(totals.priorSalesSum)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(totals.priorStockWeeks)}</td>
                  </tr>
                  
                  {/* 상품 목록 */}
                  {filteredProducts.map((product, idx) => (
                  <tr key={product.prdt_scs_cd + idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-mono text-xs text-gray-700">{product.prdt_scs_cd}</td>
                    <td className="py-2 px-3 text-gray-700 max-w-[250px] truncate" title={product.prdt_nm_cn}>{product.prdt_nm_cn}</td>
                    <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200">{formatAmountK(product.current.stock_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(product.current.sales_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(product.current.stock_weeks)}</td>
                    <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200">{formatAmountK(product.prior.stock_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(product.prior.sales_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(product.prior.stock_weeks)}</td>
                  </tr>
                ))}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* 푸터 */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 flex items-center justify-end rounded-b-lg">
          <button onClick={onClose} className="px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm font-medium">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// 2025년 월 옵션
const MONTHS_2025 = Array.from({ length: 12 }, (_, i) => ({
  value: `2025${String(i + 1).padStart(2, "0")}`,
  label: `${i + 1}월`,
}));

export default function DealerCoreOutletAnalysis({
  brand,
}: DealerCoreOutletAnalysisProps) {
  console.log('[DealerCoreOutlet] Component rendered/mounted with brand:', brand);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("202511"); // YYYYMM 형식
  
  // 펼친 대리상 ID
  const [expandedDealerId, setExpandedDealerId] = useState<string | null>(null);
  
  // 전체 합계 펼침 상태
  const [expandedTotalSummary, setExpandedTotalSummary] = useState(false);
  
  // 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<DealerData | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<'core' | 'outlet' | null>(null);

  const brandCode = BRAND_CODE_MAP[brand] || "M";
  
  // 컴포넌트 마운트 시 한 번만 실행
  useEffect(() => {
    console.log('[DealerCoreOutlet] Component mounted!');
  }, []);

  // 데이터 로드
  const fetchData = useCallback(async () => {
    if (!selectedMonth) {
      console.log('[DealerCoreOutlet] selectedMonth is empty, skipping fetch');
      return;
    }
    
    console.log('[DealerCoreOutlet] Fetching data:', { brand: brandCode, baseMonth: selectedMonth });
    setLoading(true);
    setError(null);
    setExpandedDealerId(null);
    
    try {
      const params = new URLSearchParams({
        brand: brandCode,
        baseMonth: selectedMonth,
      });
      
      const url = `/api/dealer-core-outlet?${params}`;
      console.log('[DealerCoreOutlet] Request URL:', url);
      
      const response = await fetch(url);
      console.log('[DealerCoreOutlet] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[DealerCoreOutlet] Error response:', errorText);
        throw new Error("데이터를 불러오는데 실패했습니다: " + errorText);
      }
      
      const result: ApiResponse = await response.json();
      console.log('[DealerCoreOutlet] Data loaded successfully:', result);
      setData(result);
    } catch (err) {
      console.error('[DealerCoreOutlet] Fetch error:', err);
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [brandCode, selectedMonth]);

  useEffect(() => {
    console.log('[DealerCoreOutlet] useEffect triggered:', { selectedMonth, brandCode });
    if (selectedMonth) {
      fetchData();
    } else {
      console.log('[DealerCoreOutlet] selectedMonth is empty, not fetching');
    }
  }, [fetchData, selectedMonth, brandCode]);

  const handleDealerClick = (dealer: DealerData) => {
    if (expandedDealerId === dealer.account_id) {
      setExpandedDealerId(null);
    } else {
      setExpandedDealerId(dealer.account_id);
    }
  };

  const handleSegmentClick = (dealer: DealerData, segment: 'core' | 'outlet') => {
    setSelectedDealer(dealer);
    setSelectedSegment(segment);
    setModalOpen(true);
  };

  // 대리상별 상품 필터링
  const getProductsForDealer = (accountId: string): ProductData[] => {
    if (!data) return [];
    return data.products.filter(p => p.account_id === accountId);
  };

  // 재고주수 계산 함수
  const calcStockWeeks = (stockAmt: number, salesAmt: number, daysInMonth: number): number | null => {
    if (salesAmt <= 0) return null;
    const weekSales = (salesAmt / daysInMonth) * 7;
    if (weekSales <= 0) return null;
    return stockAmt / weekSales;
  };

  // 전체 합계 계산
  const totals = useMemo(() => {
    if (!data) return null;
    
    const summary = {
      current_stock_total: 0,
      current_sales_total: 0,
      current_stock_core: 0,
      current_sales_core: 0,
      current_stock_outlet: 0,
      current_sales_outlet: 0,
      prior_stock_total: 0,
      prior_sales_total: 0,
      prior_stock_core: 0,
      prior_sales_core: 0,
      prior_stock_outlet: 0,
      prior_sales_outlet: 0,
    };
    
    data.dealers.forEach(dealer => {
      summary.current_stock_total += dealer.current.total.stock_amt;
      summary.current_sales_total += dealer.current.total.sales_amt;
      summary.current_stock_core += dealer.current.core.stock_amt;
      summary.current_sales_core += dealer.current.core.sales_amt;
      summary.current_stock_outlet += dealer.current.outlet.stock_amt;
      summary.current_sales_outlet += dealer.current.outlet.sales_amt;
      summary.prior_stock_total += dealer.prior.total.stock_amt;
      summary.prior_sales_total += dealer.prior.total.sales_amt;
      summary.prior_stock_core += dealer.prior.core.stock_amt;
      summary.prior_sales_core += dealer.prior.core.sales_amt;
      summary.prior_stock_outlet += dealer.prior.outlet.stock_amt;
      summary.prior_sales_outlet += dealer.prior.outlet.sales_amt;
    });
    
    return {
      ...summary,
      current_stock_weeks: calcStockWeeks(summary.current_stock_total, summary.current_sales_total, data.meta.daysInMonth),
      prior_stock_weeks: calcStockWeeks(summary.prior_stock_total, summary.prior_sales_total, data.meta.daysInMonth),
      current_stock_weeks_core: calcStockWeeks(summary.current_stock_core, summary.current_sales_core, data.meta.daysInMonth),
      prior_stock_weeks_core: calcStockWeeks(summary.prior_stock_core, summary.prior_sales_core, data.meta.daysInMonth),
      current_stock_weeks_outlet: calcStockWeeks(summary.current_stock_outlet, summary.current_sales_outlet, data.meta.daysInMonth),
      prior_stock_weeks_outlet: calcStockWeeks(summary.prior_stock_outlet, summary.prior_sales_outlet, data.meta.daysInMonth),
    };
  }, [data]);

  return (
    <div className="mb-4">
      <CollapsibleSection
        title="대리상 주력/아울렛 분석"
        icon="🏪"
        iconColor="text-indigo-500"
        defaultOpen={false}
      >
        {/* 컨트롤 영역 */}
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-600">기준월:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
              >
                {MONTHS_2025.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>
            {data && (
              <div className="text-xs text-gray-500">
                전년동월: {formatMonth(data.meta.priorMonth)}
              </div>
            )}
          </div>
          
          <div className="text-xs text-gray-500 text-right">
            <div>FR 기준 | Tag 금액 기준 | prdt_scs_cd 단위</div>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            <span className="ml-3 text-gray-600">데이터 로딩 중...</span>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
        )}

        {!loading && !error && data && (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-indigo-50 sticky top-0 z-10">
                <tr className="border-b border-indigo-100">
                  <th className="w-8 py-2 px-2" rowSpan={2}></th>
                  <th className="text-left py-2 px-2 font-medium text-indigo-700" rowSpan={2}>대리상</th>
                  <th className="text-center py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200" colSpan={3}>
                    당월 ({formatMonth(data.meta.baseMonth)})
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200" colSpan={3}>
                    전년동월 ({formatMonth(data.meta.priorMonth)})
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200" colSpan={3}>
                    YOY
                  </th>
                </tr>
                <tr className="border-b border-indigo-100">
                  <th className="text-right py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200">기말재고(K)</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700">판매매출(K)</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700">재고주수</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200">기말재고(K)</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700">판매매출(K)</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700">재고주수</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200">기말재고</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700">판매매출</th>
                  <th className="text-right py-2 px-3 font-medium text-indigo-700">재고주수</th>
                </tr>
              </thead>
              <tbody>
                {data.dealers.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>
                ) : (
                  <>
                    {/* 전체 합계 행 */}
                    {totals && (
                      <>
                        <tr 
                          className={`sticky top-[76px] z-[9] bg-yellow-50 border-b-2 border-yellow-300 font-bold cursor-pointer transition-colors ${
                            expandedTotalSummary ? "bg-yellow-100" : "hover:bg-yellow-100"
                          }`}
                          onClick={() => setExpandedTotalSummary(!expandedTotalSummary)}
                        >
                          <td className="py-2 px-2 text-center">
                            <span className={`text-gray-400 transition-transform inline-block ${expandedTotalSummary ? "rotate-90" : ""}`}>
                              ▶
                            </span>
                          </td>
                          <td className="py-2 px-2 text-gray-800">전체 합계</td>
                          <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300">{formatAmountK(totals.current_stock_total)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(totals.current_sales_total)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(totals.current_stock_weeks)}</td>
                          <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300">{formatAmountK(totals.prior_stock_total)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(totals.prior_sales_total)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(totals.prior_stock_weeks)}</td>
                          <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300">{formatYoyPercent(totals.current_stock_total, totals.prior_stock_total)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatYoyPercent(totals.current_sales_total, totals.prior_sales_total)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatYoyWeeks(totals.current_stock_weeks, totals.prior_stock_weeks)}</td>
                        </tr>
                        
                        {/* 주력상품 합계 행 */}
                        {expandedTotalSummary && (
                          <tr className="sticky top-[116px] z-[8] border-b border-blue-100 bg-blue-50 font-semibold">
                            <td className="py-1.5 px-2"></td>
                            <td className="py-1.5 px-2 pl-8 text-blue-700">ㄴ 주력상품 합계</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(totals.current_stock_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(totals.current_sales_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(totals.current_stock_weeks_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(totals.prior_stock_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(totals.prior_sales_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(totals.prior_stock_weeks_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatYoyPercent(totals.current_stock_core, totals.prior_stock_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyPercent(totals.current_sales_core, totals.prior_sales_core)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyWeeks(totals.current_stock_weeks_core, totals.prior_stock_weeks_core)}</td>
                          </tr>
                        )}
                        
                        {/* 아울렛상품 합계 행 */}
                        {expandedTotalSummary && (
                          <tr className="sticky top-[152px] z-[7] border-b border-amber-100 bg-amber-50 font-semibold">
                            <td className="py-1.5 px-2"></td>
                            <td className="py-1.5 px-2 pl-8 text-amber-700">ㄴ 아울렛상품 합계</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(totals.current_stock_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(totals.current_sales_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(totals.current_stock_weeks_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(totals.prior_stock_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(totals.prior_sales_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(totals.prior_stock_weeks_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatYoyPercent(totals.current_stock_outlet, totals.prior_stock_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyPercent(totals.current_sales_outlet, totals.prior_sales_outlet)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyWeeks(totals.current_stock_weeks_outlet, totals.prior_stock_weeks_outlet)}</td>
                          </tr>
                        )}
                      </>
                    )}
                    
                    {/* 대리상 목록 */}
                    {data.dealers.map((dealer) => {
                    const isExpanded = expandedDealerId === dealer.account_id;
                    const products = isExpanded ? getProductsForDealer(dealer.account_id) : [];
                    const hasCoreProducts = products.some(p => p.segment === 'core');
                    const hasOutletProducts = products.some(p => p.segment === 'outlet');
                    
                    return (
                      <>
                        {/* 대리상 행 */}
                        <tr
                          key={dealer.account_id}
                          className={`border-b border-gray-100 cursor-pointer transition-colors ${
                            isExpanded ? "bg-gray-100" : "hover:bg-gray-50"
                          }`}
                          onClick={() => handleDealerClick(dealer)}
                        >
                          <td className="py-2 px-2 text-center">
                            <span className={`text-gray-400 transition-transform inline-block ${isExpanded ? "rotate-90" : ""}`}>
                              ▶
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <div className="font-medium text-gray-800">{dealer.account_nm_en}</div>
                            <div className="text-xs text-gray-500">
                              {dealer.account_id} · {dealer.account_nm_kr}
                            </div>
                          </td>
                          <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200">{formatAmountK(dealer.current.total.stock_amt)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(dealer.current.total.sales_amt)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(dealer.current.total.stock_weeks)}</td>
                          <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200">{formatAmountK(dealer.prior.total.stock_amt)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(dealer.prior.total.sales_amt)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(dealer.prior.total.stock_weeks)}</td>
                          <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200">{formatYoyPercent(dealer.current.total.stock_amt, dealer.prior.total.stock_amt)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatYoyPercent(dealer.current.total.sales_amt, dealer.prior.total.sales_amt)}</td>
                          <td className="text-right py-2 px-3 text-gray-900">{formatYoyWeeks(dealer.current.total.stock_weeks, dealer.prior.total.stock_weeks)}</td>
                        </tr>
                        
                        {/* 주력상품 행 (펼쳐진 경우) */}
                        {isExpanded && hasCoreProducts && (
                          <tr
                            key={`${dealer.account_id}-core`}
                            className="border-b border-blue-100 bg-blue-50 hover:bg-blue-100 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSegmentClick(dealer, 'core');
                            }}
                          >
                            <td className="py-1.5 px-2"></td>
                            <td className="py-1.5 px-2 pl-8 text-blue-700 font-medium flex items-center gap-1">
                              ㄴ 주력상품
                              <span className="text-xs">▶</span>
                            </td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(dealer.current.core.stock_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(dealer.current.core.sales_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(dealer.current.core.stock_weeks)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(dealer.prior.core.stock_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(dealer.prior.core.sales_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(dealer.prior.core.stock_weeks)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatYoyPercent(dealer.current.core.stock_amt, dealer.prior.core.stock_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyPercent(dealer.current.core.sales_amt, dealer.prior.core.sales_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyWeeks(dealer.current.core.stock_weeks, dealer.prior.core.stock_weeks)}</td>
                          </tr>
                        )}
                        
                        {/* 아울렛상품 행 (펼쳐진 경우) */}
                        {isExpanded && hasOutletProducts && (
                          <tr
                            key={`${dealer.account_id}-outlet`}
                            className="border-b border-amber-100 bg-amber-50 hover:bg-amber-100 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSegmentClick(dealer, 'outlet');
                            }}
                          >
                            <td className="py-1.5 px-2"></td>
                            <td className="py-1.5 px-2 pl-8 text-amber-700 font-medium flex items-center gap-1">
                              ㄴ 아울렛상품
                              <span className="text-xs">▶</span>
                            </td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(dealer.current.outlet.stock_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(dealer.current.outlet.sales_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(dealer.current.outlet.stock_weeks)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatAmountK(dealer.prior.outlet.stock_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(dealer.prior.outlet.sales_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(dealer.prior.outlet.stock_weeks)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700 border-l border-gray-200">{formatYoyPercent(dealer.current.outlet.stock_amt, dealer.prior.outlet.stock_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyPercent(dealer.current.outlet.sales_amt, dealer.prior.outlet.sales_amt)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-700">{formatYoyWeeks(dealer.current.outlet.stock_weeks, dealer.prior.outlet.stock_weeks)}</td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  </>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {!loading && !error && !data && (
          <div className="text-center py-12 text-gray-500">선택한 조건에 해당하는 데이터가 없습니다.</div>
        )}
      </CollapsibleSection>

      {/* 상품 상세 모달 */}
      {selectedDealer && selectedSegment && data && (
        <ProductDetailModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setSelectedSegment(null);
          }}
          products={getProductsForDealer(selectedDealer.account_id)}
          dealerName={selectedDealer.account_nm_en}
          segment={selectedSegment}
          baseMonth={data.meta.baseMonth}
          priorMonth={data.meta.priorMonth}
        />
      )}
    </div>
  );
}

