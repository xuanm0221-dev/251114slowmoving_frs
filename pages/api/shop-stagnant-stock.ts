import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import { BRAND_CODE_MAP } from "../../src/types/stagnantStock";

// 매장별 집계 데이터 (OR 직영매장 단위) - 매장+시즌+중분류 단위로 최적화
export interface ShopBreakdownItem {
  shop_id: string;
  shop_nm_en: string;
  onOffType: string | null;    // 온/오프라인 구분 (Online/Offline/null)
  dimensionKey: string;        // 빈 문자열 (집계 단위 변경으로 사용 안 함)
  prdt_nm_cn: string;          // 빈 문자열 (집계 단위 변경으로 사용 안 함)
  stock_amt: number;
  stock_qty: number;
  tag_amt: number;
  sale_amt: number;
  slow_cls: string;            // "전체" | "정체" | "정상"
  season_bucket: string;       // "차기시즌" | "당시즌" | "과시즌"
  mid_category: string;        // 중분류 (Shoes, Headwear 등)
  mid_category_kr: string;     // 중분류 한글 (신발, 모자 등)
  discount_rate: number | null;
  item_count: number;          // 품목 수
}

// 매장별 상품 단위 데이터 (모달용)
export interface ShopProductBreakdownItem {
  shop_id: string;
  shop_nm_en: string;
  onOffType: string | null;    // 온/오프라인 구분 (Online/Offline/null)
  prdt_cd: string;
  prdt_nm: string;
  season: string;
  season_bucket: string;
  mid_category_kr: string;
  stock_amt: number;
  stock_qty: number;
  tag_amt: number;
  sale_amt: number;
  is_slow: boolean;
}

export interface ShopStagnantStockResponse {
  shopBreakdown: ShopBreakdownItem[];
  shopProductBreakdown?: ShopProductBreakdownItem[];  // 상품 단위 데이터 (모달용)
  availableMonths: string[];
  meta: {
    targetMonth: string;
    brand: string;
    thresholdPct: number;
    daysInMonth: number;
  };
}

// 월의 일수 계산
function getDaysInMonth(yyyymm: string): number {
  if (yyyymm.length !== 6) return 30;
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return new Date(year, month, 0).getDate();
}

// 사용 가능한 월 목록 조회
function buildAvailableMonthsQuery(brand: string): string {
  return `
    SELECT DISTINCT a.yymm AS sale_ym
    FROM fnf.chn.dw_stock_m a
    JOIN fnf.chn.mst_shop_all m ON a.shop_id = m.shop_id
    WHERE a.brd_cd = '${brand}'
      AND m.fr_or_cls = 'OR'
      AND a.yymm >= '202401'
    ORDER BY sale_ym DESC
  `;
}

