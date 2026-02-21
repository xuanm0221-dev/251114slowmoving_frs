"""
직영매장 정체재고 데이터 전처리 스크립트
- Snowflake에서 직영매장 정체재고 데이터 조회
- 브랜드별, 기준월별로 데이터 저장
- public/data/shop_stagnant_stock_summary.json 생성
"""

import json
import calendar
from pathlib import Path
from typing import Dict, List, Any, Optional
import sys

# 프로젝트 루트로 경로 추가
sys.path.insert(0, str(Path(__file__).parent))

from snowflake_utils import execute_query

# ========== 설정 ==========
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data"

VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}
BRAND_CODE_MAP = {
    "MLB": "M",
    "MLB KIDS": "I",
    "DISCOVERY": "X"
}


def get_days_in_month(yyyymm: str) -> int:
    """월의 일수 계산"""
    if len(yyyymm) != 6:
        return 30
    year = int(yyyymm[:4])
    month = int(yyyymm[4:6])
    return calendar.monthrange(year, month)[1]


def build_available_months_query(brand: str) -> str:
    """사용 가능한 월 목록 조회"""
    return f"""
    SELECT DISTINCT a.yymm AS sale_ym
    FROM fnf.chn.dw_stock_m a
    JOIN fnf.chn.mst_shop_all m ON a.shop_id = m.shop_id
    WHERE a.brd_cd = '{brand}'
      AND m.fr_or_cls = 'OR'
      AND a.yymm >= '202401'
    ORDER BY sale_ym DESC
    """


def build_shop_stagnant_stock_query(
    brand: str,
    target_month: str,
    threshold: float
) -> str:
    """OR 직영매장 정체재고 분석 쿼리"""
    current_year = target_month[2:4]  # "202511" -> "25"
    next_year = str(int(current_year) + 1).zfill(2)  # "26"
    
    return f"""
WITH
acc_item_map AS (
  SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
  FROM FNF.PRCS.DB_PRDT
  WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
),

-- 1. 전체 채널(OR+HQ+FR) 재고 집계 (prdt_scs_cd 단위)
stock_all AS (
  SELECT 
    a.prdt_scs_cd,
    MAX(a.prdt_cd) AS prdt_cd,
    MAX(b.prdt_nm) AS prdt_nm,
    MAX(a.sesn) AS season,
    MAX(CASE
      WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
      WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
      WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
      WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
      ELSE db.PRDT_KIND_NM_ENG
    END) AS mid_category_kr,
    SUM(COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0)) AS stock_amt,
    SUM(a.stock_qty_expected) AS stock_qty
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN fnf.chn.dw_shop_wh_detail c ON a.shop_id = c.oa_map_shop_id
  WHERE a.yymm = '{target_month}'
    AND a.brd_cd = '{brand}'
    AND db.ITEM IS NOT NULL
  GROUP BY a.prdt_scs_cd
),

-- 2. 전체 채널(OR+HQ+FR) 판매 집계 (prdt_scs_cd 단위)
sales_all AS (
  SELECT 
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS sales_tag_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '{target_month}'
    AND s.brd_cd = '{brand}'
    AND db.ITEM IS NOT NULL
    AND d.fr_or_cls IN ('FR', 'OR', 'HQ')
  GROUP BY s.prdt_scs_cd
),

-- 3. 중분류별 재고 합계 (정체 판정 분모)
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
      WHEN st.season IS NOT NULL AND st.season LIKE '{current_year}%' THEN '당시즌'
      WHEN st.season IS NOT NULL AND st.season LIKE '{next_year}%' THEN '차기시즌'
      ELSE '과시즌'
    END AS season_bucket,
    -- 정체 판정: 과시즌 + ratio < threshold
    CASE
      WHEN (st.season IS NULL OR (NOT st.season LIKE '{current_year}%' AND NOT st.season LIKE '{next_year}%'))
        THEN CASE
          WHEN mt.stock_amt_total_mid > 0 AND (COALESCE(sa.sales_tag_amt, 0) / mt.stock_amt_total_mid) < {threshold}
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

-- 5. OR + HQ 재고 (prdt_scs_cd로 product_status와 조인)
or_stock_base AS (
  SELECT
    a.shop_id,
    COALESCE(m.shop_nm_en, a.shop_id) AS shop_nm_en,
    m.anlys_onoff_cls_nm,
    a.prdt_scs_cd,
    a.prdt_cd,
    b.prdt_nm,
    CASE
      WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
      WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
      WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
      WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
      ELSE db.PRDT_KIND_NM_ENG
    END AS mid_category_kr,
    a.sesn AS season,
    COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0) AS stock_tag_amt_expected,
    a.stock_qty_expected
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON a.shop_id = d.oa_map_shop_id
  LEFT JOIN fnf.chn.mst_shop_all m ON a.shop_id = m.shop_id
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
  WHERE a.yymm = '{target_month}'
    AND a.brd_cd = '{brand}'
    AND db.ITEM IS NOT NULL
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
),

-- 6. OR 재고에 정체 판정 결과 조인
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
      WHEN os.season IS NOT NULL AND os.season LIKE '{current_year}%' THEN '당시즌'
      WHEN os.season IS NOT NULL AND os.season LIKE '{next_year}%' THEN '차기시즌'
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

-- 7. OR+HQ 매장별 판매
or_sale AS (
  SELECT
    s.shop_id,
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS tag_sale_amt,
    SUM(s.sale_amt) AS sale_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '{target_month}'
    AND s.brd_cd = '{brand}'
    AND db.ITEM IS NOT NULL
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
  GROUP BY s.shop_id, s.prdt_scs_cd
),

-- 8. OR 매장별 재고+판매 조인
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

-- 9. 매장 + 시즌 + 중분류 단위로 집계
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

-- 10. 전체 집계 (UNION)
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

-- 11. 최종 결합
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
    """


