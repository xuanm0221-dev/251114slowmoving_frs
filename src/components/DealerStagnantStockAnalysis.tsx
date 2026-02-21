"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Brand } from "@/types/sales";
import type {
  StagnantStockResponse,
  StagnantStockItem,
  AccountBreakdownItem,
  SeasonGroup,
} from "@/types/stagnantStock";
import { BRAND_CODE_MAP } from "@/types/stagnantStock";
import CollapsibleSection from "./CollapsibleSection";
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";

// 대리상 마스터 타입
interface DealerMaster {
  account_id: string;
  account_nm_cn: string;
  account_nm_kr: string;
  account_nm_en: string;
}

// 대리상별 집계 데이터
interface DealerSummary {
  account_id: string;
  dealer_nm_en: string;
  dealer_nm_kr: string;
  stock_weeks: number | null;
  stock_qty: number;
  stock_amt: number;
  tag_amt: number;          // TAG 기준 매출금액
  sale_amt: number;         // 실제 판매금액
  discount_rate: number | null;  // 할인율 (1 - sale_amt/tag_amt)
  stagnant_rate: number;
  stagnant_stock_amt: number;
  total_item_count: number;
  stagnant_item_count: number;
}

// 시즌별 상세 데이터
interface DealerSeasonDetail {
  season_group: SeasonGroup | "정체재고";
  display_name: string;
  stock_weeks: number | null;
  stock_qty: number;
  stock_amt: number;
  tag_amt: number;          // TAG 기준 매출금액
  sale_amt: number;         // 실제 판매금액
  discount_rate: number | null;  // 할인율
  stagnant_rate: number;
  item_count: number;
}

// 품번별 상세 데이터
interface DealerProductDetail {
  dimensionKey: string;
  prdt_cd: string;
  prdt_nm: string;
  season: string;
  mid_category_kr: string;
  stock_qty: number;
  stock_amt: number;
  tag_amt: number;          // TAG 기준 매출금액
  sale_amt: number;         // 실제 판매금액
  discount_rate: number | null;  // 할인율
  stock_weeks: number | null;
  stagnant_ratio: number;
  is_stagnant: boolean;
  season_group: SeasonGroup;
}

// 중분류별 집계 데이터
interface CategorySummary {
  category: string;
  stock_amt: number;
  stock_qty: number;
  tag_amt: number;          // TAG 기준 매출금액
  sale_amt: number;         // 실제 판매금액
  discount_rate: number | null;  // 할인율
  stock_weeks: number | null;
  stagnant_rate: number;
  stagnant_amt: number;
}

interface DealerStagnantStockAnalysisProps {
  brand: Brand;
  thresholdPct?: number;
  onThresholdPctChange?: (pct: number) => void;
  minQty?: number;
  onMinQtyChange?: (qty: number) => void;
}

// 숫자 포맷팅 함수
function formatNumber(num: number): string {
  return num.toLocaleString("ko-KR");
}

function formatPercent(num: number, decimals: number = 1): string {
  return num.toFixed(decimals) + "%";
}

function formatAmountK(num: number): string {
  const kValue = Math.round(num / 1000);
  return kValue.toLocaleString("ko-KR") + "K";
}

function formatStockWeeks(weeks: number | null): string {
  if (weeks === null) return "판매0";
  return Math.round(weeks).toLocaleString("ko-KR") + "주";
}

// 할인율 계산 함수
function calculateDiscountRate(tag_amt: number, sale_amt: number): number | null {
  if (tag_amt === 0 || sale_amt === 0) return null;
  return 1 - (sale_amt / tag_amt);
}

// 할인율 포맷팅 함수
function formatDiscountRate(discountRate: number | null): string {
  if (discountRate === null) return "판매0";
  return (discountRate * 100).toFixed(1) + "%";
}

function formatMonth(ym: string): string {
  if (ym.length !== 6) return ym;
  return `${ym.slice(0, 4)}.${ym.slice(4)}`;
}

// 재고주수 계산 (tag_amt 기준)
function calcStockWeeks(stockAmt: number, tagAmt: number, daysInMonth: number): number | null {
  if (tagAmt <= 0) return null;
  const weekSales = (tagAmt / daysInMonth) * 7;
  if (weekSales <= 0) return null;
  return stockAmt / weekSales;
}