// OR 직영매장 정체재고 분석 쿼리
// 상품단위 정체분석 결과를 OR 매장별로 분배하는 방식
// 핵심: 상품단위 분석의 정체 판정 로직을 100% 동일하게 사용
function buildShopStagnantStockQuery(
  brand: string,
  targetMonth: string,
  threshold: number
): string {
  // 현재 연도 계산 (시즌 구분용) - 상품단위 분석과 동일
  const currentYear = targetMonth.slice(2, 4); // "202511" -> "25"
  const nextYear = String(parseInt(currentYear) + 1); // "26"
  
  return `
WITH
-- 1. 전체 채널(OR+HQ+FR) 재고 집계 (prdt_scs_cd 단위)
-- 시즌: sesn 컬럼 사용 (상품단위 분석과 동일)
stock_all AS (
  SELECT 
    a.prdt_scs_cd,
    MAX(a.prdt_cd) AS prdt_cd,
    MAX(b.prdt_nm) AS prdt_nm,
    MAX(a.sesn) AS season,
    MAX(CASE
      WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
      WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
      WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
      WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
      ELSE b.prdt_hrrc2_nm
    END) AS mid_category_kr,
    SUM(a.stock_tag_amt_expected) AS stock_amt,
    SUM(a.stock_qty_expected) AS stock_qty
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  LEFT JOIN fnf.chn.dw_shop_wh_detail c ON a.shop_id = c.oa_map_shop_id
  WHERE a.yymm = '${targetMonth}'
    AND a.brd_cd = '${brand}'
    AND b.prdt_hrrc1_nm = 'ACC'
  GROUP BY a.prdt_scs_cd
),

-- 2. 전체 채널(OR+HQ+FR) 판매 집계 (prdt_scs_cd 단위)
sales_all AS (
  SELECT 
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS sales_tag_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '${targetMonth}'
    AND s.brd_cd = '${brand}'
    AND p.prdt_hrrc1_nm = 'ACC'
    AND d.fr_or_cls IN ('FR', 'OR', 'HQ')
  GROUP BY s.prdt_scs_cd
),

-- 3. 중분류별 재고 합계 (정체 판정 분모) - 상품단위와 동일
mid_category_totals AS (
  SELECT 
    mid_category_kr,
    SUM(stock_amt) AS stock_amt_total_mid
  FROM stock_all
  WHERE mid_category_kr IN ('신발', '모자', '가방', '기타')
  GROUP BY mid_category_kr
),

-- 4. 상품별 정체/정상 판정 (prdt_scs_cd 단위)
product_status AS (
  SELECT 
    st.prdt_scs_cd,
    st.prdt_cd,
    st.prdt_nm,
    st.season,
    st.mid_category_kr,
    st.stock_amt,
    st.stock_qty,
    COALESCE(sa.sales_tag_amt, 0) AS sales_tag_amt,
    mt.stock_amt_total_mid,
    CASE 
      WHEN mt.stock_amt_total_mid > 0 THEN COALESCE(sa.sales_tag_amt, 0) / mt.stock_amt_total_mid
      ELSE 0
    END AS ratio,
    -- 시즌 구분
    CASE
      WHEN st.season IS NOT NULL AND st.season LIKE '${currentYear}%' THEN '당시즌'
      WHEN st.season IS NOT NULL AND st.season LIKE '${nextYear}%' THEN '차기시즌'
      ELSE '과시즌'
    END AS season_bucket,
    -- 정체 판정: 과시즌 + ratio < threshold
    CASE
      WHEN (st.season IS NULL OR (NOT st.season LIKE '${currentYear}%' AND NOT st.season LIKE '${nextYear}%'))
        THEN CASE
          WHEN mt.stock_amt_total_mid > 0 AND (COALESCE(sa.sales_tag_amt, 0) / mt.stock_amt_total_mid) < ${threshold}
          THEN 1
          ELSE 0
        END
      ELSE 0
    END AS is_slow
  FROM stock_all st
  LEFT JOIN sales_all sa ON st.prdt_scs_cd = sa.prdt_scs_cd
  LEFT JOIN mid_category_totals mt ON st.mid_category_kr = mt.mid_category_kr
  WHERE st.mid_category_kr IN ('신발', '모자', '가방', '기타')
    AND st.stock_amt > 0
),

-- 5. OR + HQ 매장/창고 목록 (상품단위 분석과 동일하게 HQ 포함)
shop_or_hq AS (
  SELECT 
    d.oa_map_shop_id AS shop_id,
    COALESCE(m.shop_nm_en, d.oa_map_shop_id) AS shop_nm_en,
    COALESCE(d.fr_or_cls, 'HQ') AS channel
  FROM fnf.chn.dw_shop_wh_detail d
  LEFT JOIN fnf.chn.mst_shop_all m ON d.oa_map_shop_id = m.shop_id
  WHERE COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
),

-- 6. OR+HQ 재고 (prdt_scs_cd로 product_status와 조인)
-- LEFT JOIN으로 변경하여 product_status에 없는 상품도 포함
or_stock_base AS (
  SELECT
    a.shop_id,
    COALESCE(m.shop_nm_en, a.shop_id) AS shop_nm_en,
    m.anlys_onoff_cls_nm,
    a.prdt_scs_cd,
    a.prdt_cd,
    b.prdt_nm,
    CASE
      WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
      WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
      WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
      WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
      ELSE b.prdt_hrrc2_nm
    END AS mid_category_kr,
    a.sesn AS season,
    a.stock_tag_amt_expected,
    a.stock_qty_expected
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON a.shop_id = d.oa_map_shop_id
  LEFT JOIN fnf.chn.mst_shop_all m ON a.shop_id = m.shop_id
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  WHERE a.yymm = '${targetMonth}'
    AND a.brd_cd = '${brand}'
    AND b.prdt_hrrc1_nm = 'ACC'
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
),

-- 7. OR 재고에 정체 판정 결과 조인
or_stock AS (
  SELECT
    os.shop_id,
    os.shop_nm_en,
    os.anlys_onoff_cls_nm,
    os.prdt_scs_cd,
    os.prdt_cd,
    os.prdt_nm,
    os.mid_category_kr,
    -- 시즌 구분
    CASE
      WHEN os.season IS NOT NULL AND os.season LIKE '${currentYear}%' THEN '당시즌'
      WHEN os.season IS NOT NULL AND os.season LIKE '${nextYear}%' THEN '차기시즌'
      ELSE '과시즌'
    END AS season_bucket,
    -- 정체 판정: product_status에서 가져옴
    COALESCE(ps.is_slow, 0) AS is_slow,
    os.stock_tag_amt_expected,
    os.stock_qty_expected
  FROM or_stock_base os
  LEFT JOIN product_status ps ON os.prdt_scs_cd = ps.prdt_scs_cd
  WHERE os.mid_category_kr IN ('신발', '모자', '가방', '기타')
),

-- 8. OR+HQ 매장별 판매
or_sale AS (
  SELECT
    s.shop_id,
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS tag_sale_amt,
    SUM(s.sale_amt) AS sale_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '${targetMonth}'
    AND s.brd_cd = '${brand}'
    AND p.prdt_hrrc1_nm = 'ACC'
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
  GROUP BY s.shop_id, s.prdt_scs_cd
),

-- 9. OR 매장별 재고+판매 조인
or_stock_sale AS (
  SELECT
    os.shop_id,
    os.shop_nm_en,
    os.anlys_onoff_cls_nm,
    os.prdt_scs_cd,
    os.prdt_cd,
    os.prdt_nm,
    os.mid_category_kr,
    os.season_bucket,
    os.is_slow,
    os.stock_tag_amt_expected,
    os.stock_qty_expected,
    COALESCE(osa.tag_sale_amt, 0) AS tag_sale_amt,
    COALESCE(osa.sale_amt, 0) AS sale_amt
  FROM or_stock os
  LEFT JOIN or_sale osa ON os.shop_id = osa.shop_id AND os.prdt_scs_cd = osa.prdt_scs_cd
),

-- 10. 매장 + 시즌 + 중분류 단위로 집계
agg AS (
  SELECT
    shop_id,
    shop_nm_en,
    anlys_onoff_cls_nm,
    CASE WHEN is_slow = 1 THEN '정체' ELSE '정상' END AS slow_cls,
    season_bucket,
    mid_category_kr AS mid_category,
    mid_category_kr,
    SUM(stock_tag_amt_expected) AS stock_amt,
    SUM(stock_qty_expected) AS stock_qty,
    SUM(tag_sale_amt) AS tag_amt,
    SUM(sale_amt) AS sale_amt,
    COUNT(DISTINCT prdt_scs_cd) AS item_count
  FROM or_stock_sale
  GROUP BY 
    shop_id, shop_nm_en, anlys_onoff_cls_nm,
    is_slow, season_bucket, mid_category_kr
),

-- 11. 전체 집계 (UNION)
agg_all AS (
  SELECT
    shop_id,
    shop_nm_en,
    anlys_onoff_cls_nm,
    '전체' AS slow_cls,
    season_bucket,
    mid_category,
    mid_category_kr,
    SUM(stock_amt) AS stock_amt,
    SUM(stock_qty) AS stock_qty,
    SUM(tag_amt) AS tag_amt,
    SUM(sale_amt) AS sale_amt,
    SUM(item_count) AS item_count
  FROM agg
  GROUP BY 
    shop_id, shop_nm_en, anlys_onoff_cls_nm,
    season_bucket, mid_category, mid_category_kr
),

-- 12. 최종 결합
combined AS (
  SELECT
    shop_id,
    shop_nm_en,
    anlys_onoff_cls_nm,
    slow_cls,
    season_bucket,
    mid_category,
    mid_category_kr,
    stock_amt,
    stock_qty,
    tag_amt,
    sale_amt,
    item_count,
    CASE
      WHEN tag_amt = 0 THEN NULL
      ELSE 1 - (sale_amt / tag_amt)
    END AS discount_rate
  FROM agg
  
  UNION ALL
  
  SELECT
    shop_id,
    shop_nm_en,
    anlys_onoff_cls_nm,
    slow_cls,
    season_bucket,
    mid_category,
    mid_category_kr,
    stock_amt,
    stock_qty,
    tag_amt,
    sale_amt,
    item_count,
    CASE
      WHEN tag_amt = 0 THEN NULL
      ELSE 1 - (sale_amt / tag_amt)
    END AS discount_rate
  FROM agg_all
)

-- 최종 SELECT
SELECT 
  shop_id,
  shop_nm_en,
  anlys_onoff_cls_nm AS onOffType,
  '' AS dimension_key,
  '' AS prdt_nm_cn,
  stock_amt,
  stock_qty,
  tag_amt,
  sale_amt,
  slow_cls,
  season_bucket,
  mid_category,
  mid_category_kr,
  discount_rate,
  item_count
FROM combined
WHERE stock_amt > 0
ORDER BY shop_id, slow_cls, season_bucket, mid_category;
  `;
}