def build_shop_product_breakdown_query(
    brand: str,
    target_month: str,
    threshold: float
) -> str:
    """상품 단위 데이터 쿼리 (모달용)"""
    current_year = target_month[2:4]
    next_year = str(int(current_year) + 1).zfill(2)
    
    return f"""
WITH
acc_item_map AS (
  SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
  FROM FNF.PRCS.DB_PRDT
  WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
),

-- 상품별 정체 판정 (product_status와 동일)
product_status AS (
  SELECT 
    st.prdt_scs_cd,
    CASE
      WHEN (st.season IS NULL OR (NOT st.season LIKE '{current_year}%' AND NOT st.season LIKE '{next_year}%'))
        THEN CASE
          WHEN mt.stock_amt_total_mid > 0 AND (COALESCE(sa.sales_tag_amt, 0) / mt.stock_amt_total_mid) < {threshold}
          THEN 1
          ELSE 0
        END
      ELSE 0
    END AS is_slow
  FROM (
    SELECT 
      a.prdt_scs_cd,
      MAX(a.sesn) AS season,
      SUM(COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0)) AS stock_amt
    FROM fnf.chn.dw_stock_m a
    LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
    WHERE a.yymm = '{target_month}'
      AND a.brd_cd = '{brand}'
      AND db.ITEM IS NOT NULL
    GROUP BY a.prdt_scs_cd
  ) st
  LEFT JOIN (
    SELECT 
      s.prdt_scs_cd,
      SUM(s.tag_amt) AS sales_tag_amt
    FROM fnf.chn.dw_sale s
    LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
    LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
    WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '{target_month}'
      AND s.brd_cd = '{brand}'
      AND db.ITEM IS NOT NULL
      AND d.fr_or_cls IN ('FR', 'OR', 'HQ')
    GROUP BY s.prdt_scs_cd
  ) sa ON st.prdt_scs_cd = sa.prdt_scs_cd
  LEFT JOIN (
    SELECT 
      CASE
        WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
        WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
        WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
        WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
        ELSE db.PRDT_KIND_NM_ENG
      END AS mid_category_kr,
      SUM(COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0)) AS stock_amt_total_mid
    FROM fnf.chn.dw_stock_m a
    LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
    WHERE a.yymm = '{target_month}'
      AND a.brd_cd = '{brand}'
      AND db.ITEM IS NOT NULL
    GROUP BY mid_category_kr
  ) mt ON 1=1
),

-- OR 재고 (prdt_scs_cd 단위)
or_stock AS (
  SELECT
    a.shop_id,
    COALESCE(m.shop_nm_en, a.shop_id) AS shop_nm_en,
    m.anlys_onoff_cls_nm,
    a.prdt_scs_cd,
    a.prdt_cd,
    b.prdt_nm,
    a.sesn AS season,
    CASE
      WHEN a.sesn IS NOT NULL AND a.sesn LIKE '{current_year}%' THEN '당시즌'
      WHEN a.sesn IS NOT NULL AND a.sesn LIKE '{next_year}%' THEN '차기시즌'
      ELSE '과시즌'
    END AS season_bucket,
    CASE
      WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
      WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
      WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
      WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
      ELSE db.PRDT_KIND_NM_ENG
    END AS mid_category_kr,
    COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0) AS stock_amt,
    a.stock_qty_expected AS stock_qty
  FROM fnf.chn.dw_stock_m a
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON a.shop_id = d.oa_map_shop_id
  LEFT JOIN fnf.chn.mst_shop_all m ON a.shop_id = m.shop_id
  LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
  LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
  WHERE a.yymm = '{target_month}'
    AND a.brd_cd = '{brand}'
    AND db.ITEM IS NOT NULL
    AND COALESCE(d.fr_or_cls, 'HQ') IN ('OR', 'HQ')
),

-- OR 판매
or_sale AS (
  SELECT
    s.shop_id,
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS tag_amt,
    SUM(s.sale_amt) AS sale_amt
  FROM fnf.chn.dw_sale s
  LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
  LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '{target_month}'
    AND s.brd_cd = '{brand}'
    AND db.ITEM IS NOT NULL
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
  os.season_bucket,
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
    """


