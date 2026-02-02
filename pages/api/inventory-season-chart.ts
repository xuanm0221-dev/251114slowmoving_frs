import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";

// 시즌 그룹 타입
type SeasonGroup = "정체재고" | "당시즌" | "차기시즌" | "과시즌" | "당월수량미달";

// 분석 단위 타입
type DimensionTab = "스타일" | "컬러" | "사이즈" | "컬러&사이즈";

// 아이템 필터 타입
type ItemFilterTab = "ACC합계" | "신발" | "모자" | "가방" | "기타";

// 단위 탭별 KEY 컬럼 매핑
const DIMENSION_KEY_MAP: Record<DimensionTab, { stockKey: string; salesKey: string }> = {
  "스타일": {
    stockKey: "a.prdt_cd",
    salesKey: "s.prdt_cd",
  },
  "컬러": {
    stockKey: "a.prdt_cd || '_' || a.color_cd",
    salesKey: "s.prdt_cd || '_' || s.color_cd",
  },
  "사이즈": {
    stockKey: "a.prdt_cd || '_' || a.size_cd",
    salesKey: "s.prdt_cd || '_' || s.size_cd",
  },
  "컬러&사이즈": {
    stockKey: "a.prdt_scs_cd",
    salesKey: "s.prdt_scs_cd",
  },
};

// 월별 시즌 데이터
interface MonthSeasonData {
  month: string; // YYYYMM
  정체재고: { stock_amt: number; sales_amt: number };
  과시즌: { stock_amt: number; sales_amt: number };
  당시즌: { stock_amt: number; sales_amt: number };
  차기시즌: { stock_amt: number; sales_amt: number };
  당월수량미달: { stock_amt: number; sales_amt: number };
  total_stock_amt: number;
  total_sales_amt: number;
}

// API 응답 타입
interface InventorySeasonChartResponse {
  year2024: MonthSeasonData[];
  year2025: MonthSeasonData[];
  meta: {
    brand: string;
    thresholdPct: number;
    currentYear: string;
    nextYear: string;
    currentMonthMinQty: number;
  };
}

// 기준월 기준으로 당해/차기 연도 계산
function getYearConfig(referenceMonth: string): { currentYear: string; nextYear: string } {
  // referenceMonth 형식: "YYYY.MM" 또는 "YYYYMM"
  const monthStr = referenceMonth.replace(".", ""); // "YYYYMM" 형식으로 변환
  const year = parseInt(monthStr.slice(0, 4), 10); // 기준월의 연도 사용
  return {
    currentYear: String(year).slice(-2), // 기준월 연도 기준
    nextYear: String(year + 1).slice(-2), // 기준월 연도 + 1
  };
}

/** 기준월(YYYY.MM 또는 YYYYMM)에서 N개월 이전 월을 YYYYMM으로 반환 */
function getMonthBeforeYYYYMM(referenceMonth: string, monthsBefore: number): string {
  const normalized = referenceMonth.replace(".", "");
  const y = parseInt(normalized.slice(0, 4), 10);
  const m = parseInt(normalized.slice(4, 6), 10);
  let targetYear = y;
  let targetMonth = m - monthsBefore;
  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }
  return `${targetYear}${String(targetMonth).padStart(2, "0")}`;
}

/** 기준월 포함 최근 12개월 YYYYMM 배열 (기준월-11 ~ 기준월) */
function getTwelveMonthsEndingAt(referenceMonth: string): string[] {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    months.push(getMonthBeforeYYYYMM(referenceMonth, i));
  }
  return months;
}

