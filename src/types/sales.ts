/**
 * 판매매출 및 재고자산 데이터 타입 정의
 */

// ========== 판매 데이터 타입 ==========

// 판매 월별 데이터 구조
export interface SalesMonthData {
  // 예상 구간에서는 전체 필드에 전체판매가 저장됨 (주력/아울렛 구분 없음)
  전체?: number;  // 예상 구간 전체판매 (주력/아울렛 구분 없음)
  전체_core: number;
  전체_outlet: number;
  FRS_core: number;
  FRS_outlet: number;
  OR_core: number;
  OR_outlet: number;
  isForecast?: boolean; // forecast 데이터 여부 플래그
}

// 판매 아이템 탭별 데이터 구조
export interface SalesItemTabData {
  [month: string]: SalesMonthData;
}

// 판매 브랜드별 데이터 구조 (Record로 타입 안전하게 고정)
export type SalesBrandData = Record<ItemTab, SalesItemTabData>;

// 전체 판매 요약 데이터 구조
export interface SalesSummaryData {
  brands: {
    MLB: SalesBrandData;
    "MLB KIDS": SalesBrandData;
    DISCOVERY: SalesBrandData;
  };
  unexpectedCategories?: string[];
  months: string[];
  meta?: {
    brand?: string;
    startMonth?: string;
    endMonth?: string;
    queryTimestamp?: string;
    totalRecords?: number;
    unmappedRecords?: number;
    unmappedAmount?: number;
  };
}

// ========== 재고 데이터 타입 ==========

// 재고 월별 데이터 구조
export interface InventoryMonthData {
  // 전체재고 (FRS + HQ + OR)
  // 예상 구간에서는 전체 필드에 전체재고가 저장됨 (주력/아울렛 구분 없음)
  전체?: number;  // 예상 구간 전체재고 (주력/아울렛 구분 없음)
  전체_core: number;
  전체_outlet: number;
  // 대리상재고 (FRS)
  FRS_core: number;
  FRS_outlet: number;
  // 본사재고 (HQ + OR)
  HQ_OR_core: number;
  HQ_OR_outlet: number;
  // OR 판매매출 (직영재고 계산용, 원 단위)
  OR_sales_core: number;
  OR_sales_outlet: number;
}

// 재고 아이템 탭별 데이터 구조
export interface InventoryItemTabData {
  [month: string]: InventoryMonthData;
}

// 재고 브랜드별 데이터 구조 (Record로 타입 안전하게 고정)
export type InventoryBrandData = Record<ItemTab, InventoryItemTabData>;

// 전체 재고 요약 데이터 구조
export interface InventorySummaryData {
  brands: {
    MLB: InventoryBrandData;
    "MLB KIDS": InventoryBrandData;
    DISCOVERY: InventoryBrandData;
  };
  unexpectedCategories?: string[];
  months: string[];
  daysInMonth: { [month: string]: number };
  meta?: {
    brand?: string;
    startMonth?: string;
    endMonth?: string;
    queryTimestamp?: string;
    totalRecords?: number;
    unmappedRecords?: number;
    unmappedAmount?: number;
    verification_202511?: {
      sql_total_amt: number;
      json_total_amt: number;
      delta: number;
      target: number;
    };
  };
}

// ========== 입고예정 재고자산(Forecast Inventory) 타입 ==========

// 월별 입고예정 재고자산 데이터 (아이템별 금액)
export interface ForecastInventoryMonthData {
  Shoes?: number;
  Headwear?: number;
  Bag?: number;
  Acc_etc?: number;
}

// 브랜드별 입고예정 재고자산 데이터 (월 → 아이템별 금액)
export interface ForecastInventoryData {
  [month: string]: ForecastInventoryMonthData; // 예: "2025.11"
}

// 전체 입고예정 재고자산 요약 데이터 구조
export interface ForecastInventorySummaryData {
  brands: {
    MLB: ForecastInventoryData;
    "MLB KIDS": ForecastInventoryData;
    DISCOVERY: ForecastInventoryData;
  };
  months: string[]; // 존재하는 월만 포함 (예: ["2025.11", "2025.12", "2026.01"])
  metadata?: {
    [brand: string]: {
      lastUpdated: string; // ISO 8601 형식 (예: "2025-12-24T10:30:00Z")
    };
  };
}

// ========== 실제 입고 재고자산(Actual Arrival) 타입 ==========

// 월별 실제 입고 재고자산 데이터 (아이템별 금액)
export interface ActualArrivalMonthData {
  Shoes?: number;
  Headwear?: number;
  Bag?: number;
  Acc_etc?: number;
}

// 브랜드별 실제 입고 재고자산 데이터 (월 → 아이템별 금액)
export interface ActualArrivalData {
  [month: string]: ActualArrivalMonthData; // 예: "2025.01"
}