def fetch_shop_stagnant_stock_data(
    brand: str,
    target_month: str,
    threshold_pct: float = 0.01
) -> Dict[str, Any]:
    """직영매장 정체재고 분석 데이터 조회"""
    threshold = threshold_pct / 100
    days_in_month = get_days_in_month(target_month)
    
    # 1. 사용 가능한 월 목록 조회
    months_query = build_available_months_query(brand)
    months_result = execute_query(months_query)
    available_months = [row["SALE_YM"] for row in months_result]
    
    # 2. OR 직영매장 정체재고 분석 쿼리 실행
    shop_query = build_shop_stagnant_stock_query(brand, target_month, threshold)
    shop_result = execute_query(shop_query)
    
    # 3. 상품 단위 데이터 쿼리 실행
    product_query = build_shop_product_breakdown_query(brand, target_month, threshold)
    product_result = execute_query(product_query)
    
    # 4. 결과 매핑 - 집계 데이터
    shop_breakdown = []
    for row in shop_result:
        shop_breakdown.append({
            "shop_id": row.get("SHOP_ID", "") or "",
            "shop_nm_en": row.get("SHOP_NM_EN", row.get("SHOP_ID", "")) or "",
            "onOffType": row.get("ONOFFTYPE"),
            "dimensionKey": row.get("DIMENSION_KEY", "") or "",
            "prdt_nm_cn": row.get("PRDT_NM_CN", "") or "",
            "stock_amt": float(row.get("STOCK_AMT", 0) or 0),
            "stock_qty": int(row.get("STOCK_QTY", 0) or 0),
            "tag_amt": float(row.get("TAG_AMT", 0) or 0),
            "sale_amt": float(row.get("SALE_AMT", 0) or 0),
            "slow_cls": row.get("SLOW_CLS", "전체") or "전체",
            "season_bucket": row.get("SEASON_BUCKET", "") or "",
            "mid_category": row.get("MID_CATEGORY", "") or "",
            "mid_category_kr": row.get("MID_CATEGORY_KR", "기타악세") or "기타악세",
            "discount_rate": float(row["DISCOUNT_RATE"]) if row.get("DISCOUNT_RATE") is not None else None,
            "item_count": int(row.get("ITEM_COUNT", 0) or 0),
        })
    
    # 5. 결과 매핑 - 상품 단위 데이터
    shop_product_breakdown = []
    for row in product_result:
        shop_product_breakdown.append({
            "shop_id": row.get("SHOP_ID", "") or "",
            "shop_nm_en": row.get("SHOP_NM_EN", row.get("SHOP_ID", "")) or "",
            "onOffType": row.get("ONOFFTYPE"),
            "prdt_cd": row.get("PRDT_CD", "") or "",
            "prdt_nm": row.get("PRDT_NM", "") or "",
            "season": row.get("SEASON", "") or "",
            "season_bucket": row.get("SEASON_BUCKET", "") or "",
            "mid_category_kr": row.get("MID_CATEGORY_KR", "기타악세") or "기타악세",
            "stock_amt": float(row.get("STOCK_AMT", 0) or 0),
            "stock_qty": int(row.get("STOCK_QTY", 0) or 0),
            "tag_amt": float(row.get("TAG_AMT", 0) or 0),
            "sale_amt": float(row.get("SALE_AMT", 0) or 0),
            "is_slow": bool(row.get("IS_SLOW", 0) or 0),
        })
    
    # 6. 응답 생성
    response = {
        "shopBreakdown": shop_breakdown,
        "shopProductBreakdown": shop_product_breakdown,
        "availableMonths": available_months,
        "meta": {
            "targetMonth": target_month,
            "brand": brand,
            "thresholdPct": threshold_pct,
            "daysInMonth": days_in_month,
        },
    }
    
    return response


