"""
Snowflake shop_id 매핑 검증 스크립트
실행: python scripts/run_verification.py
"""

import sys
import os
import io
from dotenv import load_dotenv

# Windows 콘솔 UTF-8 인코딩 설정
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 상위 디렉토리의 snowflake_utils 사용
sys.path.append(os.path.dirname(__file__))
from snowflake_utils import execute_query_batch

# .env.local 로드
load_dotenv(override=True)

def print_section(title):
    """섹션 구분선 출력"""
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80)

def run_verification_query_7():
    """
    검증 쿼리 7: 2025.11 MLB 판매 검증 (목표값 대조)
    """
    query = """
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
  'TOTAL' AS channel,
  ROUND(SUM(total_amt), 0) AS actual_amount,
  376864306 AS target_amount,
  ROUND(SUM(total_amt), 0) - 376864306 AS difference,
  ROUND(100.0 * SUM(total_amt) / 376864306, 2) AS pct_of_target
FROM sales_202511
ORDER BY channel
    """
    
    print_section("검증 쿼리 7: 2025.11 MLB 판매 검증")
    print("\n목표값:")
    print("  FR:    314,337,013")
    print("  OR:     62,527,293")
    print("  TOTAL: 376,864,306")
    print("\n실행 중...")
    
    try:
        results = execute_query_batch(query)
        
        print("\n결과:")
        print(f"{'채널':<10} {'실제금액':>15} {'목표금액':>15} {'차이':>15} {'달성률(%)':>12}")
        print("-" * 70)
        
        for row in results:
            channel = row.get('CHANNEL', '')
            actual = row.get('ACTUAL_AMOUNT', 0)
            target = row.get('TARGET_AMOUNT', 0)
            diff = row.get('DIFFERENCE', 0)
            pct = row.get('PCT_OF_TARGET', 0)
            
            # 포맷팅
            actual_str = f"{int(actual):,}" if actual else "0"
            target_str = f"{int(target):,}" if target else "0"
            diff_str = f"{int(diff):,}" if diff else "0"
            pct_str = f"{pct:.2f}" if pct else "0.00"
            
            # 차이가 있으면 경고 표시
            status = "[OK]" if abs(diff) < 1000 else "[FAIL]"
            
            print(f"{channel:<10} {actual_str:>15} {target_str:>15} {diff_str:>15} {pct_str:>12} {status}")
        
        print("\n평가:")
        total_row = [r for r in results if r.get('CHANNEL') == 'TOTAL']
        if total_row:
            diff = total_row[0].get('DIFFERENCE', 0)
            pct = total_row[0].get('PCT_OF_TARGET', 0)
            
            if abs(diff) < 1000:
                print("  [OK] 검증 성공! 목표값과 일치합니다.")
            elif pct >= 99.9:
                print(f"  [WARNING] 거의 일치 (차이: {int(diff):,}, {pct:.2f}%)")
            else:
                print(f"  [FAIL] 검증 실패. 목표값과 차이가 있습니다. (차이: {int(diff):,}, {pct:.2f}%)")
        
    except Exception as e:
        print(f"\n[ERROR] 오류 발생: {e}")
        import traceback
        traceback.print_exc()

def run_quick_stats():
    """
    빠른 통계 확인
    """
    query = """
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
  COUNT(DISTINCT norm_key) AS unique_norm_keys,
  COUNT(DISTINCT fr_or_cls) AS unique_channels
FROM shop_map_norm
    """
    
    print_section("빠른 통계: shop_map_norm")
    
    try:
        results = execute_query_batch(query)
        if results:
            row = results[0]
            print(f"\n  고유 norm_key 개수: {row.get('UNIQUE_NORM_KEYS', 0):,}")
            print(f"  고유 채널 개수: {row.get('UNIQUE_CHANNELS', 0)}")
    except Exception as e:
        print(f"\n[ERROR] 오류 발생: {e}")

def run_unmapped_check():
    """
    미매핑 shop_id 확인
    """
    query = """
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
LIMIT 10
    """
    
    print_section("미매핑 shop_id TOP 10 (판매 기준)")
    
    try:
        results = execute_query_batch(query)
        
        if not results:
            print("\n  [OK] 미매핑 shop_id가 없습니다!")
        else:
            print(f"\n{'shop_id':<15} {'브랜드':<8} {'거래수':>12} {'금액':>15}")
            print("-" * 55)
            
            total_unmapped = 0
            for row in results:
                shop_id = row.get('UNMAPPED_SHOP_ID', '')
                brd = row.get('BRD_CD', '')
                cnt = row.get('TRANSACTION_COUNT', 0)
                amt = row.get('TOTAL_AMOUNT', 0)
                total_unmapped += amt
                
                print(f"{shop_id:<15} {brd:<8} {int(cnt):>12,} {int(amt):>15,}")
            
            print(f"\n  미매핑 총액: {int(total_unmapped):,}")
    except Exception as e:
        print(f"\n[ERROR] 오류 발생: {e}")

if __name__ == "__main__":
    print("\n" + "="*80)
    print("  Snowflake shop_id 매핑 검증")
    print("="*80)
    
    # 1. 빠른 통계
    run_quick_stats()
    
    # 2. 미매핑 확인
    run_unmapped_check()
    
    # 3. 메인 검증 (2025.11 MLB)
    run_verification_query_7()
    
    print("\n" + "="*80)
    print("  검증 완료")
    print("="*80 + "\n")

