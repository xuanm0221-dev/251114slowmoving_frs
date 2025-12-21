/**
 * Snowflake 쿼리 빌더 및 공통 CTE 정의
 * 
 * shop_id 정규화를 위한 3단계 매핑 전략:
 * 1. map_norm: oa_map_shop_id(4자리) 기준 최신 매장 정보
 * 2. map_cn: oa_shop_id(6자리 CNxxxx) 기준 최신 매장 정보
 * 3. map_internal: shop_id(내부키) 기준 최신 매장 정보
 */

// 브랜드 코드 매핑
export const BRAND_CODE_MAP: Record<string, string> = {
  'M': 'MLB',
  'I': 'MLB KIDS',
  'X': 'DISCOVERY'
};

export const BRAND_NAME_TO_CODE: Record<string, string> = {
  'MLB': 'M',
  'MLB KIDS': 'I',
  'DISCOVERY': 'X'
};

// 아이템 카테고리 매핑 (영문 → 한글)
export const ITEM_CATEGORY_MAP: Record<string, string> = {
  'Shoes': '신발',
  'Headwear': '모자',
  'Bag': '가방',
  'Acc_etc': '기타악세'
};

export const ITEM_TAB_TO_ENGLISH: Record<string, string> = {
  '전체': 'ALL',
  '신발': 'Shoes',
  '모자': 'Headwear',
  '가방': 'Bag',
  '기타악세': 'Acc_etc'
};

/**
 * 공통 CTE: shop_id 정규화 매핑 테이블 (3개 분리)
 * - map_norm: oa_map_shop_id 기준 (4자리 표준키)
 * - map_cn: oa_shop_id 기준 (6자리 CNxxxx)
 * - map_internal: shop_id 기준 (내부키)
 */
export const SHOP_MAPPING_CTES_3WAY = `
  map_norm AS (
    SELECT 
      TO_VARCHAR(oa_map_shop_id) AS norm_key,
      fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
      AND oa_map_shop_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(
      PARTITION BY oa_map_shop_id 
      ORDER BY open_dt DESC NULLS LAST
    ) = 1
  ),
  map_cn AS (
    SELECT 
      TO_VARCHAR(oa_shop_id) AS cn_key,
      TO_VARCHAR(oa_map_shop_id) AS norm_key,
      fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
      AND oa_shop_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(
      PARTITION BY oa_shop_id 
      ORDER BY open_dt DESC NULLS LAST
    ) = 1
  ),
  map_internal AS (
    SELECT 
      TO_VARCHAR(shop_id) AS internal_key,
      TO_VARCHAR(oa_map_shop_id) AS norm_key,
      fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
      AND shop_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(
      PARTITION BY shop_id 
      ORDER BY open_dt DESC NULLS LAST
    ) = 1
  )
`;

// 판매용 2개 맵 (기존 유지 - sales-data.ts용)
export const SHOP_MAPPING_CTES = `
  shop_map_norm AS (
    SELECT 
      TO_VARCHAR(oa_map_shop_id) AS norm_key,
      TO_VARCHAR(oa_shop_id) AS cn_key,
      fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
      AND oa_map_shop_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(
      PARTITION BY oa_map_shop_id 
      ORDER BY open_dt DESC NULLS LAST
    ) = 1
  ),
  shop_map_cn AS (
    SELECT 
      TO_VARCHAR(oa_map_shop_id) AS norm_key,
      TO_VARCHAR(oa_shop_id) AS cn_key,
      fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
      AND oa_shop_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(
      PARTITION BY oa_shop_id 
      ORDER BY open_dt DESC NULLS LAST
    ) = 1
  )
`;

/**
 * remark 분기별 매핑 테이블
 * 성능을 위해 CASE 문으로 분기별 remark 선택
 */
