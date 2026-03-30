"""
대리상 주력/아울렛 데이터 전처리 스크립트
- Snowflake에서 대리상 주력/아울렛 데이터 조회
- 브랜드별, 기준월별로 데이터 저장
- public/data/dealer_core_outlet_summary.json 생성
"""

import json
import calendar
import csv
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


def calc_stock_weeks(stock_amt: float, sales_amt: float, days_in_month: int) -> Optional[float]:
    """재고주수 계산"""
    if sales_amt <= 0:
        return None
    week_sales = (sales_amt / days_in_month) * 7
    if week_sales <= 0:
        return None
    return stock_amt / week_sales


def load_dealer_korean_names() -> Dict[str, str]:
    """대리상 한글 이름 로드"""
    dealer_map = {}
    try:
        csv_path = Path(__file__).parent.parent / "fr_master.csv"
        if csv_path.exists():
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                next(reader)  # 헤더 스킵
                for row in reader:
                    if len(row) >= 3:
                        account_id = row[0].strip()
                        account_nm_kr = row[2].strip()
                        dealer_map[account_id] = account_nm_kr
            print(f"  대리상 한글 이름 로드: {len(dealer_map)}개")
    except Exception as e:
        print(f"  [WARNING] fr_master.csv 로드 실패: {e}")
    return dealer_map


def get_product_type_case(op_std_column: str, sesn_column: str, year_column: str) -> str:
    """주력/아울렛 분류 CASE 문 생성"""
    return f"""
    CASE
      WHEN {op_std_column} IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN {op_std_column} IN ('OUTLET', 'DONE', 'CARE') THEN 'outlet'
      WHEN {op_std_column} RLIKE '^[0-9]{{2}}(SS|FW)$' THEN
        CASE
          WHEN CAST(SUBSTRING({op_std_column}, 1, 2) AS INT) >= CAST({year_column} AS INT) THEN 'core'
          ELSE 'outlet'
        END
      ELSE 'outlet'
    END
    """


def get_category_filter(category: str) -> str:
    """카테고리 필터 조건 생성"""
    if category == 'all':
        return "AND db.PRDT_KIND_NM_ENG IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')"
    
    category_map = {
        'shoes': 'Shoes',
        'headwear': 'Headwear',
        'bag': 'Bag',
        'acc_etc': 'Acc_etc',
    }
    
    return f"AND db.PRDT_KIND_NM_ENG = '{category_map[category]}'"


