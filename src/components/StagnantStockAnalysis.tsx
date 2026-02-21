"use client";

import { useState, useEffect, useCallback } from "react";
import type { Brand } from "@/types/sales";
import type {
  StagnantStockResponse,
  DimensionTab,
  SummaryBoxData,
  DetailTableData,
  StagnantStockItem,
  SortConfig,
  SortKey,
  MidCategory,
  StagnantChannelTab,
  CategorySummary,
} from "@/types/stagnantStock";
import { DIMENSION_TABS, BRAND_CODE_MAP, STAGNANT_CHANNEL_TABS } from "@/types/stagnantStock";
import CollapsibleSection from "./CollapsibleSection";
import StagnantStockDetailModal from "./StagnantStockDetailModal";
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";

// 아이템 필터 탭 타입
type ItemFilterTab = "ACC합계" | "신발" | "모자" | "가방" | "기타";

interface StagnantStockAnalysisProps {
  brand: Brand;
  dimensionTab?: DimensionTab;
  onDimensionTabChange?: (tab: DimensionTab) => void;
  thresholdPct?: number;
  onThresholdPctChange?: (pct: number) => void;
  minQty?: number;  // 최소 수량 기준 (정체재고 판단용) - 전월말 기준
  onMinQtyChange?: (qty: number) => void;
  currentMonthMinQty?: number;  // 당월수량 기준 (당월수량미달 판단용)
  onCurrentMonthMinQtyChange?: (qty: number) => void;
  itemTab?: ItemFilterTab;
  onItemTabChange?: (tab: ItemFilterTab) => void;
}

// 숫자 포맷팅 함수
function formatNumber(num: number): string {
  return num.toLocaleString("ko-KR");
}

function formatPercent(num: number, decimals: number = 2): string {
  return num.toFixed(decimals) + "%";
}

// 상단 요약 카드용: M 단위, 정수 반올림, 천단위 콤마 (예: 2,888M)
function formatAmountM(num: number): string {
  const mValue = Math.round(num / 1000000);
  return mValue.toLocaleString("ko-KR") + "M";
}

// 상세 테이블용: K 단위, 정수 반올림, 천단위 콤마 (예: 335,110K)
function formatAmountK(num: number): string {
  const kValue = Math.round(num / 1000);
  return kValue.toLocaleString("ko-KR") + "K";
}

// 기존 함수 유지 (다른 곳에서 사용될 수 있음)
function formatAmount(num: number): string {
  // 백만 단위로 표시
  return (num / 1000000).toFixed(2) + "M";
}

// 요약 박스 컴포넌트
function SummaryBox({ data, isTotal = false }: { data: SummaryBoxData; isTotal?: boolean }) {
  const bgColor = isTotal 
    ? "bg-gray-50" 
    : data.title === "정체재고" 
      ? "bg-red-50" 
      : data.title === "당월수량미달"
        ? "bg-yellow-50"
        : "bg-green-50";
  
  const borderColor = isTotal
    ? "border-gray-200"
    : data.title === "정체재고"
      ? "border-red-200"
      : data.title === "당월수량미달"
        ? "border-yellow-200"
        : "border-green-200";

  const titleColor = isTotal
    ? "text-gray-800"
    : data.title === "정체재고"
      ? "text-red-700"
      : data.title === "당월수량미달"
        ? "text-yellow-700"
        : "text-green-700";

  // 카테고리 순서: 전체, 신발, 모자, 가방, 기타
  const categoryOrder = ["전체", "신발", "모자", "가방", "기타"];
  const sortedCategories = categoryOrder
    .map(name => data.categories.find(c => c.category === name))
    .filter(Boolean);

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-4`}>
      <h4 className={`text-lg font-bold ${titleColor} mb-3`}>{data.title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 px-2 font-medium text-gray-600">구분</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">재고금액</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">%</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">재고수량</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">품번수</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">매출금액</th>
            </tr>
          </thead>
          <tbody>
            {sortedCategories.map((cat, idx) => (
              <tr 
                key={cat!.category} 
                className={`${idx < sortedCategories.length - 1 ? "border-b border-gray-200" : ""} ${cat!.category === "전체" ? "font-semibold bg-white/50" : ""}`}
              >
                <td className="py-2 px-2 text-gray-700">{cat!.category}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatAmountM(cat!.stock_amt)}</td>
                <td className="text-right py-2 px-2 text-gray-600">{formatPercent(cat!.stock_amt_pct, 1)}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatNumber(cat!.stock_qty)}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatNumber(cat!.item_count)}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatAmountM(cat!.sales_tag_amt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 전체재고 합계(체크용) 테이블 컴포넌트
function CheckSummaryTable({ 
  data,
  dimensionTab,
  channelTab,
  getChannelData,
}: { 
  data: StagnantStockResponse;
  dimensionTab: DimensionTab;
  channelTab: StagnantChannelTab;
  getChannelData: (item: StagnantStockItem, channel: StagnantChannelTab) => { stock_amt: number; stock_qty: number; sales_amt: number };
}) {
  const [isOpen, setIsOpen] = useState(false); // 기본 접힌 상태

  // 5개 상세 테이블의 모든 아이템을 합침
  const allItems = [
    ...(data.stagnantDetail?.items || []),
    ...(data.currentSeasonDetail?.items || []),
    ...(data.nextSeasonDetail?.items || []),
    ...(data.pastSeasonDetail?.items || []),
    ...(data.lowStockDetail?.items || []),
  ];

  // 채널 필터링: 해당 채널에 재고가 있는 아이템만
  const filteredItems = channelTab === "전체" 
    ? allItems 
    : allItems.filter(item => getChannelData(item, channelTab).stock_amt > 0);

  // 전체 합계 계산 (채널 기준)
  const totalStock = filteredItems.reduce((acc, item) => {
    const channelData = getChannelData(item, channelTab);
    return {
      stock_qty: acc.stock_qty + channelData.stock_qty,
      stock_amt: acc.stock_amt + channelData.stock_amt,
      sales_tag_amt: acc.sales_tag_amt + channelData.sales_amt,
    };
  }, { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 });

  // 중분류별 합계 계산 (채널 기준)
  const categories = ["신발", "모자", "가방", "기타"];
  const categoryTotals = categories.map(cat => {
    const catItems = filteredItems.filter(item => item.mid_category_kr === cat);
    let stock_qty = 0;
    let stock_amt = 0;
    let sales_tag_amt = 0;
    
    catItems.forEach(item => {
      const channelData = getChannelData(item, channelTab);
      stock_qty += channelData.stock_qty;
      stock_amt += channelData.stock_amt;
      sales_tag_amt += channelData.sales_amt;
    });
    
    return {
      category: cat,
      stock_qty,
      stock_amt,
      sales_tag_amt,
      ratio: stock_amt > 0 ? (sales_tag_amt / stock_amt) * 100 : 0,
      item_count: catItems.length,
    };
  });

  // 전체 비율 계산
  const totalRatio = totalStock.stock_amt > 0 
    ? (totalStock.sales_tag_amt / totalStock.stock_amt) * 100 
    : 0;

  // 품번 컬럼 헤더
  const dimensionLabel = dimensionTab === "스타일" ? "품번" 
    : dimensionTab === "컬러" ? "품번_컬러"
    : dimensionTab === "사이즈" ? "품번_사이즈"
    : "품번_컬러_사이즈";

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-100 overflow-hidden mb-4">
      {/* 토글 헤더 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 bg-gray-200 hover:bg-gray-300 transition-colors flex items-center gap-2 text-left"
      >
        <span className={`text-gray-600 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>
          ▶
        </span>
        <h4 className="text-md font-bold text-gray-700">
          🔍 전체재고 합계 (5개 내역 합계 체크용)
        </h4>
        <span className="text-xs text-gray-500 ml-2">
          {isOpen ? "접기" : "펼치기"}
        </span>
      </button>
      
      {/* 토글 콘텐츠 */}
      {isOpen && (
        <>
          <div className="overflow-x-auto border-t border-gray-300">
            <table className="w-full text-sm">
              <thead className="bg-gray-200">
                <tr className="border-b border-gray-300">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">중분류</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600">{dimensionLabel}</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600">품명</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600">시즌</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">재고수량</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">재고금액</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">매출금액</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">비율</th>
                  <th className="text-center py-2 px-2 font-medium text-gray-600">상태</th>
                </tr>
              </thead>
              <tbody>
                {/* 전체 합계 행 */}
                <tr className="bg-white font-semibold border-b border-gray-300">
                  <td className="py-2 px-2 text-gray-800">(Total)</td>
                  <td className="py-2 px-2 text-gray-500">-</td>
                  <td className="py-2 px-2 text-gray-500">-</td>
                  <td className="py-2 px-2 text-gray-500">-</td>
                  <td className="text-right py-2 px-2 text-gray-900">{formatNumber(totalStock.stock_qty)}</td>
                  <td className="text-right py-2 px-2 text-gray-900">{formatAmount(totalStock.stock_amt)}</td>
                  <td className="text-right py-2 px-2 text-gray-900">{formatAmount(totalStock.sales_tag_amt)}</td>
                  <td className="text-right py-2 px-2 text-gray-700">{formatPercent(totalRatio, 2)}</td>
                  <td className="text-center py-2 px-2 text-gray-500">-</td>
                </tr>
                {/* 중분류별 합계 행 */}
                {categoryTotals.map((cat, idx) => (
                  <tr 
                    key={cat.category} 
                    className={`bg-white/70 ${idx < categoryTotals.length - 1 ? "border-b border-gray-200" : ""}`}
                  >
                    <td className="py-2 px-2 text-gray-700">{cat.category}</td>
                    <td className="py-2 px-2 text-gray-500">-</td>
                    <td className="py-2 px-2 text-gray-500">-</td>
                    <td className="py-2 px-2 text-gray-500">-</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatNumber(cat.stock_qty)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatAmount(cat.stock_amt)}</td>
                    <td className="text-right py-2 px-2 text-gray-900">{formatAmount(cat.sales_tag_amt)}</td>
                    <td className="text-right py-2 px-2 text-gray-700">{formatPercent(cat.ratio, 2)}</td>
                    <td className="text-center py-2 px-2 text-gray-500">-</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 안내 문구 */}
          <div className="p-2 bg-gray-200 text-xs text-gray-600 border-t border-gray-300">
            ※ 위 합계가 상단 "전체 재고" 카드의 값과 일치해야 합니다. (4개 상세 테이블 합계 = 전체 재고)
          </div>
        </>
      )}
    </div>
  );
}