// 재고 쿼리 (월별, 시즌별 집계) - dimensionTab에 따라 집계 기준 변경
// 당월수량미달: 스타일 기준 당월수량 < currentMonthMinQty인 상품
function buildMonthlyStockQuery(
  brand: string,
  yearPrefix: string, // "2024" or "2025" (시즌 구분용)
  thresholdRatio: number,
  currentYear: string,
  nextYear: string,
  dimensionTab: DimensionTab = "스타일",
  itemFilter: ItemFilterTab = "ACC합계",
  minQty: number = 10,  // 최소 수량 기준 (정체재고 판단용) - 전월말 기준
  currentMonthMinQty: number = 10,  // 당월수량 기준 (당월수량미달 판단용)
  startMonth?: string,  // YYYYMM, 미지정 시 yearPrefix 01~12
  endMonth?: string    // YYYYMM
): string {
  const yymmCondition = startMonth != null && endMonth != null
    ? `a.yymm >= '${startMonth}' AND a.yymm <= '${endMonth}'`
    : `a.yymm >= '${yearPrefix}01' AND a.yymm <= '${yearPrefix}12'`;
  const salesYymmCondition = startMonth != null && endMonth != null
    ? `TO_CHAR(s.sale_dt, 'YYYYMM') >= '${startMonth}' AND TO_CHAR(s.sale_dt, 'YYYYMM') <= '${endMonth}'`
    : `TO_CHAR(s.sale_dt, 'YYYYMM') >= '${yearPrefix}01' AND TO_CHAR(s.sale_dt, 'YYYYMM') <= '${yearPrefix}12'`;
  // 전월 재고 수량은 "조회 구간의 전월"까지 포함 (예: 26.01 조회 시 25.12 필요)
  const prevYymmCondition = startMonth != null && endMonth != null
    ? (() => {
        const prevStart = getMonthBeforeYYYYMM(startMonth, 1);
        const prevEnd = getMonthBeforeYYYYMM(endMonth, 1);
        return `a.yymm >= '${prevStart}' AND a.yymm <= '${prevEnd}'`;
      })()
    : `a.yymm >= '${yearPrefix}01' AND a.yymm <= '${yearPrefix}12'`;

  // 전년 시즌 구분용: 2024년이면 당시즌=24*, 차기=25*, 2025년이면 당시즌=25*, 차기=26*
  const yearShort = yearPrefix.slice(-2); // "24" or "25"
  const nextYearShort = String(parseInt(yearShort) + 1).padStart(2, "0");
  
  // 분석단위별 dimension key
  const dimConfig = DIMENSION_KEY_MAP[dimensionTab];
  
  // 아이템 필터 조건 생성
  const itemFilterCondition = itemFilter === "ACC합계" 
    ? "" 
    : ` AND mid_category_kr = '${itemFilter}'`;

  return `
    WITH 
    -- 월별 스타일 기준 당월수량 집계 (당월수량미달 판단용)
    style_monthly_qty AS (
      SELECT 
        a.yymm AS month,
        a.prdt_cd AS style,
        SUM(a.stock_qty_expected) AS current_stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      WHERE ${yymmCondition}
        AND a.brd_cd = '${brand}'
        AND b.prdt_hrrc1_nm = 'ACC'
      GROUP BY a.yymm, a.prdt_cd
    ),
    
    -- 월별 재고 데이터 (dimension 기준)
    stock_monthly AS (
      SELECT 
        a.yymm AS month,
        ${dimConfig.stockKey} AS dimension_key,
        a.prdt_cd AS style,
        MAX(a.sesn) AS season,
        MAX(CASE
          WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
          WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
          WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
          WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
          ELSE b.prdt_hrrc2_nm
        END) AS mid_category_kr,
        SUM(a.stock_tag_amt_expected) AS stock_amt
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      WHERE ${yymmCondition}
        AND a.brd_cd = '${brand}'
        AND b.prdt_hrrc1_nm = 'ACC'
      GROUP BY a.yymm, ${dimConfig.stockKey}, a.prdt_cd
    ),
    
    -- 월별 판매 데이터 (dimension 기준)
    sales_monthly AS (
      SELECT 
        TO_CHAR(s.sale_dt, 'YYYYMM') AS month,
        ${dimConfig.salesKey} AS dimension_key,
        MAX(SUBSTR(s.prdt_cd, 2, 3)) AS season,
        MAX(CASE
          WHEN p.prdt_hrrc2_nm = 'Shoes' THEN '신발'
          WHEN p.prdt_hrrc2_nm = 'Headwear' THEN '모자'
          WHEN p.prdt_hrrc2_nm = 'Bag' THEN '가방'
          WHEN p.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
          ELSE p.prdt_hrrc2_nm
        END) AS mid_category_kr,
        SUM(s.tag_amt) AS sales_amt
      FROM fnf.chn.dw_sale s
      LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
      LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
      WHERE ${salesYymmCondition}
        AND s.brd_cd = '${brand}'
        AND p.prdt_hrrc1_nm = 'ACC'
        AND d.fr_or_cls IN ('FR', 'OR')
      GROUP BY TO_CHAR(s.sale_dt, 'YYYYMM'), ${dimConfig.salesKey}
    ),
    
    -- 월별 중분류별 재고 합계 (정체재고 판단 분모)
    mid_category_totals AS (
      SELECT 
        month,
        mid_category_kr,
        SUM(stock_amt) AS stock_amt_total_mid
      FROM stock_monthly
      WHERE mid_category_kr IN ('신발', '모자', '가방', '기타')
      GROUP BY month, mid_category_kr
    ),
    
    -- 전월 재고 수량 집계 (정체재고 판단용, 조회 구간의 전월 포함)
    prev_month_stock AS (
      SELECT
        a.yymm AS month,
        ${dimConfig.stockKey} AS dimension_key,
        SUM(a.stock_qty_expected) AS prev_stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      WHERE ${prevYymmCondition}
        AND a.brd_cd = '${brand}'
        AND b.prdt_hrrc1_nm = 'ACC'
      GROUP BY a.yymm, ${dimConfig.stockKey}
    ),
    
    -- 재고+판매 조인하여 정체 여부 판단 (dimension 기준)
    combined AS (
      SELECT 
        st.month,
        st.dimension_key,
        st.style,
        st.season,
        st.mid_category_kr,
        st.stock_amt,
        COALESCE(sa.sales_amt, 0) AS sales_amt,
        mt.stock_amt_total_mid,
        -- 전월 수량 조회 (현재월 - 1)
        COALESCE(pms.prev_stock_qty, 0) AS prev_stock_qty,
        -- 스타일 기준 당월수량
        COALESCE(smq.current_stock_qty, 0) AS style_current_qty
      FROM stock_monthly st
      LEFT JOIN sales_monthly sa 
        ON st.month = sa.month AND st.dimension_key = sa.dimension_key
      LEFT JOIN mid_category_totals mt 
        ON st.month = mt.month AND st.mid_category_kr = mt.mid_category_kr
      LEFT JOIN prev_month_stock pms
        ON CASE 
            WHEN SUBSTR(st.month, 5, 2) = '01' THEN CAST(CAST(SUBSTR(st.month, 1, 4) AS INT) - 1 AS VARCHAR) || '12'
            ELSE SUBSTR(st.month, 1, 4) || LPAD(CAST(CAST(SUBSTR(st.month, 5, 2) AS INT) - 1 AS VARCHAR), 2, '0')
           END = pms.month 
        AND st.dimension_key = pms.dimension_key
      LEFT JOIN style_monthly_qty smq
        ON st.month = smq.month AND st.style = smq.style
      WHERE st.stock_amt > 0
        AND st.mid_category_kr IN ('신발', '모자', '가방', '기타')
    ),
    
    -- 3월 기준 당시즌 연도(YY): 기준월 3~12월이면 해당연도, 1~2월이면 전년
    with_season_base AS (
      SELECT 
        month,
        dimension_key,
        season,
        mid_category_kr,
        stock_amt,
        sales_amt,
        stock_amt_total_mid,
        prev_stock_qty,
        style_current_qty,
        CASE WHEN CAST(SUBSTR(month, 5, 2) AS INT) >= 3 THEN SUBSTR(month, 3, 2)
             ELSE SUBSTR(LPAD(CAST(CAST(SUBSTR(month, 1, 4) AS INT) - 1 AS VARCHAR), 4, '0'), 3, 2) END AS current_season_year
      FROM combined
    ),
    
    -- 시즌 그룹 분류 (3월 기준: 당시즌=YY*, 차기시즌=(YY+1)*, 과시즌=<YY*)
    with_season_group AS (
      SELECT 
        month,
        dimension_key,
        season,
        mid_category_kr,
        stock_amt,
        sales_amt,
        stock_amt_total_mid,
        prev_stock_qty,
        style_current_qty,
        CASE 
          WHEN style_current_qty < ${currentMonthMinQty} THEN '당월수량미달'
          WHEN SUBSTR(season, 1, 2) = current_season_year THEN '당시즌'
          WHEN SUBSTR(season, 1, 2) = LPAD(CAST(current_season_year AS INT) + 1, 2, '0') THEN '차기시즌'
          WHEN TRY_CAST(SUBSTR(season, 1, 2) AS INT) < CAST(current_season_year AS INT) THEN
            CASE WHEN prev_stock_qty < ${minQty} THEN '과시즌'
                 WHEN stock_amt_total_mid > 0 AND (sales_amt / stock_amt_total_mid) < ${thresholdRatio} THEN '정체재고'
                 ELSE '과시즌' END
          ELSE '과시즌'
        END AS season_group
      FROM with_season_base
    )
    
    -- 월별, 시즌그룹별 집계
    SELECT 
      month,
      season_group,
      SUM(stock_amt) AS stock_amt,
      SUM(sales_amt) AS sales_amt
    FROM with_season_group
    WHERE 1=1${itemFilterCondition}
    GROUP BY month, season_group
    ORDER BY month, season_group
  `;
}