export function getRemarkColumnForQuarter(quarter: string): string {
  // quarter: '24.1Q', '24.2Q', '24.3Q', '24.4Q', '25.1Q', ...
  const remarkMap: Record<string, string> = {
    '24.1Q': 'remark1',
    '24.2Q': 'remark2',
    '24.3Q': 'remark3',
    '24.4Q': 'remark4',
    '25.1Q': 'remark5',
    '25.2Q': 'remark6',
    '25.3Q': 'remark7',
    '25.4Q': 'remark8',
  };
  return remarkMap[quarter] || 'remark8';
}

/**
 * CASE 기반 remark 선택 CTE
 * 월(YYYYMM)을 기준으로 해당 분기의 remark 컬럼 직접 선택
 */
export const REMARK_SELECTION_CTE = `
  remark_selected AS (
    SELECT 
      prdt_scs_cd,
      CASE 
        WHEN q_month BETWEEN '202401' AND '202403' THEN remark1
        WHEN q_month BETWEEN '202404' AND '202406' THEN remark2
        WHEN q_month BETWEEN '202407' AND '202409' THEN remark3
        WHEN q_month BETWEEN '202410' AND '202412' THEN remark4
        WHEN q_month BETWEEN '202501' AND '202503' THEN remark5
        WHEN q_month BETWEEN '202504' AND '202506' THEN remark6
        WHEN q_month BETWEEN '202507' AND '202509' THEN remark7
        WHEN q_month >= '202510' THEN remark8
        ELSE NULL
      END AS op_std,
      q_month
    FROM FNF.CHN.MST_PRDT_SCS
    CROSS JOIN (
      SELECT DISTINCT TO_CHAR(sale_dt, 'YYYYMM') AS q_month
      FROM CHN.DW_SALE
      WHERE sale_dt >= '2024-01-01' AND sale_dt < '2025-12-01'
    ) months
  )
`;

/**
 * 주력/아울렛 분류 로직 (CASE 문)
 * @param opStdColumn - op_std 컬럼명
 * @param sesnColumn - sesn 컬럼명
 * @param yearColumn - 해당 년도 2자리 컬럼 (예: RIGHT(sale_ym, 2))
 */
export function getProductTypeCase(opStdColumn: string, sesnColumn: string, yearColumn: string): string {
  return `
    CASE
      -- 1. FOCUS/INTRO는 무조건 주력
      WHEN ${opStdColumn} IN ('FOCUS', 'INTRO') THEN 'core'
      
      -- 2. op_std가 있고 숫자로 시작하면 연도 비교
      WHEN ${opStdColumn} IS NOT NULL 
        AND REGEXP_LIKE(${opStdColumn}, '^[0-9]{2}')
        AND TRY_TO_NUMBER(LEFT(${opStdColumn}, 2)) >= TRY_TO_NUMBER(${yearColumn})
      THEN 'core'
      
      -- 3. op_std가 NULL이면 sesn으로 판단
      WHEN ${opStdColumn} IS NULL
        AND ${sesnColumn} IS NOT NULL
        AND REGEXP_LIKE(${sesnColumn}, '^[0-9]{2}')
        AND TRY_TO_NUMBER(LEFT(${sesnColumn}, 2)) >= TRY_TO_NUMBER(${yearColumn})
      THEN 'core'
      
      -- 4. 그 외 모두 아울렛
      ELSE 'outlet'
    END
  `;
}

/**
 * 판매 데이터 집계 쿼리 생성
 * @param brandCode - 브랜드 코드 ('M', 'I', 'X')
 * @param startMonth - 시작월 (YYYYMM)
 * @param endMonth - 종료월 (YYYYMM)
 */
