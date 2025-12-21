/*
 * 재고 총액 누락 검증 쿼리
 * 
 * 목표: 2025.11 MLB 전체재고 4,170,201,461 복원
 * 
 * 실행: Snowflake 콘솔에서 직접 실행
 */

USE DATABASE FNF;
USE SCHEMA CHN;

-- ==================================================
-- Q0: 원천 기준값 (매핑 전 순수 합계)
-- ==================================================
WITH prdt AS (
  SELECT prdt_scs_cd
  FROM FNF.CHN.MST_PRDT_SCS
  WHERE parent_prdt_kind_cd = 'A'
    AND prdt_kind_nm_en IN ('Shoes','Headwear','Bag','Acc_etc')
)
SELECT
  'Q0_RAW_BASE' AS query_name,
  '202511' AS yymm,
  'M' AS brd_cd,
  SUM(s.stock_tag_amt_expected) AS total_amt,
  COUNT(*) AS total_rows
FROM CHN.DW_STOCK_M s
JOIN prdt p ON s.prdt_scs_cd = p.prdt_scs_cd
WHERE s.yymm = '202511'
  AND s.brd_cd = 'M';
-- 목표: 약 4,170,201,461 (참고용)

-- ==================================================
-- Q1: API 최종 stock_agg 채널별 합계
-- ==================================================
WITH 
-- 매핑 테이블 1: norm_key(oa_map_shop_id) 기준
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

-- 매핑 테이블 2: cn_key(oa_shop_id) 기준
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

-- 매핑 테이블 3: internal_key(shop_id) 기준
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
),

prdt AS (
  SELECT prdt_scs_cd, prdt_kind_nm_en
  FROM FNF.CHN.MST_PRDT_SCS
  WHERE parent_prdt_kind_cd = 'A'
    AND prdt_kind_nm_en IN ('Shoes','Headwear','Bag','Acc_etc')
),

stock_raw AS (
  SELECT 
    s.yymm,
    s.brd_cd,
    p.prdt_kind_nm_en,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.stock_tag_amt_expected
  FROM CHN.DW_STOCK_M s
  JOIN prdt p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.yymm = '202511'
    AND s.brd_cd = 'M'
),

stock_mapped AS (
  SELECT 
    sr.*,
    COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) AS fr_or_cls
  FROM stock_raw sr
  LEFT JOIN map_norm mn ON sr.shop_id = mn.norm_key
  LEFT JOIN map_cn mc ON sr.shop_id = mc.cn_key
  LEFT JOIN map_internal mi ON sr.shop_id = mi.internal_key
),

stock_filtered AS (
  SELECT * 
  FROM stock_mapped
  WHERE fr_or_cls IN ('FR', 'OR', 'HQ')
)

-- 채널별 합계
SELECT
  'Q1_SQL_CHANNEL' AS query_name,
  fr_or_cls AS channel,
  SUM(stock_tag_amt_expected) AS channel_amt,
  COUNT(*) AS channel_rows
FROM stock_filtered
GROUP BY fr_or_cls

UNION ALL

-- 전체 합계
SELECT
  'Q1_SQL_TOTAL' AS query_name,
  'ALL' AS channel,
  SUM(stock_tag_amt_expected) AS channel_amt,
  COUNT(*) AS channel_rows
FROM stock_filtered;

-- 예상 결과: ALL = 4,170,201,461

-- ==================================================
-- Q2: Transform 직전 아이템별 합계
-- ==================================================
WITH 
map_norm AS (...),  -- 위와 동일
map_cn AS (...),
map_internal AS (...),
prdt AS (...),
stock_raw AS (...),
stock_mapped AS (...),
stock_filtered AS (...)

-- 아이템별 합계
SELECT
  'Q2_PRE_TRANSFORM' AS query_name,
  prdt_kind_nm_en AS item_category,
  SUM(stock_tag_amt_expected) AS item_amt,
  COUNT(*) AS item_rows
FROM stock_filtered
GROUP BY prdt_kind_nm_en

UNION ALL

-- 전체 합계
SELECT
  'Q2_PRE_TRANSFORM_TOTAL' AS query_name,
  'ALL_ITEMS' AS item_category,
  SUM(stock_tag_amt_expected) AS item_amt,
  COUNT(*) AS item_rows
FROM stock_filtered;

-- ==================================================
-- Q3: 매핑 통계 (unmapped 확인)
-- ==================================================
WITH 
map_norm AS (...),  -- 위와 동일
map_cn AS (...),
map_internal AS (...),
prdt AS (...),
stock_raw AS (...),
stock_mapped AS (...)

SELECT
  'Q3_MAPPING_STATS' AS query_name,
  CASE WHEN fr_or_cls IS NOT NULL THEN 'MAPPED' ELSE 'UNMAPPED' END AS status,
  CASE 
    WHEN LENGTH(shop_id) = 4 THEN '4-digit'
    WHEN LENGTH(shop_id) = 6 AND LEFT(shop_id, 2) = 'CN' THEN 'CN-6digit'
    ELSE 'internal'
  END AS key_type,
  COUNT(*) AS rows,
  SUM(stock_tag_amt_expected) AS amt
FROM stock_mapped
GROUP BY status, key_type
ORDER BY status, key_type;

-- 목표: UNMAPPED rows = 0 (또는 최소화)