// 결과를 MonthSeasonData 배열로 변환 (단일 연도 01~12용, month는 나중에 prefix 붙임)
function transformResults(rows: any[]): MonthSeasonData[] {
  const monthMap = new Map<string, MonthSeasonData>();

  // 12개월 초기화
  for (let m = 1; m <= 12; m++) {
    const monthStr = m.toString().padStart(2, "0");
    monthMap.set(monthStr, {
      month: monthStr,
      정체재고: { stock_amt: 0, sales_amt: 0 },
      과시즌: { stock_amt: 0, sales_amt: 0 },
      당시즌: { stock_amt: 0, sales_amt: 0 },
      차기시즌: { stock_amt: 0, sales_amt: 0 },
      당월수량미달: { stock_amt: 0, sales_amt: 0 },
      total_stock_amt: 0,
      total_sales_amt: 0,
    });
  }

  rows.forEach((row) => {
    const monthFull = row.MONTH; // YYYYMM
    const monthStr = monthFull.length === 6 ? monthFull.slice(-2) : monthFull;
    const seasonGroup = row.SEASON_GROUP as SeasonGroup;
    const stockAmt = Number(row.STOCK_AMT) || 0;
    const salesAmt = Number(row.SALES_AMT) || 0;

    const data = monthMap.get(monthStr);
    if (data && seasonGroup && data[seasonGroup]) {
      data[seasonGroup].stock_amt += stockAmt;
      data[seasonGroup].sales_amt += salesAmt;
      data.total_stock_amt += stockAmt;
      data.total_sales_amt += salesAmt;
    }
  });

  return Array.from(monthMap.values()).sort((a, b) =>
    parseInt(a.month) - parseInt(b.month)
  );
}