export function buildSalesAggregationQuery(
  brandCode: string,
  startMonth: string = '202401',
  endMonth: string = '202511'
): string {
  return `
WITH 
${SHOP_MAPPING_CTES},

-- Step 1: 원천 판매 데이터 추출
sales_raw AS (
  SELECT 
    TO_CHAR(s.sale_dt, 'YYYY.MM') AS sale_ym,
    TO_CHAR(s.sale_dt, 'YYYYMM') AS sale_yyyymm,
    s.brd_cd,
    p.prdt_kind_nm_en,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.tag_amt,
    p.sesn,
    s.prdt_scs_cd,
    p.remark1, p.remark2, p.remark3, p.remark4,
    p.remark5, p.remark6, p.remark7, p.remark8
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p 
    ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.sale_dt >= '2024-01-01'
    AND s.sale_dt < '2025-12-01'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')
),

-- Step 2: 매장 매핑 (LEFT JOIN, unmapped 추적)
sales_mapped AS (
  SELECT 
    sr.*,
    sm.fr_or_cls,
    CASE WHEN sm.fr_or_cls IS NULL THEN 1 ELSE 0 END AS is_unmapped
  FROM sales_raw sr
  LEFT JOIN shop_map_norm sm 
    ON sr.shop_id = sm.norm_key
),

-- Step 3: remark 적용 (CASE 기반)
sales_with_remark AS (
  SELECT 
    *,
    CASE 
      WHEN sale_yyyymm BETWEEN '202401' AND '202403' THEN remark1
      WHEN sale_yyyymm BETWEEN '202404' AND '202406' THEN remark2
      WHEN sale_yyyymm BETWEEN '202407' AND '202409' THEN remark3
      WHEN sale_yyyymm BETWEEN '202410' AND '202412' THEN remark4
      WHEN sale_yyyymm BETWEEN '202501' AND '202503' THEN remark5
      WHEN sale_yyyymm BETWEEN '202504' AND '202506' THEN remark6
      WHEN sale_yyyymm BETWEEN '202507' AND '202509' THEN remark7
      WHEN sale_yyyymm >= '202510' THEN remark8
      ELSE NULL
    END AS op_std
  FROM sales_mapped
),

-- Step 4: 주력/아울렛 분류
sales_classified AS (
  SELECT 
    sale_ym,
    sale_yyyymm,
    brd_cd,
    prdt_kind_nm_en,
    fr_or_cls,
    tag_amt,
    is_unmapped,
    ${getProductTypeCase('op_std', 'sesn', 'RIGHT(sale_yyyymm, 2)')} AS product_type
  FROM sales_with_remark
  WHERE fr_or_cls IN ('FR', 'OR')  -- HQ 제외, mapped만
),

-- Step 5: 최종 집계
sales_agg AS (
  SELECT 
    sale_ym,
    brd_cd,
    prdt_kind_nm_en AS item_category,
    fr_or_cls AS channel,
    product_type,
    SUM(tag_amt) AS total_amt,
    COUNT(*) AS record_count
  FROM sales_classified
  GROUP BY sale_ym, brd_cd, prdt_kind_nm_en, fr_or_cls, product_type
),

-- Meta: unmapped 통계
unmapped_stats AS (
  SELECT 
    COUNT(*) AS unmapped_records,
    SUM(tag_amt) AS unmapped_amount
  FROM sales_with_remark
  WHERE is_unmapped = 1
)

SELECT 
  sa.*,
  us.unmapped_records,
  us.unmapped_amount
FROM sales_agg sa
CROSS JOIN unmapped_stats us
ORDER BY sa.sale_ym, sa.brd_cd, sa.item_category, sa.channel, sa.product_type
  `;
}

/**
 * 재고 데이터 집계 쿼리 생성
 * @param brandCode - 브랜드 코드 ('M', 'I', 'X')
 * @param startMonth - 시작월 (YYYYMM)
 * @param endMonth - 종료월 (YYYYMM)
 */
