import {
  InventoryBrandData,
  InventoryItemTabData,
  InventoryMonthData,
  SalesBrandData,
  ForecastInventoryData,
  ItemTab,
} from "@/types/sales";

/**
 * "YYYY.MM" → { year, month }
 */
function parseYm(ym: string): { year: number; month: number } {
  const [y, m] = ym.split(".").map(Number);
  return { year: y, month: m };
}

/**
 * {year, month} → "YYYY.MM"
 */
function formatYm(year: number, month: number): string {
  return `${year}.${month.toString().padStart(2, "0")}`;
}

/**
 * 다음 달 (예: "2025.10" → "2025.11", "2025.12" → "2026.01")
 */
function nextMonth(ym: string): string {
  const { year, month } = parseYm(ym);
  if (month === 12) return formatYm(year + 1, 1);
  return formatYm(year, month + 1);
}

/**
 * latestActualYm 이후 count개월 월 리스트 생성
 * 예) latestActualYm=2025.10, count=6 → [2025.11, 2025.12, 2026.01, ..., 2026.04]
 */
function buildForecastMonths(latestActualYm: string, count: number): string[] {
  const result: string[] = [];
  let cur = latestActualYm;
  for (let i = 0; i < count; i++) {
    cur = nextMonth(cur);
    result.push(cur);
  }
  return result;
}

/**
 * 선택된 탭에 해당하는 입고예정 금액(원 단위)을 가져온다.
 * - Shoes / Headwear / Bag / Acc_etc: 해당 아이템만
 * - 전체: 네 아이템 합계
 */
function getInboundAmountForTab(
  forecastInventoryBrandData: ForecastInventoryData | undefined,
  month: string,
  tab: ItemTab
): number {
  const monthData = forecastInventoryBrandData?.[month];
  if (!monthData) return 0;

  if (tab === "전체") {
    return (
      (monthData.Shoes || 0) +
      (monthData.Headwear || 0) +
      (monthData.Bag || 0) +
      (monthData.Acc_etc || 0)
    );
  }

  if (tab === "Shoes") return monthData.Shoes || 0;
  if (tab === "Headwear") return monthData.Headwear || 0;
  if (tab === "Bag") return monthData.Bag || 0;
  if (tab === "Acc_etc") return monthData.Acc_etc || 0;

  return 0;
}

interface BuildInventoryForecastParams {
  itemTab: ItemTab;
  inventoryBrandData: InventoryBrandData | undefined;
  inventoryMonths: string[]; // 기존 JSON의 months (24.01~25.10)
  salesBrandDataWithForecast: SalesBrandData | undefined; // generateForecastForBrand 결과
  forecastInventoryBrandData: ForecastInventoryData | undefined; // 입고예정 집계 결과
  forecastMonthsCount?: number; // 기본 6개월 (25.11~26.04)
}

interface BuildInventoryForecastResult {
  months: string[];
  data: InventoryItemTabData;
}

/**
 * 재고자산 forecast를 계산하여,
 * - 기존 inventoryItemTabData(실적 24.xx~25.10)에
 * - latestActualYm 이후 forecastMonthsCount개월의 재고자산을 이어붙인다.
 *
 * 수식 (월 m, 아이템 i 기준):
 *  전체(m, i) = 전체(m-1, i) + 입고(m, i) - 판매(m, i)
 *
 * - 예상 재고자산은 전체만 계산 (주력/아울렛 구분 없음)
 * - 계산된 전체재고는 전체 필드에 저장 (전체_core와 전체_outlet에는 저장하지 않음)
 * - 대리상/본사/직영/창고는 0
 */
