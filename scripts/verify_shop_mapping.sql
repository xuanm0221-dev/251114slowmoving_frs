/*
 * shop_id 매핑 검증 쿼리
 * 
 * 목적: 판매/재고 데이터의 shop_id 정규화 성공률 확인
 * 실행: Snowflake 콘솔에서 직접 실행
 */

-- ==================================================
-- 1. 매장 매핑 테이블 기본 통계
-- ==================================================
SELECT 
  '매장 매핑 테이블 기본 통계' AS section,
  COUNT(DISTINCT oa_map_shop_id) AS unique_norm_keys,
  COUNT(DISTINCT oa_shop_id) AS unique_cn_keys,
  COUNT(DISTINCT fr_or_cls) AS unique_channels,
  COUNT(*) AS total_records
FROM CHN.DW_SHOP_WH_DETAIL
WHERE fr_or_cls IS NOT NULL;

-- ==================================================
-- 2. 판매 데이터 shop_id 타입별 분포
-- ==================================================
WITH sales_shop_types AS (
  SELECT 
    CASE 
      WHEN LENGTH(TO_VARCHAR(shop_id)) = 4 THEN '4-digit'
      WHEN LENGTH(TO_VARCHAR(shop_id)) = 6 AND LEFT(TO_VARCHAR(shop_id), 2) = 'CN' THEN '6-digit-CN'
      ELSE 'other'
    END AS shop_id_type,
    shop_id,
    COUNT(*) AS transaction_count,
    SUM(tag_amt) AS total_amount
  FROM CHN.DW_SALE
  WHERE sale_dt >= '2024-01-01'
    AND sale_dt < '2025-12-01'
    AND brd_cd IN ('M', 'I', 'X')
  GROUP BY shop_id_type, shop_id
)
SELECT 
  '판매 데이터 shop_id 타입 분포' AS section,
  shop_id_type,
  COUNT(DISTINCT shop_id) AS unique_shops,
  SUM(transaction_count) AS total_transactions,
  ROUND(SUM(total_amount), 0) AS total_amount
FROM sales_shop_types
GROUP BY shop_id_type
ORDER BY shop_id_type;

-- ==================================================
-- 3. 재고 데이터 shop_id 타입별 분포
-- ==================================================
WITH stock_shop_types AS (
  SELECT 
    CASE 
      WHEN LENGTH(TO_VARCHAR(shop_id)) = 4 THEN '4-digit'
      WHEN LENGTH(TO_VARCHAR(shop_id)) = 6 AND LEFT(TO_VARCHAR(shop_id), 2) = 'CN' THEN '6-digit-CN'
      ELSE 'other'
    END AS shop_id_type,
    shop_id,
    COUNT(*) AS record_count,
    SUM(stock_tag_amt_expected) AS total_amount
  FROM CHN.DW_STOCK_M
  WHERE yymm >= '202401'
    AND yymm <= '202511'
    AND brd_cd IN ('M', 'I', 'X')
  GROUP BY shop_id_type, shop_id
)
SELECT 
  '재고 데이터 shop_id 타입 분포' AS section,
  shop_id_type,
  COUNT(DISTINCT shop_id) AS unique_shops,
  SUM(record_count) AS total_records,
  ROUND(SUM(total_amount), 0) AS total_amount
FROM stock_shop_types
GROUP BY shop_id_type
ORDER BY shop_id_type;

