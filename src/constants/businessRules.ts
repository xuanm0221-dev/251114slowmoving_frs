/**
 * 비즈니스 규칙 상수
 * 
 * 주력/아울렛 분류 기준 등 전체 대시보드에서 공통으로 사용하는 규칙을 정의합니다.
 * 로직 변경 시 이 파일만 수정하면 모든 화면에 자동 반영됩니다.
 */

/**
 * 상품 타입 분류 기준
 */
export const PRODUCT_TYPE_RULES = {
  core: {
    label: '주력상품',
    // 브랜드별 대시보드 상세 설명용
    criteria: 'INTRO/FOCUS 또는 해당 연도 시즌 이상',
    // 재고주수 요약 테이블용 (짧은 버전)
    shortDescription: 'INTRO, FOCUS, 해당 연도 시즌~',
    // 홈 대시보드용 (간단한 버전)
    simpleDescription: 'INTRO/FOCUS, 해당 연도 시즌~',
  },
  outlet: {
    label: '아울렛상품',
    // 브랜드별 대시보드 상세 설명용
    criteria: 'OUTLET/CARE/DONE 또는 (미지정 중) 해당 연도 이전 시즌',
    // 재고주수 요약 테이블용 (짧은 버전)
    shortDescription: 'OUTLET, CARE, DONE, 이전 연도 시즌',
    // 홈 대시보드용 (간단한 버전)
    simpleDescription: 'OUTLET/CARE/DONE, 이전 연도 시즌',
  },
} as const;

/**
 * 채널 분류 기준
 */
export const CHANNEL_RULES = {
  total: {
    label: '전체판매',
    description: 'FRS + OR',
  },
  frs: {
    label: '대리상판매',
    description: 'FRS',
  },
  or: {
    label: '직영판매',
    description: 'OR',
  },
} as const;

/**
 * 데이터 기본 정보
 */
export const DATA_INFO = {
  period: '2024.01 ~ 2025.11',
  periodMonths: '23개월',
  brands: ['MLB', 'MLB KIDS', 'DISCOVERY'],
  category: '악세사리',
  categoryEn: '饰品',
  items: ['Shoes', 'Headwear', 'Bag', 'Acc_etc'],
  unit: '吊牌金额',
  unitDescription: 'M (백만 위안)',
} as const;

