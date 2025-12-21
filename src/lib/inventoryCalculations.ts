/**
 * 재고 계산 유틸 함수
 * 
 * InventoryTable.tsx에서 검증된 계산 로직을 공용 util로 추출
 * InventoryTable + CoreOutletInventorySection에서 동일하게 사용
 */

import { InventoryMonthData } from '@/types/sales';

/**
 * 1. 일수 계산
 * @param month 월 키 (예: '2025.11')
 * @param daysInMonthMap 월별 일수 맵
 * @returns 일수 (없으면 30)
 */
export function getDaysInMonth(
  month: string,
  daysInMonthMap: { [month: string]: number }
): number {
  return daysInMonthMap[month] || 30;
}

/**
 * 2. 직영 판매예정분(주력) 계산
 * 
 * 공식: (OR 판매 주력 / 일수) × 7 × stockWeek
 * 
 * @param monthData 월별 재고 데이터
 * @param days 일수
 * @param stockWeek 재고주수 (버퍼)
 * @returns 직영 판매예정분 금액 (원 단위)
 */
export function calcRetailPlannedCore(
  monthData: InventoryMonthData,
  days: number,
  stockWeek: number
): number {
  if (days === 0) return 0;
  const orSalesCore = monthData.OR_sales_core || 0;
  const stockAmount = (orSalesCore / days) * 7 * stockWeek;
  return Math.round(stockAmount);
}

/**
 * 3. 창고재고(주력) 계산
 * 
 * 공식: 본사재고(주력) - 직영판매예정분(주력)
 * 음수면 0으로 clamp
 * 
 * @param monthData 월별 재고 데이터
 * @param days 일수
 * @param stockWeek 재고주수
 * @returns 창고재고 금액 (원 단위)
 */
export function calcWarehouseCore(
  monthData: InventoryMonthData,
  days: number,
  stockWeek: number
): number {
  const hqOrCore = monthData.HQ_OR_core || 0;
  const retailCore = calcRetailPlannedCore(monthData, days, stockWeek);
  const result = hqOrCore - retailCore;
  return Math.max(0, Math.round(result));
}

/**
 * 4. 카드 값 일괄 계산
 * 
 * 4개 카드 × 2개 세그먼트 = 8개 값 반환
 * - total: 전체기준
 * - frs: 대리상
 * - hqor: 본사재고 (차감 전, 카드 노출 안 함, 디버깅용)
 * - retail: 직영 판매예정분
 * - warehouse: 창고
 * 
 * @param monthData 월별 재고 데이터
 * @param days 일수
 * @param stockWeek 재고주수
 * @returns 카드별 주력/아울렛 값
 */
export function getCoreOutletCardValues(
  monthData: InventoryMonthData | undefined,
  days: number,
  stockWeek: number
) {
  if (!monthData) {
    const empty = { core: 0, outlet: 0 };
    return {
      total: { ...empty },
      frs: { ...empty },
      hqor: { ...empty },
      retail: { ...empty },
      warehouse: { ...empty },
    };
  }

  const retailCore = calcRetailPlannedCore(monthData, days, stockWeek);
  const warehouseCore = calcWarehouseCore(monthData, days, stockWeek);

  return {
    // 전체기준
    total: {
      core: Math.round(monthData.전체_core || 0),
      outlet: Math.round(monthData.전체_outlet || 0),
    },
    // 대리상
    frs: {
      core: Math.round(monthData.FRS_core || 0),
      outlet: Math.round(monthData.FRS_outlet || 0),
    },
    // 본사재고 (차감 전, 카드 노출 안 함, 디버깅용)
    hqor: {
      core: Math.round(monthData.HQ_OR_core || 0),
      outlet: Math.round(monthData.HQ_OR_outlet || 0),
    },
    // 직영 판매예정분
    retail: {
      core: retailCore,
      outlet: 0, // 아울렛은 버퍼 개념 없음
    },
    // 창고
    warehouse: {
      core: warehouseCore,
      outlet: Math.round(monthData.HQ_OR_outlet || 0), // 본사 아울렛 전체
    },
  };
}

/**
 * 5. 월 키 포맷 변환: 'YYYY.MM' → 'YYYYMM'
 */
export function toYYYYMM(month: string): string {
  return month.replace('.', '');
}

/**
 * 6. 월 키 포맷 변환: 'YYYYMM' → 'YYYY.MM'
 */
export function toYYYYDotMM(month: string): string {
  if (month.length !== 6) return month;
  return `${month.substring(0, 4)}.${month.substring(4, 6)}`;
}