// 상품 단위 데이터 쿼리 (모달용)
function buildShopProductBreakdownQuery(
  brand: string,
  targetMonth: string,
  threshold: number
): string {
  const currentYear = targetMonth.slice(2, 4);
  const nextYear = String(parseInt(currentYear) + 1);
  
  return `
WITH
-- 전체 채널 재고 집계 (prdt_scs_cd 단위)
stock_all AS (
  SELECT 
    a.prdt_scs_cd,
    MAX(a.prdt_cd) AS prdt_cd,
    MAX(b.prdt_nm) AS prdt_nm,
    MAX(a.sesn) AS season,
    MAX(CASE
      WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
      WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
      WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
      WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
      ELSE b.prdt_hrrc2_nm
    END) AS mid_category_kr,
    SUM(a.stock_tag_amt_expected) AS stock_amt,
    SUM(a.stock_qty_expected) AS stock_qty
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  LEFT JOIN fnf.chn.dw_shop_wh_detail c ON a.shop_id = c.oa_map_shop_id
  WHERE a.yymm = '${targetMonth}'
    AND a.brd_cd = '${brand}'
    AND b.prdt_hrrc1_nm = 'ACC'
  GROUP BY a.prdt_scs_cd
),

-- 전체 채널 판매 집계 (prdt_scs_cd 단위)
sales_all AS (
  SELECT 
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS sales_tag_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '${targetMonth}'
    AND s.brd_cd = '${brand}'
    AND p.prdt_hrrc1_nm = 'ACC'
    AND d.fr_or_cls IN ('FR', 'OR', 'HQ')
  GROUP BY s.prdt_scs_cd
),

-- 중분류별 재고 합계
mid_category_totals AS (
  SELECT 
    mid_category_kr,
    SUM(stock_amt) AS stock_amt_total_mid
  FROM stock_all
  WHERE mid_category_kr IN ('신발', '모자', '가방', '기타')
  GROUP BY mid_category_kr
),

-- 상품별 정체 판정 (prdt_scs_cd 단위)
product_status AS (
  SELECT 
    st.prdt_scs_cd,
    st.prdt_cd,
    st.prdt_nm,
    st.season,
    st.mid_category_kr,
    CASE
      WHEN st.season IS NOT NULL AND st.season LIKE '${currentYear}%' THEN '당시즌'
      WHEN st.season IS NOT NULL AND st.season LIKE '${nextYear}%' THEN '차기시즌'
      ELSE '과시즌'
    END AS season_bucket,
    CASE
      WHEN (st.season IS NULL OR (NOT st.season LIKE '${currentYear}%' AND NOT st.season LIKE '${nextYear}%'))
        THEN CASE
          WHEN mt.stock_amt_total_mid > 0 AND (COALESCE(sa.sales_tag_amt, 0) / mt.stock_amt_total_mid) < ${threshold}
          THEN 1
          ELSE 0
        END
      ELSE 0
    END AS is_slow
  FROM stock_all st
  LEFT JOIN sales_all sa ON st.prdt_scs_cd = sa.prdt_scs_cd
  LEFT JOIN mid_category_totals mt ON st.mid_category_kr = mt.mid_category_kr
  WHERE st.mid_category_kr IN ('신발', '모자', '가방', '기타')
    AND st.stock_amt > 0
),

-- OR+HQ 매장별 재고 (prdt_scs_cd 단위)
or_stock AS (
  SELECT
    a.shop_id,
    COALESCE(m.shop_nm_en, a.shop_id) AS shop_nm_en,
    m.anlys_onoff_cls_nm,
    a.prdt_scs_cd,
    a.prdt_cd,
    b.prdt_nm,
    CASE
      WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
      WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
      WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
      WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
      ELSE b.prdt_hrrc2_nm
    END AS mid_category_kr,
    a.sesn AS season,
    a.stock_tag_amt_expected AS stock_amt,
    a.stock_qty_expected AS stock_qty
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON a.shop_id = d.oa_map_shop_id
  LEFT JOIN fnf.chn.mst_shop_all m ON a.shop_id = m.shop_id
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  WHERE a.yymm = '${targetMonth}'
    AND a.brd_cd = '${brand}'
    AND b.prdt_hrrc1_nm = 'ACC'
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
),

-- OR+HQ 매장별 판매 (prdt_scs_cd 단위)
or_sale AS (
  SELECT
    s.shop_id,
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS tag_amt,
    SUM(s.sale_amt) AS sale_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '${targetMonth}'
    AND s.brd_cd = '${brand}'
    AND p.prdt_hrrc1_nm = 'ACC'
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
  GROUP BY s.shop_id, s.prdt_scs_cd
)

-- 최종: 매장+상품 단위 데이터 (prdt_scs_cd 단위)
SELECT 
  os.shop_id,
  os.shop_nm_en,
  os.anlys_onoff_cls_nm AS onOffType,
  os.prdt_scs_cd,
  os.prdt_cd,
  os.prdt_nm,
  os.season,
  COALESCE(ps.season_bucket, '과시즌') AS season_bucket,
  os.mid_category_kr,
  os.stock_amt,
  os.stock_qty,
  COALESCE(osa.tag_amt, 0) AS tag_amt,
  COALESCE(osa.sale_amt, 0) AS sale_amt,
  COALESCE(ps.is_slow, 0) AS is_slow
FROM or_stock os
LEFT JOIN product_status ps ON os.prdt_scs_cd = ps.prdt_scs_cd
LEFT JOIN or_sale osa ON os.shop_id = osa.shop_id AND os.prdt_scs_cd = osa.prdt_scs_cd
WHERE os.mid_category_kr IN ('신발', '모자', '가방', '기타')
  AND os.stock_amt > 0
ORDER BY os.shop_id, os.stock_amt DESC;
  `;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ShopStagnantStockResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      brand: brandParam,
      targetMonth: targetMonthParam,
      thresholdPct: thresholdPctParam,
    } = req.query;

    // 파라미터 검증
    if (!brandParam || !targetMonthParam) {
      return res.status(400).json({ error: "brand and targetMonth are required" });
    }

    const brand = BRAND_CODE_MAP[brandParam as string] || (brandParam as string);
    const targetMonth = targetMonthParam as string;
    const thresholdPct = parseFloat(thresholdPctParam as string) || 0.01;
    const threshold = thresholdPct / 100; // % → 비율
    const daysInMonth = getDaysInMonth(targetMonth);

    // 1. 사용 가능한 월 목록 조회
    const monthsQuery = buildAvailableMonthsQuery(brand);
    const monthsResult = await runQuery(monthsQuery);
    const availableMonths = monthsResult.map((row: any) => row.SALE_YM);

    // 2. OR 직영매장 정체재고 분석 쿼리 실행 (집계 데이터)
    const shopQuery = buildShopStagnantStockQuery(brand, targetMonth, threshold);
    const shopResult = await runQuery(shopQuery);

    // 3. 상품 단위 데이터 쿼리 실행 (모달용)
    const productQuery = buildShopProductBreakdownQuery(brand, targetMonth, threshold);
    const productResult = await runQuery(productQuery);

    // 4. 결과 매핑 - 집계 데이터
    const shopBreakdown: ShopBreakdownItem[] = shopResult.map((row: any) => ({
      shop_id: row.SHOP_ID || "",
      shop_nm_en: row.SHOP_NM_EN || row.SHOP_ID || "",
      onOffType: row.ONOFFTYPE || null,
      dimensionKey: row.DIMENSION_KEY || "",
      prdt_nm_cn: row.PRDT_NM_CN || "",
      stock_amt: Number(row.STOCK_AMT) || 0,
      stock_qty: Number(row.STOCK_QTY) || 0,
      tag_amt: Number(row.TAG_AMT) || 0,
      sale_amt: Number(row.SALE_AMT) || 0,
      slow_cls: row.SLOW_CLS || "전체",
      season_bucket: row.SEASON_BUCKET || "",
      mid_category: row.MID_CATEGORY || "",
      mid_category_kr: row.MID_CATEGORY_KR || "기타악세",
      discount_rate: row.DISCOUNT_RATE !== null ? Number(row.DISCOUNT_RATE) : null,
      item_count: Number(row.ITEM_COUNT) || 0,
    }));

    // 5. 결과 매핑 - 상품 단위 데이터 (prdt_scs_cd 단위)
    const shopProductBreakdown: ShopProductBreakdownItem[] = productResult.map((row: any) => ({
      shop_id: row.SHOP_ID || "",
      shop_nm_en: row.SHOP_NM_EN || row.SHOP_ID || "",
      onOffType: row.ONOFFTYPE || null,
      prdt_cd: row.PRDT_SCS_CD || "",  // prdt_scs_cd를 prdt_cd 필드에 저장
      prdt_nm: row.PRDT_NM || "",
      season: row.SEASON || "",
      season_bucket: row.SEASON_BUCKET || "과시즌",
      mid_category_kr: row.MID_CATEGORY_KR || "기타",
      stock_amt: Number(row.STOCK_AMT) || 0,
      stock_qty: Number(row.STOCK_QTY) || 0,
      tag_amt: Number(row.TAG_AMT) || 0,
      sale_amt: Number(row.SALE_AMT) || 0,
      is_slow: row.IS_SLOW === 1 || row.IS_SLOW === true,
    }));

    // 6. 응답 생성
    const response: ShopStagnantStockResponse = {
      shopBreakdown,
      shopProductBreakdown,
      availableMonths,
      meta: {
        targetMonth,
        brand: brandParam as string,
        thresholdPct,
        daysInMonth,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Shop stagnant stock API error:", error);
    res.status(500).json({ error: String(error) });
  }
}