def fetch_dealer_data_for_brand(
    brand_code: str,
    brand_name: str,
    base_month: str,
    prior_month: str,
    days_in_month: int,
    dealer_korean_names: Dict[str, str]
) -> Dict[str, Any]:
    """브랜드별 대리상 주력/아울렛 데이터 조회"""
    query = f"""
WITH 
acc_item_map AS (
  SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
  FROM FNF.PRCS.DB_PRDT
  WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
),

-- 대리상 마스터
dealer_master AS (
  SELECT 
    account_id,
    account_nm_en
  FROM CHN.MST_ACCOUNT
  WHERE account_id IS NOT NULL
),

-- 매장 → 대리상 매핑 (FR만)
shop_dealer_map AS (
  SELECT 
    TO_VARCHAR(shop_id) AS shop_id,
    account_id
  FROM FNF.CHN.MST_SHOP_ALL
  WHERE fr_or_cls = 'FR'
    AND account_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER(PARTITION BY shop_id ORDER BY open_dt DESC NULLS LAST) = 1
),

-- 재고 데이터 (당월 + 전년동월)
stock_raw AS (
  SELECT 
    s.yymm,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.prdt_scs_cd,
    COALESCE(s.stock_tag_amt_insp, 0) + COALESCE(s.stock_tag_amt_frozen, 0) + COALESCE(s.stock_tag_amt_expected, 0) AS stock_amt,
    p.remark1, p.remark2, p.remark3, p.remark4, p.remark5,
    p.remark6, p.remark7, p.remark8,
    prep.operate_standard AS prep_operate_standard,
    p.sesn,
    m.prdt_nm
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN fnf.sap_fnf.mst_prdt m ON p.prdt_cd = m.prdt_cd
  LEFT JOIN CHN.PREP_MST_PRDT_SCS prep
    ON s.prdt_scs_cd = prep.prdt_scs_cd
    AND prep.yyyymm = CASE
      WHEN s.yymm BETWEEN '202512' AND '202602' THEN '202602'
      WHEN s.yymm >= '202603' THEN s.yymm
      ELSE NULL
    END
  WHERE s.yymm IN ('{base_month}', '{prior_month}')
    AND s.brd_cd = '{brand_code}'
    {get_category_filter('all')}
),

-- 재고 + 대리상 매핑 + remark 자동 계산
stock_with_segment AS (
  SELECT 
    sr.yymm,
    sdm.account_id,
    sr.prdt_scs_cd,
    sr.prdt_nm,
    sr.stock_amt,
    CASE 
      WHEN sr.yymm >= '202512' THEN sr.prep_operate_standard
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 1 THEN sr.remark1
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 2 THEN sr.remark2
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 3 THEN sr.remark3
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 4 THEN sr.remark4
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 5 THEN sr.remark5
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 6 THEN sr.remark6
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 7 THEN sr.remark7
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 8 THEN sr.remark8
      ELSE NULL
    END AS op_std,
    sr.sesn,
    SUBSTRING(sr.yymm, 3, 2) AS yy
  FROM stock_raw sr
  INNER JOIN shop_dealer_map sdm ON sr.shop_id = sdm.shop_id
),

-- 재고 주력/아울렛 분류
stock_classified AS (
  SELECT 
    yymm,
    account_id,
    prdt_scs_cd,
    prdt_nm,
    stock_amt,
    {get_product_type_case('op_std', 'sesn', 'yy')} AS segment
  FROM stock_with_segment
),

-- 판매 데이터 (당월 + 전년동월)
sales_raw AS (
  SELECT 
    TO_CHAR(s.sale_dt, 'YYYYMM') AS yymm,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.prdt_scs_cd,
    s.tag_amt,
    p.remark1, p.remark2, p.remark3, p.remark4, p.remark5,
    p.remark6, p.remark7, p.remark8,
    prep.operate_standard AS prep_operate_standard,
    p.sesn
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN CHN.PREP_MST_PRDT_SCS prep
    ON s.prdt_scs_cd = prep.prdt_scs_cd
    AND prep.yyyymm = CASE
      WHEN TO_CHAR(s.sale_dt, 'YYYYMM') BETWEEN '202512' AND '202602' THEN '202602'
      WHEN TO_CHAR(s.sale_dt, 'YYYYMM') >= '202603' THEN TO_CHAR(s.sale_dt, 'YYYYMM')
      ELSE NULL
    END
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') IN ('{base_month}', '{prior_month}')
    AND s.brd_cd = '{brand_code}'
    {get_category_filter('all')}
),

-- 판매 + 대리상 매핑 + remark 자동 계산
sales_with_segment AS (
  SELECT 
    sr.yymm,
    sdm.account_id,
    sr.prdt_scs_cd,
    sr.tag_amt,
    CASE 
      WHEN sr.yymm >= '202512' THEN sr.prep_operate_standard
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 1 THEN sr.remark1
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 2 THEN sr.remark2
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 3 THEN sr.remark3
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 4 THEN sr.remark4
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 5 THEN sr.remark5
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 6 THEN sr.remark6
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 7 THEN sr.remark7
      WHEN (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1) = 8 THEN sr.remark8
      ELSE NULL
    END AS op_std,
    sr.sesn,
    SUBSTRING(sr.yymm, 3, 2) AS yy
  FROM sales_raw sr
  INNER JOIN shop_dealer_map sdm ON sr.shop_id = sdm.shop_id
),

-- 판매 주력/아울렛 분류
sales_classified AS (
  SELECT 
    yymm,
    account_id,
    prdt_scs_cd,
    tag_amt,
    {get_product_type_case('op_std', 'sesn', 'yy')} AS segment
  FROM sales_with_segment
),

-- 재고 대리상별 집계
stock_by_dealer AS (
  SELECT 
    account_id,
    SUM(CASE WHEN yymm = '{base_month}' THEN stock_amt ELSE 0 END) AS current_stock_total,
    SUM(CASE WHEN yymm = '{base_month}' AND segment = 'core' THEN stock_amt ELSE 0 END) AS current_stock_core,
    SUM(CASE WHEN yymm = '{base_month}' AND segment = 'outlet' THEN stock_amt ELSE 0 END) AS current_stock_outlet,
    SUM(CASE WHEN yymm = '{prior_month}' THEN stock_amt ELSE 0 END) AS prior_stock_total,
    SUM(CASE WHEN yymm = '{prior_month}' AND segment = 'core' THEN stock_amt ELSE 0 END) AS prior_stock_core,
    SUM(CASE WHEN yymm = '{prior_month}' AND segment = 'outlet' THEN stock_amt ELSE 0 END) AS prior_stock_outlet
  FROM stock_classified
  GROUP BY account_id
),

-- 판매 대리상별 집계
sales_by_dealer AS (
  SELECT 
    account_id,
    SUM(CASE WHEN yymm = '{base_month}' THEN tag_amt ELSE 0 END) AS current_sales_total,
    SUM(CASE WHEN yymm = '{base_month}' AND segment = 'core' THEN tag_amt ELSE 0 END) AS current_sales_core,
    SUM(CASE WHEN yymm = '{base_month}' AND segment = 'outlet' THEN tag_amt ELSE 0 END) AS current_sales_outlet,
    SUM(CASE WHEN yymm = '{prior_month}' THEN tag_amt ELSE 0 END) AS prior_sales_total,
    SUM(CASE WHEN yymm = '{prior_month}' AND segment = 'core' THEN tag_amt ELSE 0 END) AS prior_sales_core,
    SUM(CASE WHEN yymm = '{prior_month}' AND segment = 'outlet' THEN tag_amt ELSE 0 END) AS prior_sales_outlet
  FROM sales_classified
  GROUP BY account_id
),

-- 대리상별 집계
dealer_agg AS (
  SELECT 
    dm.account_id,
    dm.account_nm_en,
    COALESCE(st.current_stock_total, 0) AS current_stock_total,
    COALESCE(sal.current_sales_total, 0) AS current_sales_total,
    COALESCE(st.current_stock_core, 0) AS current_stock_core,
    COALESCE(sal.current_sales_core, 0) AS current_sales_core,
    COALESCE(st.current_stock_outlet, 0) AS current_stock_outlet,
    COALESCE(sal.current_sales_outlet, 0) AS current_sales_outlet,
    COALESCE(st.prior_stock_total, 0) AS prior_stock_total,
    COALESCE(sal.prior_sales_total, 0) AS prior_sales_total,
    COALESCE(st.prior_stock_core, 0) AS prior_stock_core,
    COALESCE(sal.prior_sales_core, 0) AS prior_sales_core,
    COALESCE(st.prior_stock_outlet, 0) AS prior_stock_outlet,
    COALESCE(sal.prior_sales_outlet, 0) AS prior_sales_outlet
  FROM dealer_master dm
  LEFT JOIN stock_by_dealer st ON dm.account_id = st.account_id
  LEFT JOIN sales_by_dealer sal ON dm.account_id = sal.account_id
  WHERE st.account_id IS NOT NULL OR sal.account_id IS NOT NULL
),

-- 재고 상품별 집계
stock_by_product AS (
  SELECT 
    account_id,
    prdt_scs_cd,
    MAX(prdt_nm) AS prdt_nm,
    segment,
    SUM(CASE WHEN yymm = '{base_month}' THEN stock_amt ELSE 0 END) AS current_stock_amt,
    SUM(CASE WHEN yymm = '{prior_month}' THEN stock_amt ELSE 0 END) AS prior_stock_amt
  FROM stock_classified
  GROUP BY account_id, prdt_scs_cd, segment
),

-- 판매 상품별 집계
sales_by_product AS (
  SELECT 
    account_id,
    prdt_scs_cd,
    segment,
    SUM(CASE WHEN yymm = '{base_month}' THEN tag_amt ELSE 0 END) AS current_sales_amt,
    SUM(CASE WHEN yymm = '{prior_month}' THEN tag_amt ELSE 0 END) AS prior_sales_amt
  FROM sales_classified
  GROUP BY account_id, prdt_scs_cd, segment
),

-- 상품별 상세
product_agg AS (
  SELECT 
    dm.account_id,
    dm.account_nm_en,
    st.prdt_scs_cd,
    st.prdt_nm,
    st.segment,
    COALESCE(st.current_stock_amt, 0) AS current_stock_amt,
    COALESCE(sal.current_sales_amt, 0) AS current_sales_amt,
    COALESCE(st.prior_stock_amt, 0) AS prior_stock_amt,
    COALESCE(sal.prior_sales_amt, 0) AS prior_sales_amt
  FROM dealer_master dm
  INNER JOIN stock_by_product st ON dm.account_id = st.account_id
  LEFT JOIN sales_by_product sal ON st.account_id = sal.account_id AND st.prdt_scs_cd = sal.prdt_scs_cd AND st.segment = sal.segment
  WHERE st.current_stock_amt > 0 OR st.prior_stock_amt > 0
)

SELECT 
  'dealer' AS record_type,
  account_id,
  account_nm_en,
  current_stock_total,
  current_sales_total,
  current_stock_core,
  current_sales_core,
  current_stock_outlet,
  current_sales_outlet,
  prior_stock_total,
  prior_sales_total,
  prior_stock_core,
  prior_sales_core,
  prior_stock_outlet,
  prior_sales_outlet,
  NULL AS prdt_scs_cd,
  NULL AS prdt_nm,
  NULL AS segment,
  NULL AS current_stock_amt,
  NULL AS current_sales_amt,
  NULL AS prior_stock_amt,
  NULL AS prior_sales_amt
FROM dealer_agg

UNION ALL

SELECT 
  'product' AS record_type,
  account_id,
  account_nm_en,
  NULL AS current_stock_total,
  NULL AS current_sales_total,
  NULL AS current_stock_core,
  NULL AS current_sales_core,
  NULL AS current_stock_outlet,
  NULL AS current_sales_outlet,
  NULL AS prior_stock_total,
  NULL AS prior_sales_total,
  NULL AS prior_stock_core,
  NULL AS prior_sales_core,
  NULL AS prior_stock_outlet,
  NULL AS prior_sales_outlet,
  prdt_scs_cd,
  prdt_nm,
  segment,
  current_stock_amt,
  current_sales_amt,
  prior_stock_amt,
  prior_sales_amt
FROM product_agg

ORDER BY record_type, account_id, prdt_scs_cd
    """
    
    rows = execute_query(query)
    
    # 데이터 가공
    dealers = []
    products = []
    
    for row in rows:
        record_type = row.get("RECORD_TYPE", "")
        
        if record_type == 'dealer':
            dealers.append({
                "account_id": row.get("ACCOUNT_ID", "") or "",
                "account_nm_en": row.get("ACCOUNT_NM_EN", "") or "",
                "account_nm_kr": dealer_korean_names.get(row.get("ACCOUNT_ID", ""), ""),
                "current": {
                    "total": {
                        "stock_amt": float(row.get("CURRENT_STOCK_TOTAL", 0) or 0),
                        "sales_amt": float(row.get("CURRENT_SALES_TOTAL", 0) or 0),
                        "stock_weeks": calc_stock_weeks(
                            float(row.get("CURRENT_STOCK_TOTAL", 0) or 0),
                            float(row.get("CURRENT_SALES_TOTAL", 0) or 0),
                            days_in_month
                        ),
                    },
                    "core": {
                        "stock_amt": float(row.get("CURRENT_STOCK_CORE", 0) or 0),
                        "sales_amt": float(row.get("CURRENT_SALES_CORE", 0) or 0),
                        "stock_weeks": calc_stock_weeks(
                            float(row.get("CURRENT_STOCK_CORE", 0) or 0),
                            float(row.get("CURRENT_SALES_CORE", 0) or 0),
                            days_in_month
                        ),
                    },
                    "outlet": {
                        "stock_amt": float(row.get("CURRENT_STOCK_OUTLET", 0) or 0),
                        "sales_amt": float(row.get("CURRENT_SALES_OUTLET", 0) or 0),
                        "stock_weeks": calc_stock_weeks(
                            float(row.get("CURRENT_STOCK_OUTLET", 0) or 0),
                            float(row.get("CURRENT_SALES_OUTLET", 0) or 0),
                            days_in_month
                        ),
                    },
                },
                "prior": {
                    "total": {
                        "stock_amt": float(row.get("PRIOR_STOCK_TOTAL", 0) or 0),
                        "sales_amt": float(row.get("PRIOR_SALES_TOTAL", 0) or 0),
                        "stock_weeks": calc_stock_weeks(
                            float(row.get("PRIOR_STOCK_TOTAL", 0) or 0),
                            float(row.get("PRIOR_SALES_TOTAL", 0) or 0),
                            days_in_month
                        ),
                    },
                    "core": {
                        "stock_amt": float(row.get("PRIOR_STOCK_CORE", 0) or 0),
                        "sales_amt": float(row.get("PRIOR_SALES_CORE", 0) or 0),
                        "stock_weeks": calc_stock_weeks(
                            float(row.get("PRIOR_STOCK_CORE", 0) or 0),
                            float(row.get("PRIOR_SALES_CORE", 0) or 0),
                            days_in_month
                        ),
                    },
                    "outlet": {
                        "stock_amt": float(row.get("PRIOR_STOCK_OUTLET", 0) or 0),
                        "sales_amt": float(row.get("PRIOR_SALES_OUTLET", 0) or 0),
                        "stock_weeks": calc_stock_weeks(
                            float(row.get("PRIOR_STOCK_OUTLET", 0) or 0),
                            float(row.get("PRIOR_SALES_OUTLET", 0) or 0),
                            days_in_month
                        ),
                    },
                },
            })
        elif record_type == 'product':
            products.append({
                "account_id": row.get("ACCOUNT_ID", "") or "",
                "account_nm_en": row.get("ACCOUNT_NM_EN", "") or "",
                "account_nm_kr": dealer_korean_names.get(row.get("ACCOUNT_ID", ""), ""),
                "prdt_scs_cd": row.get("PRDT_SCS_CD", "") or "",
                "prdt_nm": row.get("PRDT_NM", "") or "",
                "segment": row.get("SEGMENT", "outlet"),
                "current": {
                    "stock_amt": float(row.get("CURRENT_STOCK_AMT", 0) or 0),
                    "sales_amt": float(row.get("CURRENT_SALES_AMT", 0) or 0),
                    "stock_weeks": calc_stock_weeks(
                        float(row.get("CURRENT_STOCK_AMT", 0) or 0),
                        float(row.get("CURRENT_SALES_AMT", 0) or 0),
                        days_in_month
                    ),
                },
                "prior": {
                    "stock_amt": float(row.get("PRIOR_STOCK_AMT", 0) or 0),
                    "sales_amt": float(row.get("PRIOR_SALES_AMT", 0) or 0),
                    "stock_weeks": calc_stock_weeks(
                        float(row.get("PRIOR_STOCK_AMT", 0) or 0),
                        float(row.get("PRIOR_SALES_AMT", 0) or 0),
                        days_in_month
                    ),
                },
            })
    
    return {
        "dealers": dealers,
        "products": products,
        "meta": {
            "baseMonth": base_month,
            "priorMonth": prior_month,
            "daysInMonth": days_in_month,
        },
    }