export function buildInventoryAggregationQuery(
  brandCode: string,
  startMonth: string = '202401',
  endMonth: string = '202511'
): string {
  return `
WITH 
${SHOP_MAPPING_CTES_3WAY},

-- Step 1: 원천 재고 데이터 추출
stock_raw AS (
  SELECT 
    s.yymm,
    s.brd_cd,
    p.prdt_kind_nm_en,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.stock_tag_amt_expected,
    s.stock_qty_expected,
    p.sesn,
    s.prdt_scs_cd,
    p.remark1, p.remark2, p.remark3, p.remark4,
    p.remark5, p.remark6, p.remark7, p.remark8
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p 
    ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.yymm >= '${startMonth}'
    AND s.yymm <= '${endMonth}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')
),

-- Step 2: 매장 매핑 (3-way LEFT JOIN, 길이 분기 제거)
stock_mapped AS (
  SELECT 
    sr.yymm,
    sr.brd_cd,
    sr.prdt_kind_nm_en,
    sr.stock_tag_amt_expected,
    sr.stock_qty_expected,
    sr.sesn,
    sr.prdt_scs_cd,
    sr.remark1, sr.remark2, sr.remark3, sr.remark4,
    sr.remark5, sr.remark6, sr.remark7, sr.remark8,
    COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) AS fr_or_cls,
    COALESCE(mn.norm_key, mc.norm_key, mi.norm_key) AS final_norm_key,
    CASE 
      WHEN COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) IS NULL THEN 1 
      ELSE 0 
    END AS is_unmapped
  FROM stock_raw sr
  LEFT JOIN map_norm mn 
    ON sr.shop_id = mn.norm_key
  LEFT JOIN map_cn mc 
    ON sr.shop_id = mc.cn_key
  LEFT JOIN map_internal mi 
    ON sr.shop_id = mi.internal_key
),

-- Step 3: 필터링 (매핑된 것만)
stock_filtered AS (
  SELECT * 
  FROM stock_mapped
  WHERE fr_or_cls IN ('FR', 'OR', 'HQ')
),

-- Step 4: remark 적용 (CASE 기반)
stock_with_remark AS (
  SELECT 
    *,
    CASE 
      WHEN yymm BETWEEN '202401' AND '202403' THEN remark1
      WHEN yymm BETWEEN '202404' AND '202406' THEN remark2
      WHEN yymm BETWEEN '202407' AND '202409' THEN remark3
      WHEN yymm BETWEEN '202410' AND '202412' THEN remark4
      WHEN yymm BETWEEN '202501' AND '202503' THEN remark5
      WHEN yymm BETWEEN '202504' AND '202506' THEN remark6
      WHEN yymm BETWEEN '202507' AND '202509' THEN remark7
      WHEN yymm >= '202510' THEN remark8
      ELSE NULL
    END AS op_std
  FROM stock_filtered
),

-- Step 5: 주력/아울렛 분류
stock_classified AS (
  SELECT 
    yymm,
    brd_cd,
    prdt_kind_nm_en,
    fr_or_cls,
    stock_tag_amt_expected,
    stock_qty_expected,
    ${getProductTypeCase('op_std', 'sesn', 'RIGHT(yymm, 2)')} AS product_type
  FROM stock_with_remark
),

-- Step 6: 재고 최종 집계
stock_agg AS (
  SELECT 
    yymm,
    brd_cd,
    prdt_kind_nm_en AS item_category,
    fr_or_cls AS channel,
    product_type,
    SUM(stock_tag_amt_expected) AS total_amt,
    SUM(stock_qty_expected) AS total_qty,
    COUNT(*) AS record_count
  FROM stock_classified
  GROUP BY yymm, brd_cd, prdt_kind_nm_en, fr_or_cls, product_type
),

-- Step 7: OR 판매 데이터 추출 (직영재고 계산용)
or_sales_raw AS (
  SELECT 
    TO_CHAR(s.sale_dt, 'YYYYMM') AS sale_yymm,
    s.brd_cd,
    p.prdt_kind_nm_en,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.tag_amt,
    s.prdt_scs_cd,
    p.sesn,
    p.remark1, p.remark2, p.remark3, p.remark4,
    p.remark5, p.remark6, p.remark7, p.remark8
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p 
    ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') >= '${startMonth}'
    AND TO_CHAR(s.sale_dt, 'YYYYMM') <= '${endMonth}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')
),

-- Step 8: OR 판매 매핑 (OR 채널만 필터링)
or_sales_mapped AS (
  SELECT 
    osr.*,
    sm.fr_or_cls
  FROM or_sales_raw osr
  LEFT JOIN map_norm sm ON osr.shop_id = sm.norm_key
  WHERE sm.fr_or_cls = 'OR'
),

-- Step 9: OR 판매 remark 적용
or_sales_with_remark AS (
  SELECT 
    *,
    CASE 
      WHEN sale_yymm BETWEEN '202401' AND '202403' THEN remark1
      WHEN sale_yymm BETWEEN '202404' AND '202406' THEN remark2
      WHEN sale_yymm BETWEEN '202407' AND '202409' THEN remark3
      WHEN sale_yymm BETWEEN '202410' AND '202412' THEN remark4
      WHEN sale_yymm BETWEEN '202501' AND '202503' THEN remark5
      WHEN sale_yymm BETWEEN '202504' AND '202506' THEN remark6
      WHEN sale_yymm BETWEEN '202507' AND '202509' THEN remark7
      WHEN sale_yymm >= '202510' THEN remark8
      ELSE NULL
    END AS op_std
  FROM or_sales_mapped
),

-- Step 10: OR 판매 주력/아울렛 분류
or_sales_classified AS (
  SELECT 
    sale_yymm AS yymm,
    brd_cd,
    prdt_kind_nm_en,
    tag_amt,
    ${getProductTypeCase('op_std', 'sesn', 'RIGHT(sale_yymm, 2)')} AS product_type
  FROM or_sales_with_remark
),

-- Step 11: OR 판매 집계
or_sales_agg AS (
  SELECT 
    yymm,
    brd_cd,
    prdt_kind_nm_en AS item_category,
    product_type,
    SUM(tag_amt) AS or_sales_amt
  FROM or_sales_classified
  GROUP BY yymm, brd_cd, prdt_kind_nm_en, product_type
),

-- Meta: unmapped 통계
unmapped_stats AS (
  SELECT 
    COUNT(*) AS unmapped_records,
    SUM(stock_tag_amt_expected) AS unmapped_amount
  FROM stock_mapped
  WHERE is_unmapped = 1
)

-- 최종 결과: 재고 + OR 판매 조인
SELECT 
  sa.yymm,
  sa.brd_cd,
  sa.item_category,
  sa.channel,
  sa.product_type,
  sa.total_amt,
  sa.total_qty,
  sa.record_count,
  COALESCE(osa_core.or_sales_amt, 0) AS or_sales_amt_core,
  COALESCE(osa_outlet.or_sales_amt, 0) AS or_sales_amt_outlet,
  us.unmapped_records,
  us.unmapped_amount
FROM stock_agg sa
LEFT JOIN or_sales_agg osa_core 
  ON sa.yymm = osa_core.yymm 
  AND sa.brd_cd = osa_core.brd_cd 
  AND sa.item_category = osa_core.item_category
  AND osa_core.product_type = 'core'
LEFT JOIN or_sales_agg osa_outlet 
  ON sa.yymm = osa_outlet.yymm 
  AND sa.brd_cd = osa_outlet.brd_cd 
  AND sa.item_category = osa_outlet.item_category
  AND osa_outlet.product_type = 'outlet'
CROSS JOIN unmapped_stats us
ORDER BY sa.yymm, sa.brd_cd, sa.item_category, sa.channel, sa.product_type
  `;
}

/**
 * 월별 일수 계산
 */
export function getDaysInMonth(yyyymm: string): number {
  const year = parseInt(yyyymm.substring(0, 4));
  const month = parseInt(yyyymm.substring(4, 6));
  return new Date(year, month, 0).getDate();
}

/**
 * 월 목록 생성 (YYYY.MM 형식)
 */
export function generateMonths(start: string, end: string): string[] {
  const months: string[] = [];
  const startYear = parseInt(start.substring(0, 4));
  const startMonth = parseInt(start.substring(4, 6));
  const endYear = parseInt(end.substring(0, 4));
  const endMonth = parseInt(end.substring(4, 6));
  
  for (let y = startYear; y <= endYear; y++) {
    const mStart = (y === startYear) ? startMonth : 1;
    const mEnd = (y === endYear) ? endMonth : 12;
    for (let m = mStart; m <= mEnd; m++) {
      months.push(`${y}.${m.toString().padStart(2, '0')}`);
    }
  }
  
  return months;
}

