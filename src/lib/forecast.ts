import { SalesItemTabData, SalesMonthData, ItemTab, SalesBrandData } from "@/types/sales";

/**
 * 월 문자열(YYYY.MM)을 YYYYMM 숫자로 변환
 */
function monthToYm(month: string): number {
  const [year, monthNum] = month.split(".");
  return parseInt(year + monthNum.padStart(2, "0"));
}

/**
 * YYYYMM 숫자를 월 문자열(YYYY.MM)로 변환
 */
function ymToMonth(ym: number): string {
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  return `${year}.${month.toString().padStart(2, "0")}`;
}

/**
 * YYYYMM에 12개월을 빼서 전년동월 계산
 */
function getPrevYearMonth(ym: number): number {
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  const prevYear = year - 1;
  return prevYear * 100 + month;
}

/**
 * YYYYMM에 1개월을 더함
 */
function addMonth(ym: number): number {
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  if (month === 12) {
    return (year + 1) * 100 + 1;
  }
  return year * 100 + (month + 1);
}

/**
 * 브랜드별, 아이템별 판매 데이터에서 마지막 실적 월 찾기
 */
function findLatestActualYm(
  brandData: SalesBrandData,
  itemTab: ItemTab
): number | null {
  const itemData = brandData[itemTab];
  if (!itemData) return null;

  const months = Object.keys(itemData)
    .map(monthToYm)
    .filter((ym) => {
      const monthStr = ymToMonth(ym);
      const data = itemData[monthStr];
      // 실적이 있는 월만 (isForecast가 없거나 false)
      return data && !data.isForecast;
    })
    .sort((a, b) => b - a); // 내림차순 정렬

  return months.length > 0 ? months[0] : null;
}

/**
 * Forecast 대상 월 리스트 생성 (최대 12개월)
 */
function generateForecastMonths(
  latestActualYm: number,
  existingMonths: Set<string>
): string[] {
  const forecastMonths: string[] = [];
  let currentYm = addMonth(latestActualYm);
  let count = 0;

  while (count < 12) {
    const monthStr = ymToMonth(currentYm);
    // 이미 실적이 있는 월은 제외
    if (!existingMonths.has(monthStr)) {
      forecastMonths.push(monthStr);
      count++;
    }
    currentYm = addMonth(currentYm);
  }

  return forecastMonths;
}

/**
 * 전년동월 전체판매 실적 가져오기
 */
function getPrevYearTotal(
  brandData: SalesBrandData,
  itemTab: ItemTab,
  prevYm: number
): number {
  const prevMonthStr = ymToMonth(prevYm);
  const itemData = brandData[itemTab];
  if (!itemData) return 0;

  const prevData = itemData[prevMonthStr];
  if (!prevData || prevData.isForecast) return 0;

  // 전체판매 = 전체_core + 전체_outlet
  return (prevData.전체_core || 0) + (prevData.전체_outlet || 0);
}

/**
 * Forecast 판매매출 데이터 생성
 * @param brandData 브랜드별 판매 데이터
 * @param itemTab 아이템 탭
 * @param growthRatePercent 성장률 (%, 예: 105 = 5% 성장)
 * @returns Forecast 데이터가 포함된 SalesItemTabData
 */
export function generateForecastSales(
  brandData: SalesBrandData,
  itemTab: ItemTab,
  growthRatePercent: number
): SalesItemTabData {
  // 기존 데이터 복사
  const result: SalesItemTabData = { ...brandData[itemTab] };

  // 마지막 실적 월 찾기
  const latestActualYm = findLatestActualYm(brandData, itemTab);
  if (!latestActualYm) {
    return result; // 실적이 없으면 forecast 생성 불가
  }

  // 기존 월 목록 (실적 + 기존 forecast 포함)
  const existingMonths = new Set(Object.keys(result));

  // Forecast 대상 월 리스트 생성
  const forecastMonths = generateForecastMonths(latestActualYm, existingMonths);

  if (forecastMonths.length === 0) {
    return result;
  }

  // 성장률 팩터 계산
  const growthFactor = growthRatePercent / 100;

  // 각 forecast 월에 대해 데이터 생성
  for (const forecastMonth of forecastMonths) {
    const forecastYm = monthToYm(forecastMonth);
    const prevYm = getPrevYearMonth(forecastYm);

    // 전년동월 전체판매 실적 가져오기
    const prevTotal = getPrevYearTotal(brandData, itemTab, prevYm);

    // 예상 전체판매 계산
    const forecastTotal = prevTotal * growthFactor;

    // Forecast 데이터 생성
    // 예상 판매매출은 전체만 저장 (주력/아울렛 구분 없음)
    // 대리상판매(FRS)와 직영판매(OR)는 forecast에서 계산하지 않음 (0으로 설정)
    const forecastData: SalesMonthData = {
      전체: Math.round(forecastTotal),  // 계산된 전체판매 저장 (주력/아울렛 구분 없음)
      전체_core: 0,  // 주력에는 저장하지 않음
      전체_outlet: 0,  // 아울렛에는 저장하지 않음
      FRS_core: 0,
      FRS_outlet: 0,
      OR_core: 0,
      OR_outlet: 0,
      isForecast: true,
    };

    result[forecastMonth] = forecastData;
  }

  return result;
}

/**
 * 브랜드별 모든 아이템에 대해 forecast 생성
 */
export function generateForecastForBrand(
  brandData: SalesBrandData,
  growthRatePercent: number
): SalesBrandData {
  return {
    전체: generateForecastSales(brandData, "전체", growthRatePercent),
    Shoes: generateForecastSales(brandData, "Shoes", growthRatePercent),
    Headwear: generateForecastSales(brandData, "Headwear", growthRatePercent),
    Bag: generateForecastSales(brandData, "Bag", growthRatePercent),
    Acc_etc: generateForecastSales(brandData, "Acc_etc", growthRatePercent),
  };
}