def main(reference_month: str = None):
    """
    메인 실행 함수
    
    Args:
        reference_month: 기준월 (예: "2025.11"). None이면 전체 처리
    """
    print("=" * 60)
    print("대리상 주력/아울렛 데이터 전처리 시작")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 기준월 모드 확인
    if reference_month:
        # 기준월을 "YYYYMM" 형식으로 변환
        base_month = reference_month.replace(".", "")
        if len(base_month) != 6:
            print(f"[ERROR] 잘못된 기준월 형식: {reference_month}")
            return
        
        # 전년동월 계산
        base_year = int(base_month[:4])
        base_month_num = base_month[4:6]
        prior_month = f"{base_year - 1}{base_month_num}"
        
        # 당월 일수 계산
        year = int(base_month[:4])
        month = int(base_month[4:6])
        days_in_month = calendar.monthrange(year, month)[1]
        
        print(f"\n[대리상 주력/아울렛] 기준월 모드: {reference_month} ({base_month})만 처리합니다.")
        months_to_process = [base_month]
    else:
        print("\n[대리상 주력/아울렛] 전체 처리 모드: 모든 브랜드와 월을 처리합니다.")
        months_to_process = None
    
    # 대리상 한글 이름 로드
    dealer_korean_names = load_dealer_korean_names()
    
    # 기존 JSON 파일 로드
    output_file = OUTPUT_PATH / "dealer_core_outlet_summary.json"
    existing_data = {"brands": {}}
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[대리상 주력/아울렛] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
    
    # 각 브랜드별로 처리
    for brand_name in VALID_BRANDS:
        brand_code = BRAND_CODE_MAP[brand_name]
        print(f"\n[대리상 주력/아울렛] 브랜드: {brand_name} ({brand_code})")
        
        if brand_name not in existing_data["brands"]:
            existing_data["brands"][brand_name] = {}
        
        if months_to_process:
            # 기준월 모드: 지정된 월만 처리
            for base_month in months_to_process:
                try:
                    # 전년동월 계산
                    base_year = int(base_month[:4])
                    base_month_num = base_month[4:6]
                    prior_month = f"{base_year - 1}{base_month_num}"
                    
                    # 당월 일수 계산
                    year = int(base_month[:4])
                    month = int(base_month[4:6])
                    days_in_month = calendar.monthrange(year, month)[1]
                    
                    print(f"  처리 중: {base_month}...")
                    response = fetch_dealer_data_for_brand(
                        brand_code,
                        brand_name,
                        base_month,
                        prior_month,
                        days_in_month,
                        dealer_korean_names
                    )
                    
                    existing_data["brands"][brand_name][base_month] = response
                    print(f"  완료: {base_month}")
                except Exception as e:
                    print(f"  [ERROR] {base_month} 처리 실패: {e}")
                    import traceback
                    traceback.print_exc()
        else:
            # 전체 처리 모드: 사용 가능한 모든 월 처리
            # 여기서는 간단히 처리하지 않고, 사용자가 기준월을 지정하도록 함
            print("  [INFO] 전체 처리 모드는 기준월을 지정하여 실행하세요.")
            print("  예: python preprocess_dealer_core_outlet.py --reference-month 2025.11")
    
    # JSON 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 60)
    print("전처리 완료")
    print("=" * 60)
    print(f"[DONE] 저장 완료: {output_file}")


if __name__ == "__main__":
    import sys
    
    # 기준월 모드: python preprocess_dealer_core_outlet.py --reference-month 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_dealer_core_outlet.py --reference-month 2025.11")
    else:
        main()