export function buildInventoryForecastForTab(
  params: BuildInventoryForecastParams
): BuildInventoryForecastResult {
  const {
    itemTab,
    inventoryBrandData,
    inventoryMonths,
    salesBrandDataWithForecast,
    forecastInventoryBrandData,
    forecastMonthsCount = 12,
  } = params;

  if (
    !inventoryBrandData ||
    !salesBrandDataWithForecast ||
    !inventoryMonths ||
    inventoryMonths.length === 0
  ) {
    return {
      months: inventoryMonths || [],
      data: inventoryBrandData?.[itemTab] || {},
    };
  }

  const baseItemInventory: InventoryItemTabData =
    inventoryBrandData[itemTab] || {};

  // latestActualYm: inventoryMonths 중 가장 마지막 월 (예: 2025.10)
  const sortedActualMonths = [...inventoryMonths].sort((a, b) => {
    const { year: ya, month: ma } = parseYm(a);
    const { year: yb, month: mb } = parseYm(b);
    if (ya !== yb) return ya - yb;
    return ma - mb;
  });
  const latestActualYm = sortedActualMonths[sortedActualMonths.length - 1];

  const latestActualData: InventoryMonthData | undefined =
    baseItemInventory[latestActualYm];

  if (!latestActualData) {
    // 시작점이 없으면 forecast 생성 불가 → 원본만 반환
    return {
      months: inventoryMonths,
      data: baseItemInventory,
    };
  }

  // 25.10 기준 기말 재고 (전체재고)
  // 실적 구간에서는 전체_core + 전체_outlet의 합
  let totalPrev = (latestActualData.전체_core || 0) + (latestActualData.전체_outlet || 0);

  const resultData: InventoryItemTabData = { ...baseItemInventory };

  const forecastMonths = buildForecastMonths(
    latestActualYm,
    forecastMonthsCount
  );

  for (const ym of forecastMonths) {
    // 판매 데이터 (forecast 포함)
    const salesMonthData =
      salesBrandDataWithForecast[itemTab]?.[ym] ||
      salesBrandDataWithForecast["전체"]?.[ym];

    // 예상 구간에서는 전체 필드 사용, 실적 구간에서는 core + outlet
    const salesTotal = salesMonthData?.전체 !== undefined 
      ? salesMonthData.전체 
      : (salesMonthData?.전체_core || 0) + (salesMonthData?.전체_outlet || 0);

    // 입고예정 (전체 금액)
    const inbound = getInboundAmountForTab(
      forecastInventoryBrandData,
      ym,
      itemTab
    );

    // 수식 적용: 전체재고 = 이전월 전체재고 + 입고예정 - 판매예정
    const total = totalPrev + inbound - salesTotal;

    // 음수 방지
    const safeTotal = Math.max(total, 0);

    // 디버깅용: 25.11 Shoes 예시 확인
    if (ym === "2025.11" && itemTab === "Shoes") {
      // eslint-disable-next-line no-console
      console.log("[DEBUG] 25.11 Shoes forecast");
      // eslint-disable-next-line no-console
      console.log("prevTotal:", totalPrev, "inbound:", inbound, "salesTotal:", salesTotal, "calcTotal:", safeTotal);
    }

    // 예상 재고자산은 전체만 저장 (주력/아울렛 구분 없음)
    // 계산된 전체재고를 전체 필드에 저장 (전체_core와 전체_outlet에는 저장하지 않음)
    // 대리상/본사/직영/창고 관련 필드는 forecast 구간에서 0으로 둔다.
    const forecastMonthData: InventoryMonthData = {
      전체: Math.round(safeTotal),  // 계산된 전체재고 저장 (주력/아울렛 구분 없음)
      전체_core: 0,  // 주력에는 저장하지 않음
      전체_outlet: 0,  // 아울렛에는 저장하지 않음
      FRS_core: 0,
      FRS_outlet: 0,
      HQ_OR_core: 0,
      HQ_OR_outlet: 0,
      OR_sales_core: 0,
      OR_sales_outlet: 0,
    };

    resultData[ym] = forecastMonthData;

    // 다음 월 계산을 위해 prev 값 갱신 (전체주수만)
    totalPrev = safeTotal;
  }

  const allMonths = [...inventoryMonths, ...forecastMonths];

  return {
    months: allMonths,
    data: resultData,
  };
}




