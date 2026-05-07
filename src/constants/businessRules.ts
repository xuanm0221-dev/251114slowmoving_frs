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
  startMonth: '2024.01',
  brands: ['MLB', 'MLB KIDS', 'DISCOVERY'],
  category: '악세사리',
  categoryEn: '饰品',
  items: ['Shoes', 'Headwear', 'Bag', 'Acc_etc'],
  unit: '吊牌金额',
  unitDescription: 'M (백만 위안)',
} as const;

/**
 * 운영기준(operate_standard) 구간 정의
 * - 24.01~25.11: MST_PRDT_SCS의 분기별 remark1~8
 * - 25.12 ~ (기준월 미만): PREP_MST_PRDT_SCS 익월 스냅샷
 *     25.12→PREP 202601, 26.01→PREP 202602, 26.02→PREP 202603, 26.03→PREP 202604 …
 *     (PREP_MST_PRDT_SCS는 26.01부터 데이터 존재)
 * - 기준월(현재 마감월): MST_PRDT_SCS.operate_standard 실시간
 *
 * ※ 마감월이 올라가면 25.12 이상 월은 재집계 필요:
 *    python scripts/preprocess_inventory.py
 *    python scripts/preprocess_sales.py
 */
export const REMARK_PERIODS = [
  { range: '24.01 ~ 24.02', remark: 'remark1', source: 'MST_PRDT_SCS' },
  { range: '24.03 ~ 24.05', remark: 'remark2', source: 'MST_PRDT_SCS' },
  { range: '24.06 ~ 24.08', remark: 'remark3', source: 'MST_PRDT_SCS' },
  { range: '24.09 ~ 24.11', remark: 'remark4', source: 'MST_PRDT_SCS' },
  { range: '24.12 ~ 25.02', remark: 'remark5', source: 'MST_PRDT_SCS' },
  { range: '25.03 ~ 25.05', remark: 'remark6', source: 'MST_PRDT_SCS' },
  { range: '25.06 ~ 25.08', remark: 'remark7', source: 'MST_PRDT_SCS' },
  { range: '25.09 ~ 25.11', remark: 'remark8', source: 'MST_PRDT_SCS' },
  { range: '25.12', remark: 'operate_standard', source: 'PREP_MST_PRDT_SCS (202601)' },
  { range: '26.01', remark: 'operate_standard', source: 'PREP_MST_PRDT_SCS (202602)' },
  { range: '26.02', remark: 'operate_standard', source: 'PREP_MST_PRDT_SCS (202603)' },
  { range: '26.03', remark: 'operate_standard', source: 'PREP_MST_PRDT_SCS (202604)' },
  { range: '26.04 ★현재', remark: 'operate_standard', source: 'MST_PRDT_SCS (실시간)' },
] as const;

/**
 * 마감된 월 목록
 * 기준월 선택 시 이 목록에 포함된 월만 선택 가능합니다.
 * 새로운 월이 마감되면 이 배열에 추가하세요.
 * 형식: "YYYY.MM" (예: "2025.11")
 */
export const CLOSED_MONTHS = [
  "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
  "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12",
  "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
  "2025.07", "2025.08", "2025.09", "2025.10", "2025.11", "2025.12",
  "2026.01", "2026.02", "2026.03", "2026.04"
] as const;