-- ==================================================
-- 4. 판매 데이터 매핑 성공률 (4자리)
-- ==================================================
WITH shop_map_norm AS (
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
sales_mapping_check AS (
  SELECT 
    TO_VARCHAR(s.shop_id) AS shop_id,
    sm.fr_or_cls,
    COUNT(*) AS transaction_count,
    SUM(s.tag_amt) AS total_amount
  FROM CHN.DW_SALE s
  LEFT JOIN shop_map_norm sm ON TO_VARCHAR(s.shop_id) = sm.norm_key
  WHERE s.sale_dt >= '2024-01-01'
    AND s.sale_dt < '2025-12-01'
    AND s.brd_cd IN ('M', 'I', 'X')
  GROUP BY TO_VARCHAR(s.shop_id), sm.fr_or_cls
)
SELECT 
  '판매 데이터 4자리 매핑 성공률' AS section,
  CASE WHEN fr_or_cls IS NOT NULL THEN 'mapped' ELSE 'unmapped' END AS mapping_status,
  COUNT(DISTINCT shop_id) AS unique_shops,
  SUM(transaction_count) AS total_transactions,
  ROUND(SUM(total_amount), 0) AS total_amount,
  ROUND(100.0 * SUM(transaction_count) / SUM(SUM(transaction_count)) OVER(), 2) AS pct_transactions,
  ROUND(100.0 * SUM(total_amount) / SUM(SUM(total_amount)) OVER(), 2) AS pct_amount
FROM sales_mapping_check
GROUP BY mapping_status
ORDER BY mapping_status;

-- ==================================================
-- 5. 재고 데이터 매핑 성공률 (4자리 + 6자리)
-- ==================================================
WITH shop_map_norm AS (
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
),
stock_normalized AS (
  SELECT 
    TO_VARCHAR(s.shop_id) AS shop_id,
    CASE 
      WHEN LENGTH(TO_VARCHAR(s.shop_id)) = 4 THEN TO_VARCHAR(s.shop_id)
      ELSE NULL
    END AS norm_key_direct,
    CASE 
      WHEN LENGTH(TO_VARCHAR(s.shop_id)) = 6 AND LEFT(TO_VARCHAR(s.shop_id), 2) = 'CN' 
      THEN TO_VARCHAR(s.shop_id)
      ELSE NULL
    END AS cn_key_lookup,
    COUNT(*) AS record_count,
    SUM(s.stock_tag_amt_expected) AS total_amount
  FROM CHN.DW_STOCK_M s
  WHERE s.yymm >= '202401'
    AND s.yymm <= '202511'
    AND s.brd_cd IN ('M', 'I', 'X')
  GROUP BY shop_id
),
stock_mapped AS (
  SELECT 
    sn.shop_id,
    CASE 
      WHEN LENGTH(sn.shop_id) = 4 THEN '4-digit'
      WHEN LENGTH(sn.shop_id) = 6 AND LEFT(sn.shop_id, 2) = 'CN' THEN '6-digit-CN'
      ELSE 'other'
    END AS shop_id_type,
    COALESCE(sm_norm.fr_or_cls, sm_cn.fr_or_cls) AS fr_or_cls,
    sn.record_count,
    sn.total_amount
  FROM stock_normalized sn
  LEFT JOIN shop_map_norm sm_norm ON sn.norm_key_direct = sm_norm.norm_key
  LEFT JOIN shop_map_cn sm_cn ON sn.cn_key_lookup = sm_cn.cn_key
)
SELECT 
  '재고 데이터 매핑 성공률 (타입별)' AS section,
  shop_id_type,
  CASE WHEN fr_or_cls IS NOT NULL THEN 'mapped' ELSE 'unmapped' END AS mapping_status,
  COUNT(DISTINCT shop_id) AS unique_shops,
  SUM(record_count) AS total_records,
  ROUND(SUM(total_amount), 0) AS total_amount,
  ROUND(100.0 * SUM(record_count) / SUM(SUM(record_count)) OVER(PARTITION BY shop_id_type), 2) AS pct_records
FROM stock_mapped
GROUP BY shop_id_type, mapping_status
ORDER BY shop_id_type, mapping_status;

-- ==================================================
-- 6. 미매핑 shop_id 상세 (판매)
-- ==================================================
WITH shop_map_norm AS (
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
)
SELECT 
  '미매핑 shop_id 상세 (판매)' AS section,
  TO_VARCHAR(s.shop_id) AS unmapped_shop_id,
  s.brd_cd,
  COUNT(*) AS transaction_count,
  ROUND(SUM(s.tag_amt), 0) AS total_amount
FROM CHN.DW_SALE s
LEFT JOIN shop_map_norm sm ON TO_VARCHAR(s.shop_id) = sm.norm_key
WHERE s.sale_dt >= '2024-01-01'
  AND s.sale_dt < '2025-12-01'
  AND s.brd_cd IN ('M', 'I', 'X')
  AND sm.fr_or_cls IS NULL
GROUP BY s.shop_id, s.brd_cd
ORDER BY total_amount DESC
LIMIT 20;

-- ==================================================
-- 7. 2025.11 MLB 판매 검증 (목표값 대조)
-- ==================================================
WITH shop_map_norm AS (
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
sales_202511 AS (
  SELECT 
    sm.fr_or_cls,
    SUM(s.tag_amt) AS total_amt
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  LEFT JOIN shop_map_norm sm ON TO_VARCHAR(s.shop_id) = sm.norm_key
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '202511'
    AND s.brd_cd = 'M'
    AND p.parent_prdt_kind_cd = 'A'
    AND p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')
    AND sm.fr_or_cls IN ('FR', 'OR')
  GROUP BY sm.fr_or_cls
)
SELECT 
  '2025.11 MLB 판매 검증' AS section,
  fr_or_cls AS channel,
  ROUND(total_amt, 0) AS actual_amount,
  CASE 
    WHEN fr_or_cls = 'FR' THEN 314337013
    WHEN fr_or_cls = 'OR' THEN 62527293
  END AS target_amount,
  ROUND(total_amt, 0) - CASE 
    WHEN fr_or_cls = 'FR' THEN 314337013
    WHEN fr_or_cls = 'OR' THEN 62527293
  END AS difference,
  ROUND(100.0 * total_amt / CASE 
    WHEN fr_or_cls = 'FR' THEN 314337013
    WHEN fr_or_cls = 'OR' THEN 62527293
  END, 2) AS pct_of_target
FROM sales_202511
UNION ALL
SELECT 
  '2025.11 MLB 판매 검증' AS section,
  'TOTAL' AS channel,
  ROUND(SUM(total_amt), 0) AS actual_amount,
  376864306 AS target_amount,
  ROUND(SUM(total_amt), 0) - 376864306 AS difference,
  ROUND(100.0 * SUM(total_amt) / 376864306, 2) AS pct_of_target
FROM sales_202511
ORDER BY channel;