def main(reference_month: str = None):
    """
    메인 실행 함수
    
    Args:
        reference_month: 기준월 (예: "2025.11"). None이면 전체 처리
    """
    print("=" * 60)
    print("직영매장 정체재고 데이터 전처리 시작")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 기준월 모드 확인
    if reference_month:
        # "2025.11" -> "202511"
        target_month = reference_month.replace(".", "")
        print(f"\n[직영매장 정체재고] 기준월 모드: {reference_month} ({target_month})만 처리합니다.")
        months_to_process = [target_month]
    else:
        print("\n[직영매장 정체재고] 전체 처리 모드: 모든 브랜드와 월을 처리합니다.")
        months_to_process = None
    
    # 기존 JSON 파일 로드
    output_file = OUTPUT_PATH / "shop_stagnant_stock_summary.json"
    existing_data = {"brands": {}}
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[직영매장 정체재고] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
    
    # 각 브랜드별로 처리
    for brand_name in VALID_BRANDS:
        brand_code = BRAND_CODE_MAP[brand_name]
        print(f"\n[직영매장 정체재고] 브랜드: {brand_name} ({brand_code})")
        
        if brand_name not in existing_data["brands"]:
            existing_data["brands"][brand_name] = {}
        
        if months_to_process:
            # 기준월 모드: 지정된 월만 처리
            for target_month in months_to_process:
                try:
                    print(f"  처리 중: {target_month}...")
                    response = fetch_shop_stagnant_stock_data(
                        brand_code,
                        target_month,
                        threshold_pct=0.01
                    )
                    
                    existing_data["brands"][brand_name][target_month] = response
                    print(f"  완료: {target_month}")
                except Exception as e:
                    print(f"  [ERROR] {target_month} 처리 실패: {e}")
                    import traceback
                    traceback.print_exc()
        else:
            # 전체 처리 모드: 사용 가능한 모든 월 처리
            months_query = build_available_months_query(brand_code)
            months_result = execute_query(months_query)
            available_months = [row["SALE_YM"] for row in months_result]
            
            for target_month in available_months:
                # 이미 처리된 월은 건너뛰기
                if target_month in existing_data["brands"][brand_name]:
                    print(f"  건너뛰기: {target_month} (이미 처리됨)")
                    continue
                
                try:
                    print(f"  처리 중: {target_month}...")
                    response = fetch_shop_stagnant_stock_data(
                        brand_code,
                        target_month,
                        threshold_pct=0.01
                    )
                    
                    existing_data["brands"][brand_name][target_month] = response
                    print(f"  완료: {target_month}")
                except Exception as e:
                    print(f"  [ERROR] {target_month} 처리 실패: {e}")
                    import traceback
                    traceback.print_exc()
    
    # JSON 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 60)
    print("전처리 완료")
    print("=" * 60)
    print(f"[DONE] 저장 완료: {output_file}")


if __name__ == "__main__":
    import sys
    
    # 기준월 모드: python preprocess_shop_stagnant_stock.py --reference-month 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_shop_stagnant_stock.py --reference-month 2025.11")
    else:
        main()
