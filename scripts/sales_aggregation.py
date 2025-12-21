"""
판매매출 Snowflake 집계 로직

기존 CSV 기반 로직을 Snowflake SQL로 완전 대체
- 채널: FR(대리상), OR(직영), HQ 제외 (판매는 매장에서만 발생)
- 주력/아울렛: 각 행의 월별로 해당 분기 remark 적용
- 브랜드: M=MLB, I=MLB KIDS, X=DISCOVERY
"""

from typing import Dict, Tuple, Any, Set
from collections import defaultdict
from snowflake_utils import execute_query_batch


# 브랜드 코드 매핑
BRAND_CODE_MAP = {
    'M': 'MLB',
    'I': 'MLB KIDS',
    'X': 'DISCOVERY'
}

# 역매핑
BRAND_NAME_TO_CODE = {v: k for k, v in BRAND_CODE_MAP.items()}

# 아이템 카테고리 (영문 → 한글 표시명)
ITEM_CATEGORY_MAP = {
    'Shoes': 'Shoes',
    'Headwear': 'Headwear',
    'Bag': 'Bag',
    'Acc_etc': 'Acc_etc'
}


def build_sales_aggregation_query(start_month: str = '202401', end_month: str = '202511') -> str:
    """
    판매 집계 SQL 쿼리 생성
    
    Args:
        start_month: 시작월 (YYYYMM)
        end_month: 종료월 (YYYYMM)
    
    Returns:
        str: 실행할 SQL 쿼리
    
    Note:
        VIEW 권한이 없어도 동작하도록 CTE로 remark 정규화 포함
    """
    query = f"""
WITH 
-- Step 0: 운영기준(remark) 정규화 (VIEW 대신 CTE 사용)
remark_normalized AS (
  SELECT prdt_scs_cd, '2024-01-01'::DATE AS q_start_dt, 1 AS remark_idx, remark1 AS op_std
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark1 IS NOT NULL AND TRIM(remark1) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2024-04-01'::DATE, 2, remark2
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark2 IS NOT NULL AND TRIM(remark2) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2024-07-01'::DATE, 3, remark3
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark3 IS NOT NULL AND TRIM(remark3) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2024-10-01'::DATE, 4, remark4
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark4 IS NOT NULL AND TRIM(remark4) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2025-01-01'::DATE, 5, remark5
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark5 IS NOT NULL AND TRIM(remark5) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2025-04-01'::DATE, 6, remark6
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark6 IS NOT NULL AND TRIM(remark6) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2025-07-01'::DATE, 7, remark7
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark7 IS NOT NULL AND TRIM(remark7) != ''
  
  UNION ALL
  SELECT prdt_scs_cd, '2025-10-01'::DATE, 8, remark8
  FROM FNF.CHN.MST_PRDT_SCS WHERE remark8 IS NOT NULL AND TRIM(remark8) != ''
),

-- Step 1: 판매 데이터에 상품/매장 마스터 조인 및 분기 계산
sales_with_master AS (
  SELECT 
    s.sale_dt,
    TO_CHAR(s.sale_dt, 'YYYYMM') AS sale_ym,
    s.shop_id,
    s.prdt_scs_cd,
    s.brd_cd,
    s.sesn,
    s.tag_amt,
    p.parent_prdt_kind_cd,
    p.prdt_kind_nm_en,
    d.fr_or_cls,
    -- 해당 판매일의 분기 시작일
    DATE_TRUNC('QUARTER', s.sale_dt) AS q_start_dt,
    -- 해당 판매일의 연도 YY (2024 → 24)
    SUBSTR(TO_CHAR(s.sale_dt, 'YYYY'), 3, 2) AS row_yy
  FROM CHN.DW_SALE s
  LEFT JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  LEFT JOIN (
    SELECT shop_id, fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(PARTITION BY shop_id ORDER BY COALESCE(open_dt, '1900-01-01') DESC) = 1
  ) d ON s.shop_id = d.shop_id
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') >= '{start_month}'
    AND TO_CHAR(s.sale_dt, 'YYYYMM') <= '{end_month}'
    AND s.brd_cd IN ('M', 'I', 'X')
    AND p.parent_prdt_kind_cd = 'A'  -- 악세사리만
    AND p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')
    AND d.fr_or_cls IN ('FR', 'OR')  -- HQ 제외
),

-- Step 2: 운영기준(remark) 조인
sales_with_remark AS (
  SELECT 
    s.*,
    r.op_std,
    r.remark_idx
  FROM sales_with_master s
  LEFT JOIN remark_normalized r
    ON s.prdt_scs_cd = r.prdt_scs_cd
    AND s.q_start_dt = r.q_start_dt
),

-- Step 3: 주력/아울렛 판정
sales_classified AS (
  SELECT 
    sale_ym,
    brd_cd,
    prdt_kind_nm_en,
    fr_or_cls,
    tag_amt,
    -- 주력/아울렛 판정 로직
    CASE
      -- 1. op_std가 있으면 우선 판단
      WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN op_std IN ('OUTLET', 'CARE', 'DONE') THEN 'outlet'
      
      -- 2. op_std가 숫자+시즌 형태면 연도 비교
      WHEN op_std IS NOT NULL AND op_std NOT IN ('FOCUS', 'INTRO', 'OUTLET', 'CARE', 'DONE') THEN
        CASE 
          WHEN TRY_TO_NUMBER(REGEXP_SUBSTR(op_std, '\\\\d{{2}}')) >= TRY_TO_NUMBER(row_yy) THEN 'core'
          ELSE 'outlet'
        END
      
      -- 3. op_std가 NULL이면 sesn으로 판단
      WHEN TRY_TO_NUMBER(LEFT(sesn, 2)) >= TRY_TO_NUMBER(row_yy) THEN 'core'
      
      -- 4. 그 외 모두 아울렛
      ELSE 'outlet'
    END AS product_type
  FROM sales_with_remark
)

-- Step 4: 최종 집계
SELECT 
  sale_ym AS month,
  brd_cd AS brand,
  prdt_kind_nm_en AS item_category,
  fr_or_cls AS channel,
  product_type,
  SUM(tag_amt) AS total_amount
FROM sales_classified
GROUP BY sale_ym, brd_cd, prdt_kind_nm_en, fr_or_cls, product_type
ORDER BY sale_ym, brd_cd, item_category, channel, product_type
"""
    return query


