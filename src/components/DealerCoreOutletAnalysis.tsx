"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Brand } from "@/types/sales";
import { BRAND_CODE_MAP } from "@/types/stagnantStock";
import CollapsibleSection from "./CollapsibleSection";
import BilingualLabel from "./BilingualLabel";

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
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>prdt_scs_cd 단위 상세</span>
              <span className="text-gray-400 text-xs">prdt_scs_cd 单位详细</span>
              <span>|</span>
              <span>{filteredProducts.length}개 품목</span>
              <span className="text-gray-400 text-xs">{filteredProducts.length}个商品</span>
            </div>
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
                <th className="text-right py-2 px-3 font-medium text-gray-600 border-l border-gray-300">
                  <div className="flex flex-col items-end">
                    <span>기말재고(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">期末库存(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">
                  <div className="flex flex-col items-end">
                    <span>판매매출(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">零售额(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">
                  <div className="flex flex-col items-end">
                    <span>재고주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">weekcover</span>
                  </div>
                </th>
                <th className="text-right py-2 px-3 font-medium text-gray-600 border-l border-gray-300">
                  <div className="flex flex-col items-end">
                    <span>기말재고(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">期末库存(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">
                  <div className="flex flex-col items-end">
                    <span>판매매출(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">零售额(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">
                  <div className="flex flex-col items-end">
                    <span>재고주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">weekcover</span>
                  </div>
                </th>
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

// 통합 모달 컴포넌트 (주력 + 아울렛 병렬)
function DealerDetailModal({
  isOpen,
  onClose,
  dealer,
  products,
  baseMonth,
  priorMonth,
}: {
  isOpen: boolean;
  onClose: () => void;
  dealer: DealerData;
  products: ProductData[];
  baseMonth: string;
  priorMonth: string;
}) {
  if (!isOpen) return null;

  const coreProducts = products.filter(p => p.segment === 'core');
  const outletProducts = products.filter(p => p.segment === 'outlet');
  
  // 당월 일수 계산
  const year = parseInt(baseMonth.substring(0, 4));
  const month = parseInt(baseMonth.substring(4, 6));
  const daysInMonth = new Date(year, month, 0).getDate();
  
  // 재고주수 계산 함수
  const calcStockWeeks = (stock: number, sales: number) => {
    if (sales <= 0) return null;
    const weekSales = (sales / daysInMonth) * 7;
    return weekSales > 0 ? stock / weekSales : null;
  };

  // 주력 합계 계산
  const coreTotals = useMemo(() => {
    const currentStock = coreProducts.reduce((sum, p) => sum + p.current.stock_amt, 0);
    const currentSales = coreProducts.reduce((sum, p) => sum + p.current.sales_amt, 0);
    const priorStock = coreProducts.reduce((sum, p) => sum + p.prior.stock_amt, 0);
    const priorSales = coreProducts.reduce((sum, p) => sum + p.prior.sales_amt, 0);
    
    return {
      currentStock,
      currentSales,
      currentWeeks: calcStockWeeks(currentStock, currentSales),
      priorStock,
      priorSales,
      priorWeeks: calcStockWeeks(priorStock, priorSales),
    };
  }, [coreProducts, daysInMonth]);

  // 아울렛 합계 계산
  const outletTotals = useMemo(() => {
    const currentStock = outletProducts.reduce((sum, p) => sum + p.current.stock_amt, 0);
    const currentSales = outletProducts.reduce((sum, p) => sum + p.current.sales_amt, 0);
    const priorStock = outletProducts.reduce((sum, p) => sum + p.prior.stock_amt, 0);
    const priorSales = outletProducts.reduce((sum, p) => sum + p.prior.sales_amt, 0);
    
    return {
      currentStock,
      currentSales,
      currentWeeks: calcStockWeeks(currentStock, currentSales),
      priorStock,
      priorSales,
      priorWeeks: calcStockWeeks(priorStock, priorSales),
    };
  }, [outletProducts, daysInMonth]);

  // 모든 상품 (주력 + 아울렛)
  const allProducts = [...coreProducts, ...outletProducts];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[95vw] max-w-7xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800">
              {dealer.account_nm_en} ({dealer.account_id})
            </h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>prdt_scs_cd 단위 상세</span>
              <span className="text-gray-400 text-xs">prdt_scs_cd 单位详细</span>
              <span>|</span>
              <span>주력 {coreProducts.length}개 · 아울렛 {outletProducts.length}개 품목</span>
              <span className="text-gray-400 text-xs">主力 {coreProducts.length}个 · 奥莱 {outletProducts.length}个商品</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-light">×</button>
        </div>

        {/* 테이블 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-indigo-50 border-b border-indigo-200">
              <tr>
                <th className="text-left py-2 px-2 font-medium text-indigo-700" rowSpan={2}>prdt_scs_cd</th>
                <th className="text-left py-2 px-2 font-medium text-indigo-700" rowSpan={2}>품명</th>
                <th className="text-center py-2 px-2 font-medium text-indigo-700 border-l border-indigo-200" colSpan={4}>
                  <div className="flex flex-col items-center">
                    <span>주력상품</span>
                    <span className="text-gray-300 text-[10px] font-normal">主力商品</span>
                  </div>
                </th>
                <th className="text-center py-2 px-2 font-medium text-indigo-700 border-l border-indigo-200" colSpan={4}>
                  <div className="flex flex-col items-center">
                    <span>아울렛상품</span>
                    <span className="text-gray-300 text-[10px] font-normal">奥莱商品</span>
                  </div>
                </th>
                <th className="text-center py-2 px-2 font-medium text-indigo-700 border-l border-indigo-200" colSpan={6}>
                  YOY
                </th>
              </tr>
              <tr>
                {/* 주력상품 */}
                <th className="text-right py-2 px-2 font-medium text-indigo-700 border-l border-indigo-200">
                  <div className="flex flex-col items-end">
                    <span>기말재고(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">期末库存(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>판매매출(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">零售额(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>당년주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">今年wc</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>전년주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">去年wc</span>
                  </div>
                </th>
                
                {/* 아울렛상품 */}
                <th className="text-right py-2 px-2 font-medium text-indigo-700 border-l border-indigo-200">
                  <div className="flex flex-col items-end">
                    <span>기말재고(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">期末库存(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>판매매출(K)</span>
                    <span className="text-gray-300 text-[10px] font-normal">零售额(K)</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>당년주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">今年wc</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>전년주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">去年wc</span>
                  </div>
                </th>
                
                {/* YOY */}
                <th className="text-right py-2 px-2 font-medium text-indigo-700 border-l border-indigo-200">
                  <div className="flex flex-col items-end">
                    <span>주력재고</span>
                    <span className="text-gray-300 text-[10px] font-normal">主力库存</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>아울렛재고</span>
                    <span className="text-gray-300 text-[10px] font-normal">奥莱库存</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>주력매출</span>
                    <span className="text-gray-300 text-[10px] font-normal">主力零售</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>아울렛매출</span>
                    <span className="text-gray-300 text-[10px] font-normal">奥莱零售</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>주력주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">主力wc</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-medium text-indigo-700">
                  <div className="flex flex-col items-end">
                    <span>아울렛주수</span>
                    <span className="text-gray-300 text-[10px] font-normal">奥莱wc</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {allProducts.length === 0 ? (
                <tr><td colSpan={16} className="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>
              ) : (
                <>
                  {/* 합계 행 */}
                  <tr className="bg-yellow-50 border-b-2 border-yellow-300 font-bold">
                    <td className="py-2 px-2 text-gray-800" colSpan={2}>합계</td>
                    
                    {/* 주력 합계 */}
                    <td className="text-right py-2 px-2 text-gray-900 border-l border-yellow-300">{formatAmountK(coreTotals.currentStock)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(coreTotals.currentSales)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatStockWeeks(coreTotals.currentWeeks)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatStockWeeks(coreTotals.priorWeeks)}</td>
                    
                    {/* 아울렛 합계 */}
                    <td className="text-right py-2 px-2 text-gray-900 border-l border-yellow-300">{formatAmountK(outletTotals.currentStock)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(outletTotals.currentSales)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatStockWeeks(outletTotals.currentWeeks)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatStockWeeks(outletTotals.priorWeeks)}</td>
                    
                    {/* YOY */}
                    <td className="text-right py-2 px-2 text-gray-900 border-l border-yellow-300">{formatYoyPercent(coreTotals.currentStock, coreTotals.priorStock)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatYoyPercent(outletTotals.currentStock, outletTotals.priorStock)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatYoyPercent(coreTotals.currentSales, coreTotals.priorSales)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatYoyPercent(outletTotals.currentSales, outletTotals.priorSales)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatYoyWeeks(coreTotals.currentWeeks, coreTotals.priorWeeks)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatYoyWeeks(outletTotals.currentWeeks, outletTotals.priorWeeks)}</td>
                  </tr>
                  
                  {/* 상품 목록 */}
                  {allProducts.map((product, idx) => {
                    const isCore = product.segment === 'core';
                    const coreData = isCore ? product : { current: { stock_amt: 0, sales_amt: 0, stock_weeks: null }, prior: { stock_amt: 0, sales_amt: 0, stock_weeks: null } };
                    const outletData = !isCore ? product : { current: { stock_amt: 0, sales_amt: 0, stock_weeks: null }, prior: { stock_amt: 0, sales_amt: 0, stock_weeks: null } };
                    
                    return (
                      <tr key={product.prdt_scs_cd + idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-2 font-mono text-xs text-gray-700">{product.prdt_scs_cd}</td>
                        <td className="py-2 px-2 text-gray-700 max-w-[200px] truncate" title={product.prdt_nm_cn}>{product.prdt_nm_cn}</td>
                        
                        {/* 주력상품 데이터 */}
                        <td className="text-right py-2 px-2 text-gray-900 border-l border-gray-200">{isCore ? formatAmountK(coreData.current.stock_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{isCore ? formatAmountK(coreData.current.sales_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{isCore ? formatStockWeeks(coreData.current.stock_weeks) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{isCore ? formatStockWeeks(coreData.prior.stock_weeks) : '-'}</td>
                        
                        {/* 아울렛상품 데이터 */}
                        <td className="text-right py-2 px-2 text-gray-900 border-l border-gray-200">{!isCore ? formatAmountK(outletData.current.stock_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{!isCore ? formatAmountK(outletData.current.sales_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{!isCore ? formatStockWeeks(outletData.current.stock_weeks) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{!isCore ? formatStockWeeks(outletData.prior.stock_weeks) : '-'}</td>
                        
                        {/* YOY 데이터 */}
                        <td className="text-right py-2 px-2 text-gray-900 border-l border-gray-200">{isCore ? formatYoyPercent(product.current.stock_amt, product.prior.stock_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{!isCore ? formatYoyPercent(product.current.stock_amt, product.prior.stock_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{isCore ? formatYoyPercent(product.current.sales_amt, product.prior.sales_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{!isCore ? formatYoyPercent(product.current.sales_amt, product.prior.sales_amt) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{isCore ? formatYoyWeeks(product.current.stock_weeks, product.prior.stock_weeks) : '-'}</td>
                        <td className="text-right py-2 px-2 text-gray-900">{!isCore ? formatYoyWeeks(product.current.stock_weeks, product.prior.stock_weeks) : '-'}</td>
                      </tr>
                    );
                  })}
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

// 카테고리 옵션
const CATEGORY_OPTIONS = [
  { value: 'all', label: '전체', secondary: 'Total' },
  { value: 'shoes', label: '신발', secondary: 'Shoes' },
  { value: 'headwear', label: '모자', secondary: 'Headwear' },
  { value: 'bag', label: '가방', secondary: 'Bag' },
  { value: 'acc_etc', label: '기타', secondary: 'Acc_etc' },
];

export default function DealerCoreOutletAnalysis({
  brand,
}: DealerCoreOutletAnalysisProps) {
  console.log('[DealerCoreOutlet] Component rendered/mounted with brand:', brand);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("202511"); // YYYYMM 형식
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  
  // 정렬 상태
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<DealerData | null>(null);

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
    
    try {
      const params = new URLSearchParams({
        brand: brandCode,
        baseMonth: selectedMonth,
        category: selectedCategory,
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
  }, [brandCode, selectedMonth, selectedCategory]);

  useEffect(() => {
    console.log('[DealerCoreOutlet] useEffect triggered:', { selectedMonth, brandCode, selectedCategory });
    if (selectedMonth) {
      fetchData();
    } else {
      console.log('[DealerCoreOutlet] selectedMonth is empty, not fetching');
    }
  }, [fetchData, selectedMonth, brandCode, selectedCategory]);

  // 정렬 핸들러
  const handleSort = (field: string) => {
    if (sortField === field) {
      // 같은 필드 클릭 시 방향 전환
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // 새로운 필드 클릭 시 내림차순으로 시작
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // 정렬 아이콘 표시
  const renderSortIcon = (field: string) => {
    if (sortField !== field) {
      return <span className="text-gray-400 ml-1">▼</span>;
    }
    return (
      <span className="ml-1">
        {sortDirection === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  // 정렬된 대리상 데이터
  const sortedDealers = useMemo(() => {
    if (!data || !sortField) return data?.dealers || [];
    
    const dealers = [...data.dealers];
    
    dealers.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      
      // 대리상명으로 정렬
      if (sortField === 'dealer_name') {
        aVal = a.account_nm_en;
        bVal = b.account_nm_en;
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      // 주력상품/아울렛상품 공통 데이터로 정렬
      const segment = sortField.startsWith('core_') ? 'core' : 'outlet';
      const field = sortField.replace(/^(core_|outlet_)/, '');
      
      if (field === 'stock_amt') {
        aVal = a.current[segment].stock_amt;
        bVal = b.current[segment].stock_amt;
      } else if (field === 'sales_amt') {
        aVal = a.current[segment].sales_amt;
        bVal = b.current[segment].sales_amt;
      } else if (field === 'current_stock_weeks') {
        aVal = a.current[segment].stock_weeks ?? -1;
        bVal = b.current[segment].stock_weeks ?? -1;
      } else if (field === 'prior_stock_weeks') {
        aVal = a.prior[segment].stock_weeks ?? -1;
        bVal = b.prior[segment].stock_weeks ?? -1;
      }
      
      return sortDirection === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });
    
    return dealers;
  }, [data, sortField, sortDirection]);

  const handleDealerClick = (dealer: DealerData) => {
    setSelectedDealer(dealer);
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
        titleExtra={
          <span className="text-gray-400 text-sm font-normal">
            FRS 主力/奥莱商品 分析
          </span>
        }
        defaultOpen={false}
      >
        {/* 카테고리 탭 */}
        <div className="mb-4 flex items-center gap-2 border-b border-gray-200">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setSelectedCategory(option.value);
                setSortField(null); // 카테고리 변경 시 정렬 초기화
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                selectedCategory === option.value
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <BilingualLabel 
                primary={option.label} 
                secondary={option.secondary}
                align="center"
              />
            </button>
          ))}
        </div>

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
          
          <div className="text-xs text-gray-600 text-right">
            <div className="flex flex-col items-end gap-0.5">
              <span>FR 기준 ｜ Tag 금액 기준 ｜ prdt_scs_cd 단위</span>
              <span className="text-gray-400 text-[10px]">FR ｜ Tag 金额为基准 ｜ prdt_scs_cd 单位</span>
            </div>
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
            {/* 병렬 구조 테이블: 주력 + 아울렛 병렬 */}
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-indigo-50">
                <tr className="border-b border-indigo-100">
                  <th className="text-left py-2 px-2 font-medium text-indigo-700" rowSpan={2} style={{ width: '200px' }}>
                    <BilingualLabel primary="대리상" secondary="FR" align="left" />
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200" colSpan={4} style={{ width: '320px' }}>
                    <BilingualLabel primary="주력상품" secondary="主力商品" align="center" />
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200" colSpan={4} style={{ width: '320px' }}>
                    <BilingualLabel primary="아울렛상품" secondary="奥莱商品" align="center" />
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200" colSpan={6} style={{ width: '420px' }}>
                    YOY
                  </th>
                </tr>
                <tr className="border-b border-indigo-100">
                  {/* 주력상품 헤더 */}
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('core_stock_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>기말재고(K){renderSortIcon('core_stock_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">期末库存(K)</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('core_sales_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>판매매출(K){renderSortIcon('core_sales_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">零售额(K)</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('core_current_stock_weeks')}
                  >
                    <div className="flex flex-col items-end">
                      <span>당년주수{renderSortIcon('core_current_stock_weeks')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">当年weekcover</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('core_prior_stock_weeks')}
                  >
                    <div className="flex flex-col items-end">
                      <span>전년주수{renderSortIcon('core_prior_stock_weeks')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">上年weekcover</span>
                    </div>
                  </th>
                  
                  {/* 아울렛상품 헤더 */}
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('outlet_stock_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>기말재고(K){renderSortIcon('outlet_stock_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">期末库存(K)</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('outlet_sales_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>판매매출(K){renderSortIcon('outlet_sales_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">零售额(K)</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('outlet_current_stock_weeks')}
                  >
                    <div className="flex flex-col items-end">
                      <span>당년주수{renderSortIcon('outlet_current_stock_weeks')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">当年weekcover</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '80px' }}
                    onClick={() => handleSort('outlet_prior_stock_weeks')}
                  >
                    <div className="flex flex-col items-end">
                      <span>전년주수{renderSortIcon('outlet_prior_stock_weeks')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">上年weekcover</span>
                    </div>
                  </th>
                  
                  {/* YOY 헤더 */}
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 border-l border-indigo-200 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '70px' }}
                    onClick={() => handleSort('core_stock_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>주력재고{renderSortIcon('core_stock_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">主力库存</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '70px' }}
                    onClick={() => handleSort('outlet_stock_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>아울렛재고{renderSortIcon('outlet_stock_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">奥莱库存</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '70px' }}
                    onClick={() => handleSort('core_sales_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>주력매출{renderSortIcon('core_sales_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">主力零售</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '70px' }}
                    onClick={() => handleSort('outlet_sales_amt')}
                  >
                    <div className="flex flex-col items-end">
                      <span>아울렛매출{renderSortIcon('outlet_sales_amt')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">奥莱零售</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '70px' }}
                    onClick={() => handleSort('core_current_stock_weeks')}
                  >
                    <div className="flex flex-col items-end">
                      <span>주력주수{renderSortIcon('core_current_stock_weeks')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">主力weekcover</span>
                    </div>
                  </th>
                  <th 
                    className="text-right py-2 px-3 font-medium text-indigo-700 cursor-pointer hover:bg-indigo-100 select-none" 
                    style={{ width: '70px' }}
                    onClick={() => handleSort('outlet_current_stock_weeks')}
                  >
                    <div className="flex flex-col items-end">
                      <span>아울렛주수{renderSortIcon('outlet_current_stock_weeks')}</span>
                      <span className="text-gray-400 text-[11px] leading-tight">奥莱weekcover</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.dealers.length === 0 ? (
                  <tr><td colSpan={15} className="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>
                ) : (
                  <>
                    {/* 전체 합계 행 */}
                    {totals && (
                      <tr className="border-b-2 border-yellow-300 bg-yellow-50 font-bold">
                        <td className="py-2 px-2 text-gray-800 bg-yellow-50" style={{ width: '200px' }}>전체 합계</td>
                        
                        {/* 주력상품 데이터 */}
                        <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300 bg-yellow-50" style={{ width: '80px' }}>{formatAmountK(totals.current_stock_core)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '80px' }}>{formatAmountK(totals.current_sales_core)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '80px' }}>{formatStockWeeks(totals.current_stock_weeks_core)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '80px' }}>{formatStockWeeks(totals.prior_stock_weeks_core)}</td>
                        
                        {/* 아울렛상품 데이터 */}
                        <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300 bg-yellow-50" style={{ width: '80px' }}>{formatAmountK(totals.current_stock_outlet)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '80px' }}>{formatAmountK(totals.current_sales_outlet)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '80px' }}>{formatStockWeeks(totals.current_stock_weeks_outlet)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '80px' }}>{formatStockWeeks(totals.prior_stock_weeks_outlet)}</td>
                        
                        {/* YOY 데이터 */}
                        <td className="text-right py-2 px-3 text-gray-900 border-l border-yellow-300 bg-yellow-50" style={{ width: '70px' }}>{formatYoyPercent(totals.current_stock_core, totals.prior_stock_core)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '70px' }}>{formatYoyPercent(totals.current_stock_outlet, totals.prior_stock_outlet)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '70px' }}>{formatYoyPercent(totals.current_sales_core, totals.prior_sales_core)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '70px' }}>{formatYoyPercent(totals.current_sales_outlet, totals.prior_sales_outlet)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '70px' }}>{formatYoyWeeks(totals.current_stock_weeks_core, totals.prior_stock_weeks_core)}</td>
                        <td className="text-right py-2 px-3 text-gray-900 bg-yellow-50" style={{ width: '70px' }}>{formatYoyWeeks(totals.current_stock_weeks_outlet, totals.prior_stock_weeks_outlet)}</td>
                          </tr>
                    )}
                    
                    {/* 모든 대리상 행 */}
                    {sortedDealers.map((dealer) => (
                        <tr
                          key={dealer.account_id}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => handleDealerClick(dealer)}
                        >
                        <td className="py-2 px-2" style={{ width: '200px' }}>
                            <div className="font-medium text-gray-800">{dealer.account_nm_en}</div>
                            <div className="text-xs text-gray-500">
                              {dealer.account_id} · {dealer.account_nm_kr}
                            </div>
                          </td>
                        
                        {/* 주력상품 데이터 */}
                        <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200" style={{ width: '80px' }}>{formatAmountK(dealer.current.core.stock_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '80px' }}>{formatAmountK(dealer.current.core.sales_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '80px' }}>{formatStockWeeks(dealer.current.core.stock_weeks)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '80px' }}>{formatStockWeeks(dealer.prior.core.stock_weeks)}</td>
                        
                        {/* 아울렛상품 데이터 */}
                        <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200" style={{ width: '80px' }}>{formatAmountK(dealer.current.outlet.stock_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '80px' }}>{formatAmountK(dealer.current.outlet.sales_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '80px' }}>{formatStockWeeks(dealer.current.outlet.stock_weeks)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '80px' }}>{formatStockWeeks(dealer.prior.outlet.stock_weeks)}</td>
                        
                        {/* YOY 데이터 */}
                        <td className="text-right py-2 px-3 text-gray-900 border-l border-gray-200" style={{ width: '70px' }}>{formatYoyPercent(dealer.current.core.stock_amt, dealer.prior.core.stock_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '70px' }}>{formatYoyPercent(dealer.current.outlet.stock_amt, dealer.prior.outlet.stock_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '70px' }}>{formatYoyPercent(dealer.current.core.sales_amt, dealer.prior.core.sales_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '70px' }}>{formatYoyPercent(dealer.current.outlet.sales_amt, dealer.prior.outlet.sales_amt)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '70px' }}>{formatYoyWeeks(dealer.current.core.stock_weeks, dealer.prior.core.stock_weeks)}</td>
                        <td className="text-right py-2 px-3 text-gray-900" style={{ width: '70px' }}>{formatYoyWeeks(dealer.current.outlet.stock_weeks, dealer.prior.outlet.stock_weeks)}</td>
                          </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && !data && (
          <div className="text-center py-12 text-gray-500">선택한 조건에 해당하는 데이터가 없습니다.</div>
        )}
      </CollapsibleSection>

      {/* 상품 상세 모달 */}
      {selectedDealer && data && (
        <DealerDetailModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setSelectedDealer(null);
          }}
          dealer={selectedDealer}
          products={getProductsForDealer(selectedDealer.account_id)}
          baseMonth={data.meta.baseMonth}
          priorMonth={data.meta.priorMonth}
        />
      )}
    </div>
  );
}