// 시즌 그룹별 색상
const SEASON_COLORS: Record<string, { bg: string; text: string; border: string; hover: string }> = {
  "정체재고": { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", hover: "hover:bg-red-100" },
  "과시즌": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", hover: "hover:bg-amber-100" },
  "당시즌": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", hover: "hover:bg-blue-100" },
  "차기시즌": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", hover: "hover:bg-purple-100" },
  "당월수량미달": { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", hover: "hover:bg-yellow-100" },
};

// Level 3 모달 컴포넌트
function ProductDetailModal({
  isOpen,
  onClose,
  products,
  dealerName,
  seasonGroup,
  searchQuery,
  onSearchChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  products: DealerProductDetail[];
  dealerName: string;
  seasonGroup: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  if (!isOpen) return null;

  const filteredProducts = products.filter(p => 
    p.dimensionKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.prdt_nm.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalStockAmt = filteredProducts.reduce((sum, p) => sum + p.stock_amt, 0);
  const totalTagAmt = filteredProducts.reduce((sum, p) => sum + p.tag_amt, 0);
  const totalSaleAmt = filteredProducts.reduce((sum, p) => sum + p.sale_amt, 0);

  const colors = SEASON_COLORS[seasonGroup] || SEASON_COLORS["과시즌"];

  // 중분류별 집계
  const categoryOrder = ["전체", "신발", "모자", "가방", "기타"];
  const categorySummary = useMemo(() => {
    const catMap: Record<string, { stock_amt: number; stock_qty: number; tag_amt: number; sale_amt: number; stagnant_count: number; total_count: number; stagnant_amt: number }> = {};
    categoryOrder.forEach(cat => {
      catMap[cat] = { stock_amt: 0, stock_qty: 0, tag_amt: 0, sale_amt: 0, stagnant_count: 0, total_count: 0, stagnant_amt: 0 };
    });

    filteredProducts.forEach(p => {
      const cat = p.mid_category_kr || "기타";
      const targetCat = categoryOrder.includes(cat) ? cat : "기타";
      
      catMap[targetCat].stock_amt += p.stock_amt;
      catMap[targetCat].stock_qty += p.stock_qty;
      catMap[targetCat].tag_amt += p.tag_amt;
      catMap[targetCat].sale_amt += p.sale_amt;
      catMap[targetCat].total_count += 1;
      if (p.is_stagnant) {
        catMap[targetCat].stagnant_count += 1;
        catMap[targetCat].stagnant_amt += p.stock_amt;
      }

      // 전체에도 누적
      catMap["전체"].stock_amt += p.stock_amt;
      catMap["전체"].stock_qty += p.stock_qty;
      catMap["전체"].tag_amt += p.tag_amt;
      catMap["전체"].sale_amt += p.sale_amt;
      catMap["전체"].total_count += 1;
      if (p.is_stagnant) {
        catMap["전체"].stagnant_count += 1;
        catMap["전체"].stagnant_amt += p.stock_amt;
      }
    });

    return categoryOrder.map(cat => {
      const catData = catMap[cat];
      return {
        category: cat,
        ...catData,
        discount_rate: calculateDiscountRate(catData.tag_amt, catData.sale_amt),
        stagnant_rate: catData.stock_amt > 0 ? (catData.stagnant_amt / catData.stock_amt) * 100 : 0,
      };
    });
  }, [filteredProducts]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-6xl max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className={`p-4 border-b ${colors.border} ${colors.bg} rounded-t-lg flex items-center justify-between`}>
          <div>
            <h3 className={`text-lg font-bold ${colors.text}`}>
              {dealerName} - {seasonGroup}
            </h3>
            <p className="text-sm text-gray-500">prdt_scs_cd 단위 상세 | {filteredProducts.length}개 품목</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-light">×</button>
        </div>

        {/* 중분류별 요약 테이블 */}
        <div className="p-3 border-b border-gray-200 bg-gray-50">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 px-2 font-medium text-gray-600">구분</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">재고금액(K)</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">재고수량</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">Tag매출(K)</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">실판(K)</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">할인율</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">재고주수</th>
                <th className="text-right py-1.5 px-2 font-medium text-gray-600">정체금액(K)</th>
                <th className="text-center py-1.5 px-2 font-medium text-gray-600">정체여부</th>
              </tr>
            </thead>
            <tbody>
              {categorySummary.map((cat, idx) => {
                const stockWeeks = cat.tag_amt > 0 ? (cat.stock_amt / (cat.tag_amt / 30 * 7)) : null;
                return (
                  <tr key={cat.category} className={idx === 0 ? "bg-white font-medium border-b border-gray-100" : "border-b border-gray-50"}>
                    <td className="py-1 px-2 text-gray-700">{cat.category}</td>
                    <td className="text-right py-1 px-2 text-gray-900">{formatAmountK(cat.stock_amt)}</td>
                    <td className="text-right py-1 px-2 text-gray-900">{formatNumber(cat.stock_qty)}</td>
                    <td className="text-right py-1 px-2 text-gray-900">{formatAmountK(cat.tag_amt)}</td>
                    <td className="text-right py-1 px-2 text-gray-900">{formatAmountK(cat.sale_amt)}</td>
                    <td className="text-right py-1 px-2 text-gray-900">{formatDiscountRate(cat.discount_rate)}</td>
                    <td className="text-right py-1 px-2 text-gray-900">{stockWeeks !== null ? `${Math.round(stockWeeks)}주` : "-"}</td>
                    <td className="text-right py-1 px-2 text-red-600">{formatAmountK(cat.stagnant_amt)}</td>
                    <td className="text-center py-1 px-2">
                      {cat.stagnant_count > 0 ? (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded">{cat.stagnant_count}건</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 검색창 */}
        <div className="p-3 border-b border-gray-200">
          <div className="relative max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="품번 또는 품명으로 검색..."
              className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button onClick={() => onSearchChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>
            )}
          </div>
        </div>

        {/* 테이블 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="text-left py-2 px-3 font-medium text-gray-600">prdt_scs_cd</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">품명</th>
                <th className="text-center py-2 px-3 font-medium text-gray-600">시즌</th>
                <th className="text-center py-2 px-3 font-medium text-gray-600">중분류</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">재고금액(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">재고수량</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">Tag매출(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">실판(K)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">할인율</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">재고주수</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">정체금액(K)</th>
                <th className="text-center py-2 px-3 font-medium text-gray-600">정체여부</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>
              ) : (
                filteredProducts.map((product, idx) => (
                  <tr key={product.dimensionKey + idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-mono text-xs text-gray-700">{product.dimensionKey}</td>
                    <td className="py-2 px-3 text-gray-700 max-w-[250px] truncate" title={product.prdt_nm}>{product.prdt_nm}</td>
                    <td className="text-center py-2 px-3 text-gray-600">{product.season}</td>
                    <td className="text-center py-2 px-3 text-gray-600">{product.mid_category_kr}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(product.stock_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatNumber(product.stock_qty)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(product.tag_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(product.sale_amt)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatDiscountRate(product.discount_rate)}</td>
                    <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(product.stock_weeks)}</td>
                    <td className="text-right py-2 px-3 text-red-600">
                      {product.is_stagnant ? formatAmountK(product.stock_amt) : "-"}
                    </td>
                    <td className="text-center py-2 px-3">
                      {product.is_stagnant ? (
                        <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded">정체</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 푸터 */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between rounded-b-lg">
          <div className="text-sm text-gray-600">
            합계: 재고 <span className="font-semibold text-gray-800">{formatAmountK(totalStockAmt)}</span> / 매출 <span className="font-semibold text-gray-800">{formatAmountK(totalTagAmt)}</span> / 할인율 <span className="font-semibold text-gray-800">{formatDiscountRate(calculateDiscountRate(totalTagAmt, totalSaleAmt))}</span>
          </div>
          <button onClick={onClose} className="px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm font-medium">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DealerStagnantStockAnalysis({
  brand,
  thresholdPct: externalThresholdPct,
  onThresholdPctChange,
  minQty: externalMinQty,
  onMinQtyChange,
}: DealerStagnantStockAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StagnantStockResponse | null>(null);
  const [dealerMasters, setDealerMasters] = useState<Map<string, DealerMaster>>(new Map());
  
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  // 전역 기준월 사용
  const { referenceMonth } = useReferenceMonth();
  // API는 "YYYYMM" 형식을 사용하므로 변환
  const targetMonth = referenceMonth.replace(".", "");
  const [internalThresholdPct, setInternalThresholdPct] = useState<number>(0.01);
  const [internalMinQty, setInternalMinQty] = useState<number>(10);
  
  const thresholdPct = externalThresholdPct ?? internalThresholdPct;
  const setThresholdPct = (pct: number) => {
    if (onThresholdPctChange) onThresholdPctChange(pct);
    else setInternalThresholdPct(pct);
  };
  
  const minQty = externalMinQty ?? internalMinQty;
  const setMinQty = (qty: number) => {
    if (onMinQtyChange) onMinQtyChange(qty);
    else setInternalMinQty(qty);
  };

  // 펼친 대리상 ID
  const [expandedDealerId, setExpandedDealerId] = useState<string | null>(null);
  
  // Level 3 모달 상태
  const [selectedDealer, setSelectedDealer] = useState<DealerSummary | null>(null);
  const [selectedSeasonGroup, setSelectedSeasonGroup] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  
  const [sortKey, setSortKey] = useState<keyof DealerSummary>("stock_amt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const brandCode = BRAND_CODE_MAP[brand] || "M";
  const daysInMonth = data?.meta?.daysInMonth || 30;

  // 대리상 마스터 로드
  useEffect(() => {
    const loadDealerMasters = async () => {
      try {
        const response = await fetch("/api/dealer-master");
        if (response.ok) {
          const result = await response.json();
          const map = new Map<string, DealerMaster>();
          result.dealers?.forEach((d: DealerMaster) => map.set(d.account_id, d));
          setDealerMasters(map);
        }
      } catch (err) {
        console.error("Failed to load dealer masters:", err);
      }
    };
    loadDealerMasters();
  }, []);

  // 데이터 로드
  const fetchData = useCallback(async () => {
    if (!targetMonth) return;
    
    setLoading(true);
    setError(null);
    setExpandedDealerId(null);
    
    try {
      const params = new URLSearchParams({
        brand: brandCode,
        targetMonth,
        dimensionTab: "컬러&사이즈",
        thresholdPct: String(thresholdPct),
        minQty: String(minQty),
        includeAccountBreakdown: "true",
        ignoreMinQty: "true", // 대리상 단위: 전월말 수량 조건 무시
      });
      
      const response = await fetch(`/api/stagnant-stock?${params}`);
      
      if (!response.ok) throw new Error("데이터를 불러오는데 실패했습니다.");
      
      const result: StagnantStockResponse = await response.json();
      setData(result);
      
      if (result.availableMonths?.length > 0) {
        setAvailableMonths(result.availableMonths);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [brandCode, targetMonth, thresholdPct, minQty]);

  // 초기 월 목록 로드 (전역 기준월 변경 시에도 업데이트)
  useEffect(() => {
    const loadInitialMonths = async () => {
      try {
        const params = new URLSearchParams({
          brand: brandCode,
          targetMonth: targetMonth,
          dimensionTab: "컬러&사이즈",
          thresholdPct: "0.01",
        });
        
        const response = await fetch(`/api/stagnant-stock?${params}`);
        if (response.ok) {
          const result: StagnantStockResponse = await response.json();
          if (result.availableMonths?.length > 0) {
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

  useEffect(() => {
    if (targetMonth) fetchData();
  }, [fetchData, targetMonth, thresholdPct, minQty, referenceMonth]);

  // 상품별 정체/시즌 정보 맵 생성
  const itemInfoMap = useMemo(() => {
    const map = new Map<string, StagnantStockItem>();
    if (!data) return map;
    
    const allItems = [
      ...(data.stagnantDetail?.items || []),
      ...(data.currentSeasonDetail?.items || []),
      ...(data.nextSeasonDetail?.items || []),
      ...(data.pastSeasonDetail?.items || []),
      ...(data.lowStockDetail?.items || []),
    ].filter(item => item.fr_stock_amt > 0);
    
    allItems.forEach(item => {
      map.set(item.dimensionKey, item);
    });
    
    return map;
  }, [data]);

  // 대리상별 집계 계산
  const dealerSummaries = useMemo((): DealerSummary[] => {
    if (!data?.accountBreakdown) return [];
    
    const dealerMap = new Map<string, {
      stock_qty: number;
      stock_amt: number;
      tag_amt: number;
      sale_amt: number;
      stagnant_stock_amt: number;
      total_items: Set<string>;
      stagnant_items: Set<string>;
    }>();
    
    data.accountBreakdown.forEach(ab => {
      const itemInfo = itemInfoMap.get(ab.dimensionKey);
      if (!itemInfo) return;
      
      const existing = dealerMap.get(ab.account_id) || {
        stock_qty: 0,
        stock_amt: 0,
        tag_amt: 0,
        sale_amt: 0,
        stagnant_stock_amt: 0,
        total_items: new Set<string>(),
        stagnant_items: new Set<string>(),
      };
      
      existing.stock_qty += ab.stock_qty;
      existing.stock_amt += ab.stock_amt;
      existing.tag_amt += ab.tag_amt;
      existing.sale_amt += ab.sale_amt;
      existing.total_items.add(ab.dimensionKey);
      
      if (itemInfo.seasonGroup === "정체재고") {
        existing.stagnant_stock_amt += ab.stock_amt;
        existing.stagnant_items.add(ab.dimensionKey);
      }
      
      dealerMap.set(ab.account_id, existing);
    });
    
    return Array.from(dealerMap.entries()).map(([accountId, agg]) => {
      const dealer = dealerMasters.get(accountId);
      const stockWeeks = calcStockWeeks(agg.stock_amt, agg.tag_amt, daysInMonth);
      const stagnantRate = agg.stock_amt > 0 ? (agg.stagnant_stock_amt / agg.stock_amt) * 100 : 0;
      const discountRate = calculateDiscountRate(agg.tag_amt, agg.sale_amt);
      
      return {
        account_id: accountId,
        dealer_nm_en: dealer?.account_nm_en || accountId,
        dealer_nm_kr: dealer?.account_nm_kr || '',
        stock_weeks: stockWeeks,
        stock_qty: agg.stock_qty,
        stock_amt: agg.stock_amt,
        tag_amt: agg.tag_amt,
        sale_amt: agg.sale_amt,
        discount_rate: discountRate,
        stagnant_rate: stagnantRate,
        stagnant_stock_amt: agg.stagnant_stock_amt,
        total_item_count: agg.total_items.size,
        stagnant_item_count: agg.stagnant_items.size,
      };
    });
  }, [data, itemInfoMap, dealerMasters, daysInMonth]);

  // 정렬된 대리상 목록
  const sortedDealers = useMemo(() => {
    return [...dealerSummaries].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      
      // null 값 처리 (판매0는 항상 마지막)
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      
      return sortDir === "asc" 
        ? String(aVal).localeCompare(String(bVal)) 
        : String(bVal).localeCompare(String(aVal));
    });
  }, [dealerSummaries, sortKey, sortDir]);

  // 전체 요약 (중분류별)
  const categorySummaries = useMemo((): CategorySummary[] => {
    if (!data?.accountBreakdown) return [];
    
    const categoryMap = new Map<string, { stock_amt: number; stock_qty: number; tag_amt: number; sale_amt: number; stagnant_amt: number }>();
    const categories = ["전체", "신발", "모자", "가방", "기타"];
    categories.forEach(cat => categoryMap.set(cat, { stock_amt: 0, stock_qty: 0, tag_amt: 0, sale_amt: 0, stagnant_amt: 0 }));
    
    data.accountBreakdown.forEach(ab => {
      const itemInfo = itemInfoMap.get(ab.dimensionKey);
      if (!itemInfo) return;
      
      const cat = itemInfo.mid_category_kr || "기타";
      const isStagnant = itemInfo.seasonGroup === "정체재고";
      
      // 전체
      const total = categoryMap.get("전체")!;
      total.stock_amt += ab.stock_amt;
      total.stock_qty += ab.stock_qty;
      total.tag_amt += ab.tag_amt;
      total.sale_amt += ab.sale_amt;
      if (isStagnant) total.stagnant_amt += ab.stock_amt;
      
      // 개별 카테고리
      if (categoryMap.has(cat)) {
        const catData = categoryMap.get(cat)!;
        catData.stock_amt += ab.stock_amt;
        catData.stock_qty += ab.stock_qty;
        catData.tag_amt += ab.tag_amt;
        catData.sale_amt += ab.sale_amt;
        if (isStagnant) catData.stagnant_amt += ab.stock_amt;
      }
    });
    
    return categories.map(cat => {
      const d = categoryMap.get(cat)!;
      const discountRate = calculateDiscountRate(d.tag_amt, d.sale_amt);
      return {
        category: cat,
        stock_amt: d.stock_amt,
        stock_qty: d.stock_qty,
        tag_amt: d.tag_amt,
        sale_amt: d.sale_amt,
        discount_rate: discountRate,
        stock_weeks: calcStockWeeks(d.stock_amt, d.tag_amt, daysInMonth),
        stagnant_rate: d.stock_amt > 0 ? (d.stagnant_amt / d.stock_amt) * 100 : 0,
        stagnant_amt: d.stagnant_amt,
      };
    });
  }, [data, itemInfoMap, daysInMonth]);

  // 정체/정상 요약 (중분류별 포함)
  const stagnantNormalSummary = useMemo(() => {
    if (!data?.accountBreakdown) return { stagnant: null, normal: null, total: null };
    
    const categories = ["신발", "모자", "가방", "기타"];
    const initCatData = () => categories.reduce((acc, cat) => {
      acc[cat] = { stock_amt: 0, stock_qty: 0, tag_amt: 0, sale_amt: 0 };
      return acc;
    }, {} as Record<string, { stock_amt: number; stock_qty: number; tag_amt: number; sale_amt: number }>);
    
    const stagnant = { stock_amt: 0, stock_qty: 0, tag_amt: 0, sale_amt: 0, byCategory: initCatData() };
    const normal = { stock_amt: 0, stock_qty: 0, tag_amt: 0, sale_amt: 0, byCategory: initCatData() };
    const total = { stock_amt: 0, stock_qty: 0, tag_amt: 0, sale_amt: 0 };
    
    data.accountBreakdown.forEach(ab => {
      const itemInfo = itemInfoMap.get(ab.dimensionKey);
      if (!itemInfo) return;
      
      const cat = categories.includes(itemInfo.mid_category_kr) ? itemInfo.mid_category_kr : "기타";
      
      // 전체 집계
      total.stock_amt += ab.stock_amt;
      total.stock_qty += ab.stock_qty;
      total.tag_amt += ab.tag_amt;
      total.sale_amt += ab.sale_amt;
      
      if (itemInfo.seasonGroup === "정체재고") {
        stagnant.stock_amt += ab.stock_amt;
        stagnant.stock_qty += ab.stock_qty;
        stagnant.tag_amt += ab.tag_amt;
        stagnant.sale_amt += ab.sale_amt;
        stagnant.byCategory[cat].stock_amt += ab.stock_amt;
        stagnant.byCategory[cat].stock_qty += ab.stock_qty;
        stagnant.byCategory[cat].tag_amt += ab.tag_amt;
        stagnant.byCategory[cat].sale_amt += ab.sale_amt;
      } else {
        normal.stock_amt += ab.stock_amt;
        normal.stock_qty += ab.stock_qty;
        normal.tag_amt += ab.tag_amt;
        normal.sale_amt += ab.sale_amt;
        normal.byCategory[cat].stock_amt += ab.stock_amt;
        normal.byCategory[cat].stock_qty += ab.stock_qty;
        normal.byCategory[cat].tag_amt += ab.tag_amt;
        normal.byCategory[cat].sale_amt += ab.sale_amt;
      }
    });
    
    const totalStockAmt = stagnant.stock_amt + normal.stock_amt;
    
    return {
      total: {
        ...total,
        stock_weeks: calcStockWeeks(total.stock_amt, total.tag_amt, daysInMonth),
      },
      stagnant: {
        ...stagnant,
        stock_weeks: calcStockWeeks(stagnant.stock_amt, stagnant.tag_amt, daysInMonth),
        rate: totalStockAmt > 0 ? (stagnant.stock_amt / totalStockAmt) * 100 : 0,
        byCategory: categories.map(cat => ({
          category: cat,
          ...stagnant.byCategory[cat],
          stock_weeks: calcStockWeeks(stagnant.byCategory[cat].stock_amt, stagnant.byCategory[cat].tag_amt, daysInMonth),
        })),
      },
      normal: {
        ...normal,
        stock_weeks: calcStockWeeks(normal.stock_amt, normal.tag_amt, daysInMonth),
        rate: totalStockAmt > 0 ? (normal.stock_amt / totalStockAmt) * 100 : 0,
        byCategory: categories.map(cat => ({
          category: cat,
          ...normal.byCategory[cat],
          stock_weeks: calcStockWeeks(normal.byCategory[cat].stock_amt, normal.byCategory[cat].tag_amt, daysInMonth),
        })),
      },
    };
  }, [data, itemInfoMap, daysInMonth]);

  // 특정 대리상의 시즌별 상세 계산
  const getSeasonDetailsForDealer = useCallback((dealerId: string): DealerSeasonDetail[] => {
    if (!data?.accountBreakdown) return [];
    
    const dealerItems = data.accountBreakdown.filter(ab => ab.account_id === dealerId);
    const dealerTotalStockAmt = dealerItems.reduce((sum, ab) => {
      const itemInfo = itemInfoMap.get(ab.dimensionKey);
      return itemInfo ? sum + ab.stock_amt : sum;
    }, 0);
    
    const seasonGroups: { group: SeasonGroup | "정체재고"; displayName: string }[] = [
      { group: "정체재고", displayName: "정체재고" },
      { group: "과시즌", displayName: "과시즌(정체제외)" },
      { group: "당시즌", displayName: "당시즌" },
      { group: "차기시즌", displayName: "차기시즌" },
    ];
    
    return seasonGroups.map(({ group, displayName }) => {
      const items = dealerItems.filter(ab => {
        const itemInfo = itemInfoMap.get(ab.dimensionKey);
        if (!itemInfo) return false;
        if (group === "정체재고") return itemInfo.seasonGroup === "정체재고";
        return itemInfo.seasonGroup === group;
      });
      
      const stockAmt = items.reduce((sum, ab) => sum + ab.stock_amt, 0);
      const tagAmt = items.reduce((sum, ab) => sum + ab.tag_amt, 0);
      const saleAmt = items.reduce((sum, ab) => sum + ab.sale_amt, 0);
      const stockQty = items.reduce((sum, ab) => sum + ab.stock_qty, 0);
      const discountRate = calculateDiscountRate(tagAmt, saleAmt);
      
      return {
        season_group: group,
        display_name: displayName,
        stock_weeks: calcStockWeeks(stockAmt, tagAmt, daysInMonth),
        stock_qty: stockQty,
        stock_amt: stockAmt,
        tag_amt: tagAmt,
        sale_amt: saleAmt,
        discount_rate: discountRate,
        stagnant_rate: dealerTotalStockAmt > 0 ? (stockAmt / dealerTotalStockAmt) * 100 : 0,
        item_count: new Set(items.map(i => i.dimensionKey)).size,
      };
    }).filter(sd => sd.item_count > 0);
  }, [data, itemInfoMap, daysInMonth]);

  // Level 3: 품번 상세
  const productDetails = useMemo((): DealerProductDetail[] => {
    if (!selectedDealer || !selectedSeasonGroup || !data?.accountBreakdown) return [];
    
    const dealerItems = data.accountBreakdown.filter(ab => ab.account_id === selectedDealer.account_id);
    
    return dealerItems
      .filter(ab => {
        const itemInfo = itemInfoMap.get(ab.dimensionKey);
        if (!itemInfo) return false;
        if (selectedSeasonGroup === "정체재고") return itemInfo.seasonGroup === "정체재고";
        if (selectedSeasonGroup === "과시즌(정체제외)") return itemInfo.seasonGroup === "과시즌";
        return itemInfo.seasonGroup === selectedSeasonGroup;
      })
      .map(ab => {
        const itemInfo = itemInfoMap.get(ab.dimensionKey)!;
        const discountRate = calculateDiscountRate(ab.tag_amt, ab.sale_amt);
        return {
          dimensionKey: ab.dimensionKey,
          prdt_cd: itemInfo.prdt_cd,
          prdt_nm: itemInfo.prdt_nm,
          season: itemInfo.season,
          mid_category_kr: itemInfo.mid_category_kr,
          stock_qty: ab.stock_qty,
          stock_amt: ab.stock_amt,
          tag_amt: ab.tag_amt,
          sale_amt: ab.sale_amt,
          discount_rate: discountRate,
          stock_weeks: calcStockWeeks(ab.stock_amt, ab.tag_amt, daysInMonth),
          stagnant_ratio: itemInfo.ratio,
          is_stagnant: itemInfo.seasonGroup === "정체재고",
          season_group: itemInfo.seasonGroup,
        };
      })
      .sort((a, b) => b.stock_amt - a.stock_amt);
  }, [selectedDealer, selectedSeasonGroup, data, itemInfoMap, daysInMonth]);

  const handleSort = (key: keyof DealerSummary) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleDealerClick = (dealer: DealerSummary) => {
    if (expandedDealerId === dealer.account_id) {
      setExpandedDealerId(null);
    } else {
      setExpandedDealerId(dealer.account_id);
      setSelectedDealer(dealer);
    }
  };

  const handleSeasonClick = (dealer: DealerSummary, seasonDetail: DealerSeasonDetail) => {
    setSelectedDealer(dealer);
    setSelectedSeasonGroup(seasonDetail.display_name);
    setModalOpen(true);
    setProductSearchQuery("");
  };

  const SortIcon = ({ columnKey }: { columnKey: keyof DealerSummary }) => {
    if (sortKey !== columnKey) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="mb-4">
      <CollapsibleSection
        title="(대리상단위)정체재고 분석"
        icon="🏪"
        iconColor="text-purple-500"
        defaultOpen={false}
        titleExtra={
          <span className="text-gray-400 text-sm font-normal">FR</span>
        }
        headerAction={
          <div className="text-xs text-gray-500 text-right">
            <div>FR 기준 | prdt_scs_cd 단위 | 전월말 수량 조건 미적용</div>
            <div>정체재고: 과시즌 중 (당월판매 ÷ 중분류 기말재고) {"<"} {thresholdPct}%</div>
          </div>
        }
      >
        {/* 컨트롤 영역 */}
        <div className="mb-4 p-3 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">기준월:</label>
            <div className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-gray-50 text-gray-700">
              {formatMonth(targetMonth)}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">정체율 기준:</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={thresholdPct}
                onChange={(e) => setThresholdPct(parseFloat(e.target.value) || 0)}
                step="0.01"
                min="0"
                max="100"
                className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
              <span className="text-xs text-gray-500">%</span>
              <span className="text-xs text-gray-400">(당월판매/중분류재고 기준)</span>
            </div>
          </div>

          <button
            onClick={fetchData}
            className="px-4 py-1.5 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm font-medium transition-colors"
          >
            새로고침
          </button>
        </div>

        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
            <span className="ml-3 text-gray-600">데이터 로딩 중...</span>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
        )}

        {!loading && !error && data && (
          <>
            {/* 요약 카드 3개 가로 배열 - 테이블만 표시 */}
            <div className="mb-6 grid grid-cols-3 gap-4">
              {/* 전체 카드 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 bg-gray-500 text-white text-xs font-medium rounded">전체</span>
                  <span className="text-xs text-gray-500">FR 재고 합계</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="text-left py-1.5 font-medium">구분</th>
                      <th className="text-right py-1.5 font-medium">재고(K)</th>
                      <th className="text-right py-1.5 font-medium">비중</th>
                      <th className="text-right py-1.5 font-medium">수량</th>
                      <th className="text-right py-1.5 font-medium">매출(K)</th>
                      <th className="text-right py-1.5 font-medium">주수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 합계 행 */}
                    <tr className="border-b border-gray-100 bg-gray-50 font-bold">
                      <td className="py-1.5 text-gray-900">합계</td>
                      <td className="text-right py-1.5 text-gray-900">{formatAmountK(stagnantNormalSummary.total?.stock_amt || 0)}</td>
                      <td className="text-right py-1.5 text-gray-600">100.0%</td>
                      <td className="text-right py-1.5 text-gray-900">{formatNumber(stagnantNormalSummary.total?.stock_qty || 0)}</td>
                      <td className="text-right py-1.5 text-gray-900">{formatAmountK(stagnantNormalSummary.total?.tag_amt || 0)}</td>
                      <td className="text-right py-1.5 text-gray-900">{formatStockWeeks(stagnantNormalSummary.total?.stock_weeks || null)}</td>
                    </tr>
                    {/* 중분류 행 - 전체 박스는 모두 100% (정체+정상=100%) */}
                    {categorySummaries.slice(1).map((cat) => (
                      <tr key={cat.category} className="border-b border-gray-50">
                        <td className="py-1.5 text-gray-700">{cat.category}</td>
                        <td className="text-right py-1.5 text-gray-900">{formatAmountK(cat.stock_amt)}</td>
                        <td className="text-right py-1.5 text-gray-500">100.0%</td>
                        <td className="text-right py-1.5 text-gray-900">{formatNumber(cat.stock_qty)}</td>
                        <td className="text-right py-1.5 text-gray-900">{formatAmountK(cat.tag_amt)}</td>
                        <td className="text-right py-1.5 text-gray-900">{formatStockWeeks(cat.stock_weeks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 정체 카드 */}
              <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded">정체</span>
                  <span className="text-xs text-gray-500">과시즌 중 판매율 &lt; {thresholdPct}%</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-600 border-b border-red-200">
                      <th className="text-left py-1.5 font-medium">구분</th>
                      <th className="text-right py-1.5 font-medium">재고(K)</th>
                      <th className="text-right py-1.5 font-medium">비중</th>
                      <th className="text-right py-1.5 font-medium">수량</th>
                      <th className="text-right py-1.5 font-medium">매출(K)</th>
                      <th className="text-right py-1.5 font-medium">주수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 합계 행 - 전체 합계 대비 비중 */}
                    {(() => {
                      const totalStockAmt = stagnantNormalSummary.total?.stock_amt || 1;
                      const stagnantStockAmt = stagnantNormalSummary.stagnant?.stock_amt || 0;
                      const stagnantStockQty = stagnantNormalSummary.stagnant?.stock_qty || 0;
                      return (
                        <tr className="border-b border-red-100 bg-red-100 font-bold">
                          <td className="py-1.5 text-red-900">합계</td>
                          <td className="text-right py-1.5 text-red-700">{formatAmountK(stagnantStockAmt)}</td>
                          <td className="text-right py-1.5 text-red-600">{(stagnantStockAmt / totalStockAmt * 100).toFixed(1)}%</td>
                          <td className="text-right py-1.5 text-red-700">{formatNumber(stagnantStockQty)}</td>
                          <td className="text-right py-1.5 text-red-700">{formatAmountK(stagnantNormalSummary.stagnant?.tag_amt || 0)}</td>
                          <td className="text-right py-1.5 text-red-700">{formatStockWeeks(stagnantNormalSummary.stagnant?.stock_weeks || null)}</td>
                        </tr>
                      );
                    })()}
                    {/* 중분류 행 - 전체 해당 중분류 대비 비중 */}
                    {(stagnantNormalSummary.stagnant?.byCategory || []).map((cat: { category: string; stock_amt: number; stock_qty: number; tag_amt: number; sale_amt: number; stock_weeks: number | null }) => {
                      // 전체 박스에서 해당 중분류의 합계를 찾음
                      const totalCat = categorySummaries.find(c => c.category === cat.category);
                      const totalCatStockAmt = totalCat?.stock_amt || 1;
                      return (
                        <tr key={cat.category} className="border-b border-red-50">
                          <td className="py-1.5 text-gray-700">{cat.category}</td>
                          <td className="text-right py-1.5 text-red-700">{formatAmountK(cat.stock_amt)}</td>
                          <td className="text-right py-1.5 text-red-500">{(cat.stock_amt / totalCatStockAmt * 100).toFixed(1)}%</td>
                          <td className="text-right py-1.5 text-gray-900">{formatNumber(cat.stock_qty)}</td>
                          <td className="text-right py-1.5 text-gray-900">{formatAmountK(cat.tag_amt)}</td>
                          <td className="text-right py-1.5 text-gray-900">{formatStockWeeks(cat.stock_weeks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 정상 카드 */}
              <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 bg-green-500 text-white text-xs font-medium rounded">정상</span>
                  <span className="text-xs text-gray-500">차기 + 당시즌 + 과시즌(정체제외)</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-600 border-b border-green-200">
                      <th className="text-left py-1.5 font-medium">구분</th>
                      <th className="text-right py-1.5 font-medium">재고(K)</th>
                      <th className="text-right py-1.5 font-medium">비중</th>
                      <th className="text-right py-1.5 font-medium">수량</th>
                      <th className="text-right py-1.5 font-medium">매출(K)</th>
                      <th className="text-right py-1.5 font-medium">주수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 합계 행 - 전체 합계 대비 비중 */}
                    {(() => {
                      const totalStockAmt = stagnantNormalSummary.total?.stock_amt || 1;
                      const normalStockAmt = stagnantNormalSummary.normal?.stock_amt || 0;
                      const normalStockQty = stagnantNormalSummary.normal?.stock_qty || 0;
                      return (
                        <tr className="border-b border-green-100 bg-green-100 font-bold">
                          <td className="py-1.5 text-green-900">합계</td>
                          <td className="text-right py-1.5 text-green-700">{formatAmountK(normalStockAmt)}</td>
                          <td className="text-right py-1.5 text-green-600">{(normalStockAmt / totalStockAmt * 100).toFixed(1)}%</td>
                          <td className="text-right py-1.5 text-green-700">{formatNumber(normalStockQty)}</td>
                          <td className="text-right py-1.5 text-green-700">{formatAmountK(stagnantNormalSummary.normal?.tag_amt || 0)}</td>
                          <td className="text-right py-1.5 text-green-700">{formatStockWeeks(stagnantNormalSummary.normal?.stock_weeks || null)}</td>
                        </tr>
                      );
                    })()}
                    {/* 중분류 행 - 전체 해당 중분류 대비 비중 */}
                    {(stagnantNormalSummary.normal?.byCategory || []).map((cat: { category: string; stock_amt: number; stock_qty: number; tag_amt: number; sale_amt: number; stock_weeks: number | null }) => {
                      // 전체 박스에서 해당 중분류의 합계를 찾음
                      const totalCat = categorySummaries.find(c => c.category === cat.category);
                      const totalCatStockAmt = totalCat?.stock_amt || 1;
                      return (
                        <tr key={cat.category} className="border-b border-green-50">
                          <td className="py-1.5 text-gray-700">{cat.category}</td>
                          <td className="text-right py-1.5 text-green-700">{formatAmountK(cat.stock_amt)}</td>
                          <td className="text-right py-1.5 text-green-500">{(cat.stock_amt / totalCatStockAmt * 100).toFixed(1)}%</td>
                          <td className="text-right py-1.5 text-gray-900">{formatNumber(cat.stock_qty)}</td>
                          <td className="text-right py-1.5 text-gray-900">{formatAmountK(cat.tag_amt)}</td>
                          <td className="text-right py-1.5 text-gray-900">{formatStockWeeks(cat.stock_weeks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 대리상별 테이블 (아코디언) */}
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-purple-50 sticky top-0 z-10">
                  <tr className="border-b border-purple-100">
                    <th className="w-8 py-2 px-2"></th>
                    <th className="text-left py-2 px-2 font-medium text-purple-700">대리상</th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("stock_amt")}>
                      재고금액(K)<SortIcon columnKey="stock_amt" />
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("stock_qty")}>
                      재고수량<SortIcon columnKey="stock_qty" />
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("tag_amt")}>
                      Tag매출(K)<SortIcon columnKey="tag_amt" />
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700">실판(K)</th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("discount_rate")}>
                      할인율<SortIcon columnKey="discount_rate" />
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("stock_weeks")}>
                      재고주수<SortIcon columnKey="stock_weeks" />
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("stagnant_rate")}>
                      정체율<SortIcon columnKey="stagnant_rate" />
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-purple-700 cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => handleSort("stagnant_stock_amt")}>
                      정체금액(K)<SortIcon columnKey="stagnant_stock_amt" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDealers.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>
                  ) : (
                    sortedDealers.map((dealer) => {
                      const isExpanded = expandedDealerId === dealer.account_id;
                      const seasonDetails = isExpanded ? getSeasonDetailsForDealer(dealer.account_id) : [];
                      
                      const isHighStagnant = dealer.stagnant_rate >= 30;
                      
                      return (
                        <>
                          {/* 대리상 행 */}
                          <tr
                            key={dealer.account_id}
                            className={`border-b border-gray-100 cursor-pointer transition-colors ${
                              isExpanded ? "bg-gray-100" : isHighStagnant ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50"
                            }`}
                            onClick={() => handleDealerClick(dealer)}
                          >
                            <td className="py-2 px-2 text-center">
                              <span className={`text-gray-400 transition-transform inline-block ${isExpanded ? "rotate-90" : ""}`}>
                                ▶
                              </span>
                            </td>
                            <td className="py-2 px-2">
                              <div className="font-medium text-gray-800">{dealer.dealer_nm_en}</div>
                              <div className="text-xs text-gray-500">
                                {dealer.account_id} · {dealer.dealer_nm_kr}
                              </div>
                            </td>
                            <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(dealer.stock_amt)}</td>
                            <td className="text-right py-2 px-3 text-gray-900">{formatNumber(dealer.stock_qty)}</td>
                            <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(dealer.tag_amt)}</td>
                            <td className="text-right py-2 px-3 text-gray-900">{formatAmountK(dealer.sale_amt)}</td>
                            <td className="text-right py-2 px-3 text-gray-900">{formatDiscountRate(dealer.discount_rate)}</td>
                            <td className="text-right py-2 px-3 text-gray-900">{formatStockWeeks(dealer.stock_weeks)}</td>
                            <td className={`text-right py-2 px-3 font-medium ${dealer.stagnant_rate > 30 ? "text-red-600" : dealer.stagnant_rate > 10 ? "text-orange-600" : "text-green-600"}`}>
                              {formatPercent(dealer.stagnant_rate)}
                            </td>
                            <td className="text-right py-2 px-3 text-red-600 font-medium">{formatAmountK(dealer.stagnant_stock_amt)}</td>
                          </tr>
                          
                          {/* 시즌별 상세 행 (펼쳐진 경우) */}
                          {isExpanded && seasonDetails.map((sd) => {
                            const colors = SEASON_COLORS[sd.season_group] || SEASON_COLORS["과시즌"];
                            return (
                              <tr
                                key={`${dealer.account_id}-${sd.season_group}`}
                                className={`border-b ${colors.border} ${colors.bg} ${colors.hover} cursor-pointer`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSeasonClick(dealer, sd);
                                }}
                              >
                                <td className="py-1.5 px-2"></td>
                                <td className={`py-1.5 px-2 pl-8 ${colors.text} font-medium flex items-center gap-1`}>
                                  {sd.display_name}
                                  <span className="text-xs">▶</span>
                                </td>
                                <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(sd.stock_amt)}</td>
                                <td className="text-right py-1.5 px-3 text-gray-700">{formatNumber(sd.stock_qty)}</td>
                                <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(sd.tag_amt)}</td>
                                <td className="text-right py-1.5 px-3 text-gray-700">{formatAmountK(sd.sale_amt)}</td>
                                <td className="text-right py-1.5 px-3 text-gray-700">{formatDiscountRate(sd.discount_rate)}</td>
                                <td className="text-right py-1.5 px-3 text-gray-700">{formatStockWeeks(sd.stock_weeks)}</td>
                                <td className="text-right py-1.5 px-3 text-gray-700">
                                  {sd.season_group === "정체재고" ? formatPercent(sd.stagnant_rate) : "-"}
                                </td>
                                <td className="text-right py-1.5 px-3 text-gray-600 text-xs">{sd.item_count}개 품목</td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}

        {!loading && !error && !data && targetMonth && (
          <div className="text-center py-12 text-gray-500">선택한 조건에 해당하는 데이터가 없습니다.</div>
        )}
      </CollapsibleSection>

      {/* Level 3: 품번 상세 모달 */}
      <ProductDetailModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedSeasonGroup(null);
        }}
        products={productDetails}
        dealerName={selectedDealer ? `${selectedDealer.dealer_nm_en} (${selectedDealer.dealer_nm_kr})` : ""}
        seasonGroup={selectedSeasonGroup || ""}
        searchQuery={productSearchQuery}
        onSearchChange={setProductSearchQuery}
      />
    </div>
  );
}