/** 지정한 YYYYMM 목록 순서로 MonthSeasonData 배열 생성 (행은 YYYYMM 키) */
function transformResultsByMonths(rows: any[], expectedMonths: string[]): MonthSeasonData[] {
  const monthMap = new Map<string, MonthSeasonData>();

  expectedMonths.forEach((ym) => {
    monthMap.set(ym, {
      month: ym,
      정체재고: { stock_amt: 0, sales_amt: 0 },
      과시즌: { stock_amt: 0, sales_amt: 0 },
      당시즌: { stock_amt: 0, sales_amt: 0 },
      차기시즌: { stock_amt: 0, sales_amt: 0 },
      당월수량미달: { stock_amt: 0, sales_amt: 0 },
      total_stock_amt: 0,
      total_sales_amt: 0,
    });
  });

  rows.forEach((row) => {
    const monthFull = String(row.MONTH);
    if (monthFull.length < 6) return;
    const data = monthMap.get(monthFull);
    const seasonGroup = row.SEASON_GROUP as SeasonGroup;
    const stockAmt = Number(row.STOCK_AMT) || 0;
    const salesAmt = Number(row.SALES_AMT) || 0;
    if (data && seasonGroup && data[seasonGroup]) {
      data[seasonGroup].stock_amt += stockAmt;
      data[seasonGroup].sales_amt += salesAmt;
      data.total_stock_amt += stockAmt;
      data.total_sales_amt += salesAmt;
    }
  });

  return expectedMonths.map((ym) => monthMap.get(ym)!).filter(Boolean);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InventorySeasonChartResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, thresholdPct, dimensionTab, itemFilter, minQty: minQtyParam, currentMonthMinQty: currentMonthMinQtyParam, referenceMonth: referenceMonthParam } = req.query;

  // 파라미터 검증
  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }

  const threshold = parseFloat(thresholdPct as string) || 0.01;
  const thresholdRatio = threshold / 100; // 0.01% → 0.0001
  const dimTab = (dimensionTab as DimensionTab) || "스타일";
  const itemTab = (itemFilter as ItemFilterTab) || "ACC합계";
  const minQty = parseInt(minQtyParam as string, 10) || 10; // 최소 수량 기준 (기본값 10) - 전월말 기준
  const currentMonthMinQty = parseInt(currentMonthMinQtyParam as string, 10) || 10; // 당월수량 기준 (기본값 10)
  
  // 기준월 파라미터 (기본값: 현재 날짜 기준)
  const referenceMonth = (referenceMonthParam as string) || (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}.${month}`;
  })();

  const { currentYear, nextYear } = getYearConfig(referenceMonth);
  const refNorm = referenceMonth.replace(".", "");

  try {
    // 기준월 포함 최근 12개월 (기준월-11 ~ 기준월) / 전년 동일 구간 12개월
    const currentMonths = getTwelveMonthsEndingAt(referenceMonth);
    const prevMonths: string[] = [];
    for (let i = 23; i >= 12; i--) {
      prevMonths.push(getMonthBeforeYYYYMM(referenceMonth, i));
    }

    // 당년 12개월: 연도별로 쿼리 후 병합
    const yearRangesCurrent = new Map<string, { start: string; end: string }>();
    currentMonths.forEach((ym) => {
      const y = ym.slice(0, 4);
      if (!yearRangesCurrent.has(y)) {
        yearRangesCurrent.set(y, { start: ym, end: ym });
      } else {
        const r = yearRangesCurrent.get(y)!;
        if (ym < r.start) r.start = ym;
        if (ym > r.end) r.end = ym;
      }
    });
    const allRowsCurrent: any[] = [];
    for (const [yearPrefix, range] of Array.from(yearRangesCurrent.entries())) {
      const q = buildMonthlyStockQuery(
        brand, yearPrefix, thresholdRatio, currentYear, nextYear,
        dimTab, itemTab, minQty, currentMonthMinQty, range.start, range.end
      );
      const rows = await runQuery(q);
      rows.forEach((r: any) => allRowsCurrent.push(r));
    }
    const data2025 = transformResultsByMonths(allRowsCurrent, currentMonths);

    // 전년 12개월: 연도별로 쿼리 후 병합
    const yearRangesPrev = new Map<string, { start: string; end: string }>();
    prevMonths.forEach((ym) => {
      const y = ym.slice(0, 4);
      if (!yearRangesPrev.has(y)) {
        yearRangesPrev.set(y, { start: ym, end: ym });
      } else {
        const r = yearRangesPrev.get(y)!;
        if (ym < r.start) r.start = ym;
        if (ym > r.end) r.end = ym;
      }
    });
    const allRowsPrev: any[] = [];
    for (const [yearPrefix, range] of Array.from(yearRangesPrev.entries())) {
      const prevY = yearPrefix.slice(-2);
      const prevNext = String(parseInt(prevY, 10) + 1).padStart(2, "0");
      const q = buildMonthlyStockQuery(
        brand, yearPrefix, thresholdRatio, prevY, prevNext,
        dimTab, itemTab, minQty, currentMonthMinQty, range.start, range.end
      );
      const rows = await runQuery(q);
      rows.forEach((r: any) => allRowsPrev.push(r));
    }
    const data2024 = transformResultsByMonths(allRowsPrev, prevMonths);

    const response: InventorySeasonChartResponse = {
      year2024: data2024,
      year2025: data2025,
      meta: {
        brand,
        thresholdPct: threshold,
        currentYear,
        nextYear,
        currentMonthMinQty,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Inventory season chart query error:", error);
    res.status(500).json({ error: String(error) });
  }
}

