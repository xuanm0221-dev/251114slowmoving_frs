"""
재고자산 Snowflake 집계 로직

기존 CSV 기반 로직을 Snowflake SQL로 완전 대체
- 채널: FR(대리상), OR+HQ(본사재고), 전체=FR+OR+HQ
- 주력/아울렛: 각 행의 월(yymm)별로 해당 분기 remark 적용
- 금액 + 수량 모두 집계
"""

from typing import Dict, Tuple, Any, Set
from collections import defaultdict
from snowflake_utils import execute_query_batch


# 브랜드 코드 매핑 (sales_aggregation과 동일)
BRAND_CODE_MAP = {
    'M': 'MLB',
    'I': 'MLB KIDS',
    'X': 'DISCOVERY'
}


def build_inventory_aggregation_query(start_month: str = '202401', end_month: str = '202511') -> str:
    """
    재고 집계 SQL 쿼리 생성
    
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
-- ACC 아이템 맵: DB_PRDT에서 DISTINCT ITEM, PRDT_KIND_NM_ENG 추출
acc_item_map AS (
  SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
  FROM FNF.PRCS.DB_PRDT
  WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
),

-- Step 1: 재고 데이터에 상품/매장 마스터 조인 및 remark 자동 계산
-- 기준: 24.01~25.11은 분기별 remark1~8, 25.12~은 PREP_MST_PRDT_SCS.operate_standard
stock_with_master AS (
  SELECT 
    st.yymm,
    st.shop_id,
    st.prdt_scs_cd,
    st.brd_cd,
    st.sesn,
    st.stock_qty_expected,
    COALESCE(st.stock_tag_amt_insp, 0) + COALESCE(st.stock_tag_amt_frozen, 0) + COALESCE(st.stock_tag_amt_expected, 0) AS stock_tag_amt_total,
    db.PRDT_KIND_NM_ENG AS prdt_kind_nm_en,
    d.fr_or_cls,
    -- remark 번호 자동 계산 (23.12 기준, 3개월 단위) → remark1~8: 24.01~25.11
    FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(st.yymm || '01', 'YYYYMMDD')) / 3) + 1 AS remark_num,
    -- 연도 YY 추출 (202401 → 24)
    SUBSTR(st.yymm, 3, 2) AS row_yy,
    p.remark1, p.remark2, p.remark3, p.remark4, p.remark5,
    p.remark6, p.remark7, p.remark8,
    -- 25.12~26.02: PREP yyyymm='202602' 고정, 26.03~: PREP yyyymm=재고월
    prep.operate_standard AS prep_operate_standard
  FROM CHN.DW_STOCK_M st
  LEFT JOIN FNF.CHN.MST_PRDT_SCS p ON st.prdt_scs_cd = p.prdt_scs_cd
  LEFT JOIN acc_item_map db ON SUBSTR(st.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN (
    SELECT shop_id, fr_or_cls
    FROM CHN.DW_SHOP_WH_DETAIL
    WHERE fr_or_cls IS NOT NULL
    QUALIFY ROW_NUMBER() OVER(PARTITION BY shop_id ORDER BY COALESCE(open_dt, '1900-01-01') DESC) = 1
  ) d ON st.shop_id = d.shop_id
  LEFT JOIN CHN.PREP_MST_PRDT_SCS prep
    ON st.prdt_scs_cd = prep.prdt_scs_cd
    AND prep.yyyymm = CASE
      WHEN st.yymm BETWEEN '202512' AND '202602' THEN '202602'
      WHEN st.yymm >= '202603' THEN st.yymm
      ELSE NULL
    END
  WHERE st.yymm >= '{start_month}'
    AND st.yymm <= '{end_month}'
    AND st.brd_cd IN ('M', 'I', 'X')
    AND db.ITEM IS NOT NULL -- ACC 필터
    AND d.fr_or_cls IN ('FR', 'OR', 'HQ')  -- HQ 포함
),

-- Step 2: 동적 remark 선택
-- 24.01~25.11: remark1~8 (분기별 고정), 25.12~: PREP_MST_PRDT_SCS.operate_standard
stock_with_remark AS (
  SELECT 
    s.*,
    CASE 
      -- 25.12~26.02: PREP 202602 고정 스냅샷, 26.03~: PREP 월별 스냅샷
      WHEN s.yymm >= '202512' THEN s.prep_operate_standard
      -- 24.01~25.11: 분기별 remark (remark1~8)
      WHEN s.remark_num = 1 THEN s.remark1
      WHEN s.remark_num = 2 THEN s.remark2
      WHEN s.remark_num = 3 THEN s.remark3
      WHEN s.remark_num = 4 THEN s.remark4
      WHEN s.remark_num = 5 THEN s.remark5
      WHEN s.remark_num = 6 THEN s.remark6
      WHEN s.remark_num = 7 THEN s.remark7
      WHEN s.remark_num = 8 THEN s.remark8
      ELSE NULL
    END AS op_std
  FROM stock_with_master s
  WHERE (s.yymm >= '202512' OR (s.remark_num >= 1 AND s.remark_num <= 8))
),

-- Step 3: 주력/아울렛 판정 (판매와 동일 로직)
stock_classified AS (
  SELECT 
    yymm,
    brd_cd,
    prdt_kind_nm_en,
    fr_or_cls,
    stock_qty_expected,
    stock_tag_amt_total,
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
  FROM stock_with_remark
)

-- Step 4: 최종 집계
SELECT 
  yymm AS month,
  brd_cd AS brand,
  prdt_kind_nm_en AS item_category,
  fr_or_cls AS channel,
  product_type,
  SUM(stock_tag_amt_total) AS total_amount,
  SUM(stock_qty_expected) AS total_qty
FROM stock_classified
GROUP BY yymm, brd_cd, prdt_kind_nm_en, fr_or_cls, product_type
ORDER BY yymm, brd_cd, item_category, channel, product_type
"""
    return query