def aggregate_sales_from_snowflake(
    start_month: str = '202401',
    end_month: str = '202511'
) -> Tuple[Dict[Tuple, float], Set[str]]:
    """
    Snowflake에서 판매 데이터 집계
    
    Args:
        start_month: 시작월 (YYYYMM)
        end_month: 종료월 (YYYYMM)
    
    Returns:
        Tuple[Dict, Set]: 
            - Dict: (brand, item_tab, month, channel, product_type) → amount
            - Set: 예상치 못한 카테고리 (빈 set 반환)
    """
    print(f"[판매] Snowflake에서 데이터 조회 중... ({start_month} ~ {end_month})")
    
    query = build_sales_aggregation_query(start_month, end_month)
    results = execute_query_batch(query)
    
    print(f"[판매] 조회 완료: {len(results):,}행")
    
    # 집계 결과를 기존 형식으로 변환
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    
    for row in results:
        month_yyyymm = row['MONTH']  # YYYYMM
        month_display = f"{month_yyyymm[:4]}.{month_yyyymm[4:6]}"  # YYYY.MM
        
        brand_code = row['BRAND']
        brand_name = BRAND_CODE_MAP.get(brand_code, brand_code)
        
        item_category = row['ITEM_CATEGORY']
        channel_raw = row['CHANNEL']
        # 채널 매핑: Snowflake 'FR' → Python 'FRS'
        channel = 'FRS' if channel_raw == 'FR' else channel_raw
        product_type = row['PRODUCT_TYPE']
        amount = float(row['TOTAL_AMOUNT']) if row['TOTAL_AMOUNT'] else 0.0
        
        # 아이템탭: "전체" + 개별 카테고리
        item_tabs = ['전체', item_category]
        
        for item_tab in item_tabs:
            # 전체판매 (FRS + OR)
            key_total = (brand_name, item_tab, month_display, '전체', product_type)
            agg_dict[key_total] += amount
            
            # 채널별 판매
            key_channel = (brand_name, item_tab, month_display, channel, product_type)
            agg_dict[key_channel] += amount
    
    print(f"[판매] 집계 완료: {len(agg_dict):,}개 키")
    
    # 예상치 못한 카테고리는 빈 set (Snowflake에서 이미 필터링됨)
    unexpected_categories = set()
    
    return dict(agg_dict), unexpected_categories


if __name__ == "__main__":
    # 테스트 실행
    print("=" * 60)
    print("판매 집계 테스트")
    print("=" * 60)
    
    try:
        agg_dict, unexpected = aggregate_sales_from_snowflake('202511', '202511')
        
        print(f"\n집계 결과 샘플 (2025.11 MLB):")
        for key, value in list(agg_dict.items())[:10]:
            brand, item_tab, month, channel, ptype = key
            if brand == 'MLB' and month == '2025.11':
                print(f"  {brand} / {item_tab} / {channel} / {ptype}: {value:,.0f}")
    
    except Exception as e:
        print(f"[ERROR] 테스트 실패: {e}")
        import traceback
        traceback.print_exc()