// 전체 실제 입고 재고자산 요약 데이터 구조
export interface ActualArrivalSummaryData {
  brands: {
    MLB: ActualArrivalData;
    "MLB KIDS": ActualArrivalData;
    DISCOVERY: ActualArrivalData;
  };
  months: string[]; // 존재하는 월만 포함 (예: ["2025.01", "2025.02", ...])
}

// ========== 공통 타입 ==========

// 아이템 탭 타입
export type ItemTab = "전체" | "Shoes" | "Headwear" | "Bag" | "Acc_etc";

// 재고주수 계산 기준 기간 (1개월 / 2개월 / 3개월)
export type StockWeekWindow = 1 | 2 | 3;

// 채널 탭 타입 (차트용)
export type ChannelTab = "ALL" | "FRS" | "창고";

// 채널 탭 목록
export const CHANNEL_TABS: ChannelTab[] = ["ALL", "FRS", "창고"];

// 브랜드 타입
export type Brand = "MLB" | "MLB KIDS" | "DISCOVERY";

// 상세 품번(SCS) 재고 데이터
export interface InventoryScsItem {
  prdt_scs_cd: string;
  prdt_nm_cn?: string;
  stock_amt: number;   // 원 단위
  stock_qty: number;
}

export interface InventoryScsDetailResponse {
  items: InventoryScsItem[];
  meta: {
    totalAmt: number;    // 원 단위
    totalQty: number;
    recordCount: number;
  };
}

// 판매 표 행 데이터 타입
export interface TableRow {
  label: string;
  isHeader: boolean;
  indent: boolean;
  dataKey: string;
}

// 판매 표 행 정의
export const SALES_TABLE_ROWS: TableRow[] = [
  { label: "전체판매", isHeader: true, indent: false, dataKey: "전체" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "전체_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "전체_outlet" },
  { label: "대리상판매", isHeader: true, indent: false, dataKey: "FRS" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "FRS_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "FRS_outlet" },
  { label: "직영판매", isHeader: true, indent: false, dataKey: "OR" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "OR_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "OR_outlet" },
];

// 재고 표 행 정의
export const INVENTORY_TABLE_ROWS: TableRow[] = [
  { label: "전체재고", isHeader: true, indent: false, dataKey: "전체" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "전체_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "전체_outlet" },
  { label: "대리상재고", isHeader: true, indent: false, dataKey: "FRS" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "FRS_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "FRS_outlet" },
  { label: "본사재고", isHeader: true, indent: false, dataKey: "HQ_OR" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "HQ_OR_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "HQ_OR_outlet" },
  { label: "직영재고", isHeader: true, indent: false, dataKey: "직영" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "직영_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "직영_outlet" },
  { label: "창고재고", isHeader: true, indent: false, dataKey: "창고" },
  { label: "ㄴ 주력상품", isHeader: false, indent: true, dataKey: "창고_core" },
  { label: "ㄴ 아울렛상품", isHeader: false, indent: true, dataKey: "창고_outlet" },
];

// 아이템 탭 목록
export const ITEM_TABS: ItemTab[] = ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"];

// 브랜드 정보 (각 브랜드별 대표색 포함)
export const BRANDS: { 
  key: Brand; 
  name: string; 
  path: string;
  activeColor: string;      // 선택시 배경색
  activeTextColor: string;  // 선택시 텍스트 색상
  hoverColor: string;       // 호버시 배경색
  textColor: string;        // 비선택시 텍스트 색상
}[] = [
  { 
    key: "MLB", 
    name: "MLB", 
    path: "/mlb-sales",
    activeColor: "bg-[#1B365D]",      // MLB 네이비 블루
    activeTextColor: "text-white",
    hoverColor: "hover:bg-[#1B365D]/10",
    textColor: "text-[#1B365D]"
  },
  { 
    key: "MLB KIDS", 
    name: "MLB KIDS", 
    path: "/mlb-kids-sales",
    activeColor: "bg-[#FDE047]",      // MLB KIDS 환한 노란색 (yellow-200)
    activeTextColor: "text-gray-900", // 노란 배경에는 검은 텍스트
    hoverColor: "hover:bg-[#FDE047]/10",
    textColor: "text-[#D4A600]"
  },
  { 
    key: "DISCOVERY", 
    name: "DISCOVERY", 
    path: "/discovery-sales",
    activeColor: "bg-[#14B8A6]",      // Discovery 맑은 초록색 (teal-500)
    activeTextColor: "text-white",
    hoverColor: "hover:bg-[#14B8A6]/10",
    textColor: "text-[#2ED573]"
  },
];

// 기본 stock_week 값
export const DEFAULT_STOCK_WEEK = 25;

// 아이템별 stockWeek 타입
export type StockWeeksByItem = Record<ItemTab, number>;

// 아이템별 stockWeek 기본값 생성 함수
export const createDefaultStockWeeks = (): StockWeeksByItem => ({
  전체: 25,
  Shoes: 30,
  Headwear: 20,
  Bag: 25,
  Acc_etc: 25,
});