// 상세 테이블 컴포넌트
// 월의 일수 계산 함수
function getDaysInMonth(yyyymm: string): number {
  if (yyyymm.length !== 6) return 30;
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return new Date(year, month, 0).getDate();
}

// 재고주수 계산 함수 (정수 반올림 + 천단위 콤마 + "주")
function calcStockWeeks(stockAmt: number, salesAmt: number, daysInMonth: number): string {
  if (salesAmt <= 0) return "판매0";
  const weekSales = (salesAmt / daysInMonth) * 7;
  if (weekSales <= 0) return "판매0";
  const weeks = Math.round(stockAmt / weekSales);
  return weeks.toLocaleString("ko-KR") + "주";
}

function DetailTable({
  data,
  dimensionTab,
  sortConfig,
  onSort,
  targetMonth,
  channelTab,
  getChannelData,
  totalItemCount,
  totalStockAmt,
  onItemClick,
  thresholdPct,
  categoryStockAmtMap,
}: {
  data: DetailTableData;
  dimensionTab: DimensionTab;
  sortConfig: SortConfig;
  onSort: (key: SortKey) => void;
  targetMonth: string;
  channelTab: StagnantChannelTab;
  getChannelData: (item: StagnantStockItem, channel: StagnantChannelTab) => { stock_amt: number; stock_qty: number; sales_amt: number };
  totalItemCount: number;  // 전체 품번 수 (4개 테이블 합계)
  totalStockAmt: number;   // 전체 재고 금액
  onItemClick?: (item: StagnantStockItem) => void;  // 품번 클릭 핸들러
  thresholdPct?: number;  // 정체재고 기준 % (정체재고 테이블만 사용)
  categoryStockAmtMap?: Map<string, number>;  // 중분류별 전체 재고금액 (정체재고 기준 계산용)
}) {
  const daysInMonth = getDaysInMonth(targetMonth);

  // 채널별 재고주수 계산 함수
  const calcChannelStockWeeks = (item: StagnantStockItem): string => {
    const channelData = getChannelData(item, channelTab);
    if (channelData.sales_amt <= 0) return "판매0";
    const weekSales = (channelData.sales_amt / daysInMonth) * 7;
    if (weekSales <= 0) return "판매0";
    const weeks = Math.round(channelData.stock_amt / weekSales);
    return weeks.toLocaleString("ko-KR") + "주";
  };

  const bgColor = data.seasonGroup === "정체재고" 
    ? "bg-red-50" 
    : data.seasonGroup === "당시즌"
      ? "bg-blue-50"
      : data.seasonGroup === "차기시즌"
        ? "bg-purple-50"
        : "bg-amber-50";

  const borderColor = data.seasonGroup === "정체재고"
    ? "border-red-200"
    : data.seasonGroup === "당시즌"
      ? "border-blue-200"
      : data.seasonGroup === "차기시즌"
        ? "border-purple-200"
        : "border-amber-200";

  const titleColor = data.seasonGroup === "정체재고"
    ? "text-red-700"
    : data.seasonGroup === "당시즌"
      ? "text-blue-700"
      : data.seasonGroup === "차기시즌"
        ? "text-purple-700"
        : "text-amber-700";

  // 재고주수 계산 함수 (숫자 반환 - 정렬용)
  const calcStockWeeksNum = (item: StagnantStockItem): number => {
    const channelData = getChannelData(item, channelTab);
    if (channelData.sales_amt <= 0) return Infinity; // 판매0은 맨 뒤로
    const weekSales = (channelData.sales_amt / daysInMonth) * 7;
    if (weekSales <= 0) return Infinity;
    return channelData.stock_amt / weekSales;
  };

  // 정렬된 아이템
  const sortedItems = [...data.items].sort((a, b) => {
    // stockWeeks는 계산값이므로 별도 처리
    if (sortConfig.key === "stockWeeks") {
      const aVal = calcStockWeeksNum(a);
      const bVal = calcStockWeeksNum(b);
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    }
    
    const aVal = a[sortConfig.key as keyof StagnantStockItem];
    const bVal = b[sortConfig.key as keyof StagnantStockItem];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortConfig.direction === "asc" 
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  // 정렬 아이콘
  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortConfig.key !== columnKey) {
      return <span className="text-gray-300 ml-1">↕</span>;
    }
    return (
      <span className="text-blue-500 ml-1">
        {sortConfig.direction === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // 품번 컬럼 헤더
  const dimensionLabel = dimensionTab === "스타일" ? "품번" 
    : dimensionTab === "컬러" ? "품번_컬러"
    : dimensionTab === "사이즈" ? "품번_사이즈"
    : "품번_컬러_사이즈";

  // 정체재고 기준금액 표시 (정체재고 테이블만)
  const getThresholdDisplay = () => {
    if (data.seasonGroup !== "정체재고" || !thresholdPct || !categoryStockAmtMap) {
      return "";
    }
    
    const categories = ["신발", "모자", "가방"];
    const thresholds = categories.map(cat => {
      const catStockAmt = categoryStockAmtMap.get(cat) || 0;
      const threshold = catStockAmt * (thresholdPct / 100);
      // K 단위로 표시 (1000으로 나눔)
      const thresholdK = Math.round(threshold / 1000);
      return `${cat} ${thresholdK.toLocaleString("ko-KR")}K미만`;
    });
    
    return ` | ${thresholds.join(", ")}`;
  };

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} overflow-hidden`}>
      <div className="p-3 border-b ${borderColor}">
        <h4 className={`text-md font-bold ${titleColor}`}>
          {data.title === "정체재고 - 전체" ? "정체재고" : data.title} | 전체 {formatNumber(totalItemCount)}개 중 {formatNumber(data.items.length)}개 표시 | 재고 {formatAmountM(data.totalRow.stock_amt)} ({formatAmountM(totalStockAmt)} 중 {totalStockAmt > 0 ? formatPercent((data.totalRow.stock_amt / totalStockAmt) * 100, 1) : "0%"}){getThresholdDisplay()}
        </h4>
      </div>
      
      <div className="overflow-x-auto">
        <div style={{ maxHeight: "280px", overflowY: "auto" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white shadow-sm z-10">
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 px-2 font-medium text-gray-600">중분류</th>
                <th 
                  className="text-left py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("dimensionKey")}
                >
                  {dimensionLabel}
                  <SortIcon columnKey="dimensionKey" />
                </th>
                <th className="text-left py-2 px-2 font-medium text-gray-600">품명</th>
                <th 
                  className="text-left py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("season")}
                >
                  시즌
                  <SortIcon columnKey="season" />
                </th>
                <th 
                  className="text-right py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("stockWeeks")}
                >
                  재고주수
                  <SortIcon columnKey="stockWeeks" />
                </th>
                <th 
                  className="text-right py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("stock_qty")}
                >
                  재고수량
                  <SortIcon columnKey="stock_qty" />
                </th>
                <th 
                  className="text-right py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("stock_amt")}
                >
                  재고금액(K)
                  <SortIcon columnKey="stock_amt" />
                </th>
                <th 
                  className="text-right py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("sales_tag_amt")}
                >
                  매출금액(K)
                  <SortIcon columnKey="sales_tag_amt" />
                </th>
                <th 
                  className="text-right py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort("ratio")}
                >
                  정체율계산
                  <SortIcon columnKey="ratio" />
                </th>
                <th className="text-center py-2 px-2 font-medium text-gray-600">상태</th>
              </tr>
              {/* 합계 행 - 헤더에 고정 (채널별 데이터 사용) */}
              <tr className="bg-gray-100 font-semibold border-b border-gray-300">
                <td className="py-2 px-2 text-gray-700">(Total)</td>
                <td className="py-2 px-2 text-gray-700">{formatNumber(data.items.length)}건</td>
                <td className="py-2 px-2 text-gray-500">-</td>
                <td className="py-2 px-2 text-gray-500">-</td>
                <td className="text-right py-2 px-2 text-gray-900">{calcStockWeeks(data.totalRow.stock_amt, data.totalRow.sales_tag_amt, daysInMonth)}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatNumber(data.totalRow.stock_qty)}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(data.totalRow.stock_amt)}</td>
                <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(data.totalRow.sales_tag_amt)}</td>
                <td className="text-right py-2 px-2 text-gray-500">-</td>
                <td className="text-center py-2 px-2 text-gray-500">-</td>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-gray-500">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                sortedItems.map((item, idx) => {
                  // 채널별 데이터 가져오기
                  const channelData = getChannelData(item, channelTab);
                  return (
                    <tr key={item.dimensionKey + idx} className="border-b border-gray-200 hover:bg-white/50">
                      <td className="py-2 px-2 text-gray-700">{item.mid_category_kr}</td>
                      <td 
                        className="py-2 px-2 text-blue-600 font-mono text-xs cursor-pointer hover:text-blue-800 hover:underline"
                        onClick={() => onItemClick?.(item)}
                        title="클릭하여 상세 정보 보기"
                      >
                        {item.dimensionKey}
                      </td>
                      <td className="py-2 px-2 text-gray-700 max-w-[200px] truncate" title={item.prdt_nm}>
                        {item.prdt_nm}
                      </td>
                      <td className="py-2 px-2 text-gray-700">{item.season}</td>
                      {/* 재고주수: 채널별 데이터로 계산 */}
                      <td className="text-right py-2 px-2 text-gray-900">{calcChannelStockWeeks(item)}</td>
                      {/* 재고수량, 재고금액, 매출금액: 채널별 데이터 */}
                      <td className="text-right py-2 px-2 text-gray-900">{formatNumber(channelData.stock_qty)}</td>
                      <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(channelData.stock_amt)}</td>
                      <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(channelData.sales_amt)}</td>
                      {/* 비율과 상태: 전체 기준 그대로 유지 */}
                      <td className="text-right py-2 px-2 text-gray-700">{formatPercent(item.ratio * 100, 4)}</td>
                      <td className="text-center py-2 px-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          item.status === "정체재고" 
                            ? "bg-red-100 text-red-700" 
                            : "bg-green-100 text-green-700"
                        }`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function StagnantStockAnalysis({ 
  brand, 
  dimensionTab: externalDimensionTab,
  onDimensionTabChange,
  thresholdPct: externalThresholdPct,
  onThresholdPctChange,
  minQty: externalMinQty,
  onMinQtyChange,
  currentMonthMinQty: externalCurrentMonthMinQty,
  onCurrentMonthMinQtyChange,
  itemTab: externalItemTab,
  onItemTabChange,
}: StagnantStockAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StagnantStockResponse | null>(null);
  
  // 컨트롤 상태
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  // 전역 기준월 사용
  const { referenceMonth } = useReferenceMonth();
  // API는 "YYYYMM" 형식을 사용하므로 변환
  const targetMonth = referenceMonth.replace(".", "");
  const [internalThresholdPct, setInternalThresholdPct] = useState<number>(0.01);
  const [internalDimensionTab, setInternalDimensionTab] = useState<DimensionTab>("스타일");
  
  // 외부에서 제어되면 외부 값 사용, 아니면 내부 상태 사용
  const dimensionTab = externalDimensionTab ?? internalDimensionTab;
  const setDimensionTab = (tab: DimensionTab) => {
    if (onDimensionTabChange) {
      onDimensionTabChange(tab);
    } else {
      setInternalDimensionTab(tab);
    }
  };
  
  // thresholdPct도 외부에서 제어되면 외부 값 사용
  const thresholdPct = externalThresholdPct ?? internalThresholdPct;
  const setThresholdPct = (pct: number) => {
    if (onThresholdPctChange) {
      onThresholdPctChange(pct);
    } else {
      setInternalThresholdPct(pct);
    }
  };
  
  // 정렬 상태
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "stock_amt",
    direction: "desc",
  });

  // 아이템 탭 상태 (ACC합계, 신발, 모자, 가방, 기타)
  const [internalItemTab, setInternalItemTab] = useState<ItemFilterTab>("ACC합계");
  const ITEM_FILTER_TABS: ItemFilterTab[] = ["ACC합계", "신발", "모자", "가방", "기타"];
  
  // itemTab도 외부에서 제어되면 외부 값 사용
  const itemTab = externalItemTab ?? internalItemTab;
  const setItemTab = (tab: ItemFilterTab) => {
    if (onItemTabChange) {
      onItemTabChange(tab);
    } else {
      setInternalItemTab(tab);
    }
  };

  // 채널 탭 상태 (전체, FR, OR)
  const [channelTab, setChannelTab] = useState<StagnantChannelTab>("전체");

  // 검색어 상태
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 최소 수량 기준 상태 (기본값 10) - 외부에서 제어 가능 (전월말 기준)
  const [internalMinQty, setInternalMinQty] = useState<number>(10);
  const minQty = externalMinQty ?? internalMinQty;
  const setMinQty = (qty: number) => {
    if (onMinQtyChange) {
      onMinQtyChange(qty);
    } else {
      setInternalMinQty(qty);
    }
  };

  // 당월수량 기준 상태 (기본값 10) - 외부에서 제어 가능
  const [internalCurrentMonthMinQty, setInternalCurrentMonthMinQty] = useState<number>(10);
  const currentMonthMinQty = externalCurrentMonthMinQty ?? internalCurrentMonthMinQty;
  const setCurrentMonthMinQty = (qty: number) => {
    if (onCurrentMonthMinQtyChange) {
      onCurrentMonthMinQtyChange(qty);
    } else {
      setInternalCurrentMonthMinQty(qty);
    }
  };

  // 당월수량미달 요약 박스 표시 상태 (접히는 UI)
  const [isLowStockBoxVisible, setIsLowStockBoxVisible] = useState(false);

  // 품번 상세 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StagnantStockItem | null>(null);

  // 품번 클릭 핸들러
  const handleItemClick = (item: StagnantStockItem) => {
    setSelectedItem(item);
    setModalOpen(true);
  };

  // 시즌 필터 상태 (전체 시즌, 당시즌, 차기시즌, 과시즌, 정체재고, 당월수량미달)
  type SeasonFilterOption = "전체 시즌" | "당시즌" | "차기시즌" | "과시즌" | "정체재고" | "당월수량미달";
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilterOption>("전체 시즌");
  const SEASON_FILTER_OPTIONS: SeasonFilterOption[] = ["전체 시즌", "당시즌", "차기시즌", "과시즌", "정체재고", "당월수량미달"];

  const brandCode = BRAND_CODE_MAP[brand] || "M";

  // 채널별 데이터 접근 헬퍼 함수
  const getChannelData = (item: StagnantStockItem, channel: StagnantChannelTab) => {
    switch (channel) {
      case "FR":
        return {
          stock_amt: item.fr_stock_amt,
          stock_qty: item.fr_stock_qty,
          sales_amt: item.fr_sales_amt,
        };
      case "OR":
        return {
          stock_amt: item.or_stock_amt,
          stock_qty: item.or_stock_qty,
          sales_amt: item.or_sales_amt,
        };
      default: // 전체
        return {
          stock_amt: item.stock_amt,
          stock_qty: item.stock_qty,
          sales_amt: item.sales_tag_amt,
        };
    }
  };

  // 채널별 카테고리 집계 함수
  // categoryTotalStockAmtMap: 각 카테고리별 전체 재고 금액 맵 (아이템별 정체+정상=100% 계산용)
  // totalBaseStockAmt: '전체' 행의 비율 계산용 전체 재고 금액
  const aggregateByCategoryForChannel = (
    items: StagnantStockItem[],
    channel: StagnantChannelTab,
    categoryTotalStockAmtMap?: Map<string, number>,
    totalBaseStockAmt?: number
  ): CategorySummary[] => {
    const categories: MidCategory[] = ["전체", "신발", "모자", "가방", "기타"];
    
    // 전체 재고금액 계산 (채널 기준) - '전체' 행의 비율 계산용
    const totalChannelStockAmt = totalBaseStockAmt ?? items.reduce((sum, item) => {
      const channelData = getChannelData(item, channel);
      return sum + channelData.stock_amt;
    }, 0);
    
    return categories.map(category => {
      const filtered = category === "전체" 
        ? items 
        : items.filter(item => item.mid_category_kr === category);
      
      let stock_amt = 0;
      let stock_qty = 0;
      let sales_tag_amt = 0;
      
      filtered.forEach(item => {
        const channelData = getChannelData(item, channel);
        stock_amt += channelData.stock_amt;
        stock_qty += channelData.stock_qty;
        sales_tag_amt += channelData.sales_amt;
      });
      
      const item_count = new Set(
        filtered.filter(item => getChannelData(item, channel).stock_amt > 0)
          .map(item => item.dimensionKey)
      ).size;
      
      // 비율 계산: '전체' 행은 전체 재고 금액 기준, 개별 카테고리는 해당 카테고리 전체 재고 금액 기준
      let stock_amt_pct = 0;
      if (category === "전체") {
        // '전체' 행: 전체 재고 금액 대비 비율
        stock_amt_pct = totalChannelStockAmt > 0 ? (stock_amt / totalChannelStockAmt) * 100 : 0;
      } else if (categoryTotalStockAmtMap) {
        // 개별 카테고리: 해당 카테고리 전체 재고 금액 대비 비율 (정체+정상=100%)
        const categoryTotal = categoryTotalStockAmtMap.get(category) || 0;
        stock_amt_pct = categoryTotal > 0 ? (stock_amt / categoryTotal) * 100 : 0;
      } else {
        // categoryTotalStockAmtMap이 없으면 전체 재고 금액 대비 비율 (기존 방식)
        stock_amt_pct = totalChannelStockAmt > 0 ? (stock_amt / totalChannelStockAmt) * 100 : 0;
      }
      
      return {
        category,
        stock_amt,
        stock_amt_pct,
        stock_qty,
        item_count,
        sales_tag_amt,
      };
    });
  };

  // 채널별 요약 박스 데이터 생성
  // categoryTotalStockAmtMap: 각 카테고리별 전체 재고 금액 맵 (아이템별 정체+정상=100% 계산용)
  // totalBaseStockAmt: '전체' 행의 비율 계산용 전체 재고 금액
  const createChannelSummaryBox = (
    title: string,
    items: StagnantStockItem[],
    channel: StagnantChannelTab,
    categoryTotalStockAmtMap?: Map<string, number>,
    totalBaseStockAmt?: number
  ): SummaryBoxData => {
    const categories = aggregateByCategoryForChannel(items, channel, categoryTotalStockAmtMap, totalBaseStockAmt);
    const total = categories.find(c => c.category === "전체")!;
    
    return {
      title,
      categories,
      total,
    };
  };

  // 아이템 탭, 채널 탭, 검색어에 따라 상세 테이블 데이터 필터링
  const filterDetailTableByItemAndChannel = (detail: DetailTableData): DetailTableData => {
    let filteredItems = detail.items;
    
    // 아이템 탭 필터링
    if (itemTab !== "ACC합계") {
      filteredItems = filteredItems.filter(item => item.mid_category_kr === itemTab);
    }
    
    // 채널 필터링: 해당 채널에 재고가 있는 아이템만 포함
    if (channelTab !== "전체") {
      filteredItems = filteredItems.filter(item => {
        const channelData = getChannelData(item, channelTab);
        return channelData.stock_amt > 0;
      });
    }
    
    // 검색어 필터링 (품번 또는 품명에 검색어 포함)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filteredItems = filteredItems.filter(item => 
        item.prdt_cd.toLowerCase().includes(query) ||
        item.prdt_nm.toLowerCase().includes(query)
      );
    }
    
    // Total 재계산 (채널 기준)
    let total_stock_qty = 0;
    let total_stock_amt = 0;
    let total_sales_amt = 0;
    
    filteredItems.forEach(item => {
      const channelData = getChannelData(item, channelTab);
      total_stock_qty += channelData.stock_qty;
      total_stock_amt += channelData.stock_amt;
      total_sales_amt += channelData.sales_amt;
    });
    
    return {
      ...detail,
      items: filteredItems,
      totalRow: {
        stock_qty: total_stock_qty,
        stock_amt: total_stock_amt,
        sales_tag_amt: total_sales_amt,
      },
    };
  };

  // 데이터 로드 함수
  const fetchData = useCallback(async () => {
    if (!targetMonth) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        brand: brandCode,
        targetMonth,
        dimensionTab,
        thresholdPct: String(thresholdPct),
        minQty: String(minQty),
        currentMonthMinQty: String(currentMonthMinQty),
      });
      
      const response = await fetch(`/api/stagnant-stock?${params}`);
      
      if (!response.ok) {
        throw new Error("데이터를 불러오는데 실패했습니다.");
      }
      
      const result: StagnantStockResponse = await response.json();
      setData(result);
      
      // 사용 가능한 월 목록 업데이트
      if (result.availableMonths && result.availableMonths.length > 0) {
        setAvailableMonths(result.availableMonths);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [brandCode, targetMonth, dimensionTab, thresholdPct, minQty, currentMonthMinQty]);

  // 초기 월 목록 로드 (전역 기준월 변경 시에도 업데이트)
  useEffect(() => {
    const loadInitialMonths = async () => {
      try {
        const params = new URLSearchParams({
          brand: brandCode,
          targetMonth: targetMonth,
          dimensionTab: "스타일",
          thresholdPct: "0.01",
        });
        
        const response = await fetch(`/api/stagnant-stock?${params}`);
        if (response.ok) {
          const result: StagnantStockResponse = await response.json();
          if (result.availableMonths && result.availableMonths.length > 0) {
            setAvailableMonths(result.availableMonths);
          }
        }
      } catch (err) {
        console.error("Failed to load initial months:", err);
      }
    };
    
    if (targetMonth) {
      loadInitialMonths();
    }
  }, [brandCode, targetMonth]);

  // 조건 변경 시 데이터 재로드 (탭 전환 시 반드시 재계산)
  useEffect(() => {
    if (targetMonth) {
      fetchData();
    }
  }, [fetchData, targetMonth, dimensionTab, thresholdPct, currentMonthMinQty, referenceMonth]);

  // 정렬 핸들러
  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  // 월 포맷팅 (202501 → 2025.01)
  const formatMonth = (ym: string) => {
    if (ym.length !== 6) return ym;
    return `${ym.slice(0, 4)}.${ym.slice(4)}`;
  };

  return (
    <div className="mb-4">
      <CollapsibleSection
        title="(상품단위)정체재고 분석"
        icon="📊"
        iconColor="text-orange-500"
        defaultOpen={false}
        titleExtra={
          <span className="text-gray-400 text-sm font-normal">商品单位</span>
        }
        headerAction={
          <div className="text-xs text-gray-500 text-right">
            <div>25년 기준: 차기 26NSF, 당기 25NSF, 과시즌 = 나머지 | 24년 기준: 차기 25NSF, 당기 24NSF, 과시즌 = 나머지</div>
            <div>정체재고: 과시즌 중 (1) 전월말 수량 ≥ {minQty}개 AND (2) (당월판매 ÷ 중분류 기말재고) {"<"} {thresholdPct}%</div>
          </div>
        }
      >
        {/* 컨트롤 영역 */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex flex-wrap items-end justify-between gap-4">
            {/* 왼쪽: 컨트롤들 */}
            <div className="flex flex-wrap items-end gap-4">
              {/* 기준월 표시 (전역 기준월 사용) */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">기준월</label>
                <div className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 text-gray-700">
                  {formatMonth(targetMonth)}
                </div>
              </div>

              {/* 정체재고 기준 */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">정체재고 기준 (%)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={thresholdPct}
                    onChange={(e) => setThresholdPct(parseFloat(e.target.value) || 0)}
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="range"
                    value={thresholdPct}
                    onChange={(e) => setThresholdPct(parseFloat(e.target.value))}
                    step="0.01"
                    min="0"
                    max="1"
                    className="w-32"
                  />
                </div>
              </div>

              {/* 최소수량 기준 */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">최소수량 (개)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={minQty}
                    onChange={(e) => setMinQty(parseInt(e.target.value, 10) || 0)}
                    step="1"
                    min="0"
                    max="1000"
                    className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">전월말 수량 {"<"} {minQty}개 → 과시즌</span>
                </div>
              </div>

              {/* 채널 탭 */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">채널</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                  {STAGNANT_CHANNEL_TABS.map(tab => (
                    <button
                      key={tab}
                      onClick={() => setChannelTab(tab)}
                      className={`px-3 py-2 text-sm font-medium transition-colors ${
                        channelTab === tab
                          ? "bg-indigo-500 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {tab === "전체" ? "전체(FR+OR+HQ)" : tab === "OR" ? "HQ+OR" : tab}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* 오른쪽: 메타 정보 */}
            <div className="text-xs text-gray-500 text-right self-end">
              기준월: {formatMonth(targetMonth)} | 브랜드: {brand} | 분석단위: {dimensionTab} | 정체기준: {thresholdPct}% | 최소수량: {minQty}개 | 당해연도: 2025 | 차기연도: 2026
            </div>
          </div>
        </div>

        {/* 로딩 상태 */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">데이터 로딩 중...</span>
          </div>
        )}

        {/* 에러 상태 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* 데이터 표시 */}
        {!loading && !error && data && (
          <>
            {/* 요약 박스 3개 + 접히는 4번째 박스 (채널별 집계) */}
            <div className="flex gap-4 mb-6">
              {channelTab === "전체" ? (
                (() => {
                  // 전체 채널: 카테고리별 전체 재고 금액 맵 생성 (아이템별 정체+정상+당월수량미달=100% 계산용)
                  const allItems = [
                    ...(data.stagnantDetail?.items || []),
                    ...(data.currentSeasonDetail?.items || []),
                    ...(data.nextSeasonDetail?.items || []),
                    ...(data.pastSeasonDetail?.items || []),
                    ...(data.lowStockDetail?.items || []),
                  ];
                  
                  const categoryTotalMap = new Map<string, number>();
                  const categories = ["신발", "모자", "가방", "기타"];
                  categories.forEach(cat => {
                    const catItems = allItems.filter(item => item.mid_category_kr === cat);
                    const catTotal = catItems.reduce((sum, item) => sum + item.stock_amt, 0);
                    categoryTotalMap.set(cat, catTotal);
                  });
                  
                  const totalStockAmt = allItems.reduce((sum, item) => sum + item.stock_amt, 0);
                  
                  // 정체재고/정상재고/당월수량미달 요약 데이터를 카테고리별 전체 기준으로 재계산
                  const recalcSummary = (summary: SummaryBoxData | undefined): SummaryBoxData => {
                    if (!summary || !summary.categories) {
                      return {
                        title: summary?.title || "",
                        categories: [],
                        total: { category: "전체", stock_amt: 0, stock_amt_pct: 0, stock_qty: 0, item_count: 0, sales_tag_amt: 0 }
                      };
                    }
                    const newCategories = summary.categories.map(cat => {
                      if (cat.category === "전체") {
                        // '전체' 행은 전체 재고 대비 비율
                        return {
                          ...cat,
                          stock_amt_pct: totalStockAmt > 0 ? (cat.stock_amt / totalStockAmt) * 100 : 0,
                        };
                      } else {
                        // 개별 카테고리는 해당 카테고리 전체 재고 대비 비율
                        const catTotal = categoryTotalMap.get(cat.category) || 0;
                        return {
                          ...cat,
                          stock_amt_pct: catTotal > 0 ? (cat.stock_amt / catTotal) * 100 : 0,
                        };
                      }
                    });
                    return {
                      ...summary,
                      categories: newCategories,
                      total: newCategories.find(c => c.category === "전체")!,
                    };
                  };
                  
                  // 전체재고 요약: 각 아이템을 100%로 표시 (정체+정상+당월수량미달=100%가 맞물리도록)
                  const recalcTotalSummary = (summary: SummaryBoxData | undefined): SummaryBoxData => {
                    if (!summary || !summary.categories) {
                      return {
                        title: summary?.title || "전체 재고",
                        categories: [],
                        total: { category: "전체", stock_amt: 0, stock_amt_pct: 0, stock_qty: 0, item_count: 0, sales_tag_amt: 0 }
                      };
                    }
                    const newCategories = summary.categories.map(cat => ({
                      ...cat,
                      stock_amt_pct: 100,
                    }));
                    return {
                      ...summary,
                      categories: newCategories,
                      total: newCategories.find(c => c.category === "전체")!,
                    };
                  };
                  
                  return (
                    <>
                      <div className="flex-1"><SummaryBox data={recalcTotalSummary(data.totalSummary)} isTotal={true} /></div>
                      <div className="flex-1"><SummaryBox data={recalcSummary(data.stagnantSummary)} /></div>
                      <div className="flex-1"><SummaryBox data={recalcSummary(data.normalSummary)} /></div>
                      {/* 4번째 박스: 당월수량미달 (접히는 UI) */}
                      {isLowStockBoxVisible ? (
                        <div className="flex-1 relative">
                          <SummaryBox data={recalcSummary(data.lowStockSummary)} />
                          <button 
                            onClick={() => setIsLowStockBoxVisible(false)}
                            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-sm"
                            title="접기"
                          >
                            ◀
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setIsLowStockBoxVisible(true)}
                          className="flex items-center justify-center px-2 py-4 rounded-lg border border-yellow-200 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 transition-colors"
                          title="당월수량미달 보기"
                        >
                          <span className="text-sm font-medium writing-vertical">▶ 당월&lt;{currentMonthMinQty}</span>
                        </button>
                      )}
                    </>
                  );
                })()
              ) : (
                (() => {
                  // FR/OR 채널: 카테고리별 전체 재고 금액 맵 생성
                  const allItems = [...(data.stagnantDetail?.items || []), ...(data.currentSeasonDetail?.items || []), ...(data.nextSeasonDetail?.items || []), ...(data.pastSeasonDetail?.items || []), ...(data.lowStockDetail?.items || [])];
                  
                  // 카테고리별 전체 재고 금액 계산 (해당 채널 기준)
                  const categoryTotalMap = new Map<string, number>();
                  const categories = ["신발", "모자", "가방", "기타"];
                  categories.forEach(cat => {
                    const catItems = allItems.filter(item => item.mid_category_kr === cat);
                    const catTotal = catItems.reduce((sum, item) => {
                      const channelData = getChannelData(item, channelTab);
                      return sum + channelData.stock_amt;
                    }, 0);
                    categoryTotalMap.set(cat, catTotal);
                  });
                  
                  const totalChannelStockAmt = allItems.reduce((sum, item) => {
                    const channelData = getChannelData(item, channelTab);
                    return sum + channelData.stock_amt;
                  }, 0);
                  
                  // 전체재고 요약: 각 아이템을 100%로 표시 (정체+정상+당월수량미달=100%가 맞물리도록)
                  const recalcTotalSummaryForChannel = (summary: SummaryBoxData | undefined): SummaryBoxData => {
                    if (!summary || !summary.categories) {
                      return {
                        title: summary?.title || "전체 재고",
                        categories: [],
                        total: { category: "전체", stock_amt: 0, stock_amt_pct: 0, stock_qty: 0, item_count: 0, sales_tag_amt: 0 }
                      };
                    }
                    const newCategories = summary.categories.map(cat => ({
                      ...cat,
                      stock_amt_pct: 100,
                    }));
                    return {
                      ...summary,
                      categories: newCategories,
                      total: newCategories.find(c => c.category === "전체")!,
                    };
                  };
                  
                  return (
                    <>
                      {/* 채널별 요약 박스 생성 */}
                      <div className="flex-1">
                        <SummaryBox 
                          data={recalcTotalSummaryForChannel(createChannelSummaryBox(
                            "전체 재고", 
                            allItems,
                            channelTab
                          ))} 
                          isTotal={true} 
                        />
                      </div>
                      <div className="flex-1">
                        <SummaryBox 
                          data={createChannelSummaryBox(
                            "정체재고", 
                            data.stagnantDetail?.items || [],
                            channelTab,
                            categoryTotalMap,  // 카테고리별 전체 재고 금액 맵
                            totalChannelStockAmt  // '전체' 행 비율 계산용
                          )} 
                        />
                      </div>
                      <div className="flex-1">
                        <SummaryBox 
                          data={createChannelSummaryBox(
                            "정상재고", 
                            [...(data.currentSeasonDetail?.items || []), ...(data.nextSeasonDetail?.items || []), ...(data.pastSeasonDetail?.items || [])],
                            channelTab,
                            categoryTotalMap,  // 카테고리별 전체 재고 금액 맵
                            totalChannelStockAmt  // '전체' 행 비율 계산용
                          )} 
                        />
                      </div>
                      {/* 4번째 박스: 당월수량미달 (접히는 UI) */}
                      {isLowStockBoxVisible ? (
                        <div className="flex-1 relative">
                          <SummaryBox 
                            data={createChannelSummaryBox(
                              "당월수량미달", 
                              data.lowStockDetail?.items || [],
                              channelTab,
                              categoryTotalMap,
                              totalChannelStockAmt
                            )} 
                          />
                          <button 
                            onClick={() => setIsLowStockBoxVisible(false)}
                            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-sm"
                            title="접기"
                          >
                            ◀
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setIsLowStockBoxVisible(true)}
                          className="flex items-center justify-center px-2 py-4 rounded-lg border border-yellow-200 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 transition-colors"
                          title="당월수량미달 보기"
                        >
                          <span className="text-sm font-medium writing-vertical">▶ 당월&lt;{currentMonthMinQty}</span>
                        </button>
                      )}
                    </>
                  );
                })()
              )}
            </div>

            {/* 정체재고 합계 (4개 내역 합계 체크용) */}
            <CheckSummaryTable 
              data={data} 
              dimensionTab={dimensionTab} 
              channelTab={channelTab}
              getChannelData={getChannelData}
            />

            {/* 검색창 + 시즌 필터 컨트롤 바 */}
            <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-4">
              {/* 검색창 (좌측) */}
              <div className="flex-1 min-w-[200px] max-w-[500px]">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    🔍
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="품번 또는 품명으로 검색..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              
              {/* 시즌 필터 드롭다운 (우측) */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-600">시즌:</label>
                <select
                  value={seasonFilter}
                  onChange={(e) => setSeasonFilter(e.target.value as SeasonFilterOption)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[120px]"
                >
                  {SEASON_FILTER_OPTIONS.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 상세 테이블 5개 (아이템 탭 + 채널 탭 + 검색어 + 시즌 필터로 제어) */}
            {(() => {
              // 전체 품번 수 및 전체 재고 금액 계산 (채널별)
              const allDetailItems = [
                ...(data.stagnantDetail?.items || []),
                ...(data.currentSeasonDetail?.items || []),
                ...(data.nextSeasonDetail?.items || []),
                ...(data.pastSeasonDetail?.items || []),
                ...(data.lowStockDetail?.items || []),
              ];
              
              // 아이템 탭 필터링 적용
              const filteredAllItems = itemTab === "ACC합계" 
                ? allDetailItems 
                : allDetailItems.filter(item => item.mid_category_kr === itemTab);
              
              // 채널 필터링 적용
              const channelFilteredItems = channelTab === "전체"
                ? filteredAllItems
                : filteredAllItems.filter(item => getChannelData(item, channelTab).stock_amt > 0);
              
              // 검색어 필터링 적용
              const searchFilteredItems = searchQuery.trim()
                ? channelFilteredItems.filter(item => 
                    item.prdt_cd.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
                    item.prdt_nm.toLowerCase().includes(searchQuery.trim().toLowerCase())
                  )
                : channelFilteredItems;
              
              const totalItemCount = searchFilteredItems.length;
              const totalStockAmt = searchFilteredItems.reduce((sum, item) => {
                const channelData = getChannelData(item, channelTab);
                return sum + channelData.stock_amt;
              }, 0);

              // 정체재고 기준금액 계산용: 중분류별 전체 재고금액 맵 생성
              const categoryStockAmtMap = new Map<string, number>();
              const categories = ["신발", "모자", "가방", "기타"];
              categories.forEach(cat => {
                const catItems = allDetailItems.filter(item => item.mid_category_kr === cat);
                const catTotal = catItems.reduce((sum, item) => {
                  const channelData = getChannelData(item, channelTab);
                  return sum + channelData.stock_amt;
                }, 0);
                categoryStockAmtMap.set(cat, catTotal);
              });

              return (
                <div className="space-y-4">
                  {/* 정체재고 - 전체 (시즌 필터: 전체 시즌 또는 정체재고일 때 표시) */}
                  {(seasonFilter === "전체 시즌" || seasonFilter === "정체재고") && (
                    <DetailTable 
                      data={filterDetailTableByItemAndChannel(data.stagnantDetail || { title: "정체재고", seasonGroup: "정체재고", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } })} 
                      dimensionTab={dimensionTab}
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      targetMonth={targetMonth}
                      channelTab={channelTab}
                      getChannelData={getChannelData}
                      totalItemCount={totalItemCount}
                      totalStockAmt={totalStockAmt}
                      onItemClick={handleItemClick}
                      thresholdPct={thresholdPct}
                      categoryStockAmtMap={categoryStockAmtMap}
                    />
                  )}
                  
                  {/* 당시즌 정상재고 (시즌 필터: 전체 시즌 또는 당시즌일 때 표시) */}
                  {(seasonFilter === "전체 시즌" || seasonFilter === "당시즌") && (
                    <DetailTable 
                      data={filterDetailTableByItemAndChannel(data.currentSeasonDetail || { title: "당시즌", seasonGroup: "당시즌", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } })} 
                      dimensionTab={dimensionTab}
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      targetMonth={targetMonth}
                      channelTab={channelTab}
                      getChannelData={getChannelData}
                      totalItemCount={totalItemCount}
                      totalStockAmt={totalStockAmt}
                      onItemClick={handleItemClick}
                    />
                  )}
                  
                  {/* 차기시즌 정상재고 (시즌 필터: 전체 시즌 또는 차기시즌일 때 표시) */}
                  {(seasonFilter === "전체 시즌" || seasonFilter === "차기시즌") && (
                    <DetailTable 
                      data={filterDetailTableByItemAndChannel(data.nextSeasonDetail || { title: "차기시즌", seasonGroup: "차기시즌", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } })} 
                      dimensionTab={dimensionTab}
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      targetMonth={targetMonth}
                      channelTab={channelTab}
                      getChannelData={getChannelData}
                      totalItemCount={totalItemCount}
                      totalStockAmt={totalStockAmt}
                      onItemClick={handleItemClick}
                    />
                  )}
                  
                  {/* 과시즌 정상재고 (시즌 필터: 전체 시즌 또는 과시즌일 때 표시) */}
                  {(seasonFilter === "전체 시즌" || seasonFilter === "과시즌") && (
                    <DetailTable 
                      data={filterDetailTableByItemAndChannel(data.pastSeasonDetail || { title: "과시즌", seasonGroup: "과시즌", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } })} 
                      dimensionTab={dimensionTab}
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      targetMonth={targetMonth}
                      channelTab={channelTab}
                      getChannelData={getChannelData}
                      totalItemCount={totalItemCount}
                      totalStockAmt={totalStockAmt}
                      onItemClick={handleItemClick}
                    />
                  )}
                  
                  {/* 당월수량미달 (시즌 필터: 전체 시즌 또는 당월수량미달일 때 표시) */}
                  {(seasonFilter === "전체 시즌" || seasonFilter === "당월수량미달") && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 overflow-hidden">
                      <div className="p-3 border-b border-yellow-200">
                        <h4 className="text-md font-bold text-yellow-700 flex items-center gap-2">
                          당월수량 &lt; 
                          <input
                            type="number"
                            value={currentMonthMinQty}
                            onChange={(e) => setCurrentMonthMinQty(parseInt(e.target.value, 10) || 0)}
                            className="w-16 px-2 py-1 border border-yellow-300 rounded text-sm text-center bg-white"
                            min="0"
                            max="1000"
                          />
                          개 (스타일 기준) | 전체 {formatNumber(totalItemCount)}개 중 {formatNumber(filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).items.length)}개 표시 | 재고 {formatAmountM(filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).totalRow.stock_amt)} ({formatAmountM(totalStockAmt)} 중 {totalStockAmt > 0 ? formatPercent((filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).totalRow.stock_amt / totalStockAmt) * 100, 1) : "0%"})
                        </h4>
                      </div>
                      
                      <div className="overflow-x-auto">
                        <div style={{ maxHeight: "280px", overflowY: "auto" }}>
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white shadow-sm z-10">
                              <tr className="border-b border-gray-300">
                                <th className="text-left py-2 px-2 font-medium text-gray-600">중분류</th>
                                <th className="text-left py-2 px-2 font-medium text-gray-600">{dimensionTab === "스타일" ? "품번" : dimensionTab === "컬러" ? "품번_컬러" : dimensionTab === "사이즈" ? "품번_사이즈" : "품번_컬러_사이즈"}</th>
                                <th className="text-left py-2 px-2 font-medium text-gray-600">품명</th>
                                <th className="text-left py-2 px-2 font-medium text-gray-600">시즌</th>
                                <th className="text-right py-2 px-2 font-medium text-gray-600">재고수량</th>
                                <th className="text-right py-2 px-2 font-medium text-gray-600">재고금액(K)</th>
                                <th className="text-right py-2 px-2 font-medium text-gray-600">매출금액(K)</th>
                              </tr>
                              {/* 합계 행 */}
                              <tr className="bg-gray-100 font-semibold border-b border-gray-300">
                                <td className="py-2 px-2 text-gray-700">(Total)</td>
                                <td className="py-2 px-2 text-gray-700">{formatNumber(filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).items.length)}건</td>
                                <td className="py-2 px-2 text-gray-500">-</td>
                                <td className="py-2 px-2 text-gray-500">-</td>
                                <td className="text-right py-2 px-2 text-gray-900">{formatNumber(filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).totalRow.stock_qty)}</td>
                                <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).totalRow.stock_amt)}</td>
                                <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).totalRow.sales_tag_amt)}</td>
                              </tr>
                            </thead>
                            <tbody>
                              {filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).items.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="text-center py-8 text-gray-500">
                                    데이터가 없습니다.
                                  </td>
                                </tr>
                              ) : (
                                filterDetailTableByItemAndChannel(data.lowStockDetail || { title: "당월수량미달", seasonGroup: "당월수량미달", items: [], totalRow: { stock_qty: 0, stock_amt: 0, sales_tag_amt: 0 } }).items.map((item, idx) => {
                                  const channelData = getChannelData(item, channelTab);
                                  return (
                                    <tr key={item.dimensionKey + idx} className="border-b border-gray-200 hover:bg-white/50">
                                      <td className="py-2 px-2 text-gray-700">{item.mid_category_kr}</td>
                                      <td 
                                        className="py-2 px-2 text-blue-600 font-mono text-xs cursor-pointer hover:text-blue-800 hover:underline"
                                        onClick={() => handleItemClick(item)}
                                        title="클릭하여 상세 정보 보기"
                                      >
                                        {item.dimensionKey}
                                      </td>
                                      <td className="py-2 px-2 text-gray-700 max-w-[200px] truncate" title={item.prdt_nm}>
                                        {item.prdt_nm}
                                      </td>
                                      <td className="py-2 px-2 text-gray-700">{item.season}</td>
                                      <td className="text-right py-2 px-2 text-gray-900">{formatNumber(channelData.stock_qty)}</td>
                                      <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(channelData.stock_amt)}</td>
                                      <td className="text-right py-2 px-2 text-gray-900">{formatAmountK(channelData.sales_amt)}</td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </>
        )}

        {/* 데이터 없음 */}
        {!loading && !error && !data && targetMonth && (
          <div className="text-center py-12 text-gray-500">
            선택한 조건에 해당하는 데이터가 없습니다.
          </div>
        )}
      </CollapsibleSection>

      {/* 품번 상세 모달 */}
      {selectedItem && (
        <StagnantStockDetailModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          item={selectedItem}
          brand={brandCode}
          dimensionTab={dimensionTab}
          referenceMonth={referenceMonth}
        />
      )}
    </div>
  );
}