def aggregate_inventory_from_snowflake(
    start_month: str = '202401',
    end_month: str = '202511'
) -> Tuple[Dict[Tuple, float], Set[str]]:
    """
    Snowflake에서 재고 데이터 집계
    
    Args:
        start_month: 시작월 (YYYYMM)
        end_month: 종료월 (YYYYMM)
    
    Returns:
        Tuple[Dict, Set]: 
            - Dict: (brand, item_tab, month, channel_group, product_type) → amount
            - Set: 예상치 못한 카테고리 (빈 set 반환)
    """
    print(f"[재고] Snowflake에서 데이터 조회 중... ({start_month} ~ {end_month})")
    
    query = build_inventory_aggregation_query(start_month, end_month)
    results = execute_query_batch(query)
    
    print(f"[재고] 조회 완료: {len(results):,}행")
    
    # 집계 결과를 기존 형식으로 변환
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    
    for row in results:
        month_yyyymm = row['MONTH']  # YYYYMM
        month_display = f"{month_yyyymm[:4]}.{month_yyyymm[4:6]}"  # YYYY.MM
        
        brand_code = row['BRAND']
        brand_name = BRAND_CODE_MAP.get(brand_code, brand_code)
        
        item_category = row['ITEM_CATEGORY']
        channel = row['CHANNEL']
        product_type = row['PRODUCT_TYPE']
        amount = float(row['TOTAL_AMOUNT']) if row['TOTAL_AMOUNT'] else 0.0
        qty = float(row['TOTAL_QTY']) if row['TOTAL_QTY'] else 0.0
        
        # 아이템탭: "전체" + 개별 카테고리
        item_tabs = ['전체', item_category]
        
        for item_tab in item_tabs:
            # 전체재고 (FR + HQ + OR)
            key_total = (brand_name, item_tab, month_display, '전체', product_type)
            agg_dict[key_total] += amount
            
            # 대리상재고 (FRS)
            if channel == 'FR':
                key_frs = (brand_name, item_tab, month_display, 'FRS', product_type)
                agg_dict[key_frs] += amount
            
            # 본사재고 (HQ + OR)
            if channel in ['HQ', 'OR']:
                key_hq_or = (brand_name, item_tab, month_display, 'HQ_OR', product_type)
                agg_dict[key_hq_or] += amount
    
    print(f"[재고] 집계 완료: {len(agg_dict):,}개 키")
    
    # 예상치 못한 카테고리는 빈 set
    unexpected_categories = set()
    
    return dict(agg_dict), unexpected_categories


if __name__ == "__main__":
    # 테스트 실행
    print("=" * 60)
    print("재고 집계 테스트")
    print("=" * 60)
    
    try:
        agg_dict, unexpected = aggregate_inventory_from_snowflake('202511', '202511')
        
        print(f"\n집계 결과 샘플 (2025.11 MLB):")
        for key, value in list(agg_dict.items())[:10]:
            brand, item_tab, month, channel, ptype = key
            if brand == 'MLB' and month == '2025.11':
                print(f"  {brand} / {item_tab} / {channel} / {ptype}: {value:,.0f}")
    
    except Exception as e:
        print(f"[ERROR] 테스트 실패: {e}")
        import traceback
        traceback.print_exc()

