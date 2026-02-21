"""
실제입고 데이터 전처리 스크립트
- Snowflake에서 실제입고 데이터 조회
- 브랜드별, 월별로 데이터 저장
- 기준월 이전 월들만 전처리 (당월 제외)
- public/data/accessory_actual_arrival_summary.json 생성
"""

import json
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

START_MONTH = "2024.01"  # 시작 월


def generate_months(start_month: str, end_month: str) -> Dict[str, List]:
    """기준월까지의 월 목록 생성"""
    start_year, start_month_num = map(int, start_month.split("."))
    end_year, end_month_num = map(int, end_month.split("."))
    
    months = []
    yyyymm_list = []
    month_keys = []
    
    current_year = start_year
    current_month = start_month_num
    
    while (
        current_year < end_year or 
        (current_year == end_year and current_month <= end_month_num)
    ):
        month_str = f"{current_year}.{str(current_month).zfill(2)}"
        yyyymm = current_year * 100 + current_month
        month_key = f"{str(current_year)[-2:]}.{str(current_month).zfill(2)}"
        
        months.append(month_str)
        yyyymm_list.append(yyyymm)
        month_keys.append(month_key)
        
        current_month += 1
        if current_month > 12:
            current_month = 1
            current_year += 1
    
    return {
        "months": months,
        "yyyymmList": yyyymm_list,
        "monthKeys": month_keys
    }


def fetch_actual_arrival_data(
    brand: str,
    start_month: str,
    end_month: str
) -> Dict[str, Dict[str, float]]:
    """실제입고 데이터 조회 (기간 전체)"""
    start_yyyymm = int(start_month.replace(".", ""))
    end_yyyymm = int(end_month.replace(".", ""))
    
    months_info = generate_months(start_month, end_month)
    pivot_columns = ",".join(str(yyyymm) for yyyymm in months_info["yyyymmList"])
    
    select_columns = ",\n    ".join([
        f'NVL("{yyyymm}",0) AS "{month_key}"'
        for yyyymm, month_key in zip(months_info["yyyymmList"], months_info["monthKeys"])
    ])
    
    sql = f"""
WITH acc_item_map AS (
    SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
    FROM FNF.PRCS.DB_PRDT
    WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
      AND PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
base AS (
    SELECT
          a.yyyymm
        , CASE
            WHEN db.PRDT_KIND_NM_ENG = 'Shoes'    THEN '신발'
            WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
            WHEN db.PRDT_KIND_NM_ENG = 'Bag'      THEN '가방'
            WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc'  THEN '기타악세'
          END AS item
        , a.stor_amt AS in_stock_amt
    FROM sap_fnf.dw_cn_ivtr_prdt_m a
    JOIN acc_item_map db ON SUBSTR(a.prdt_cd, 7, 2) = db.ITEM
    WHERE a.brd_cd = '{brand}'
      AND a.yyyymm BETWEEN {start_yyyymm} AND {end_yyyymm}
),
agg AS (
    SELECT
          CASE WHEN GROUPING(item)=1 THEN '합계' ELSE item END AS item
        , yyyymm
        , SUM(in_stock_amt) AS in_stock_amt
    FROM base
    GROUP BY GROUPING SETS ((item, yyyymm), (yyyymm))
),
pv AS (
    SELECT *
    FROM agg
    PIVOT (
        SUM(in_stock_amt) FOR yyyymm IN ({pivot_columns})
    )
)
SELECT
      item
    , {select_columns}
FROM pv
ORDER BY
    CASE item
        WHEN '합계'     THEN 0
        WHEN '신발'     THEN 1
        WHEN '모자'     THEN 2
        WHEN '가방'     THEN 3
        WHEN '기타악세' THEN 4
        ELSE 99
    END
    """
    
    rows = execute_query(sql)
    
    result = {}
    months_info = generate_months(start_month, end_month)
    
    # 각 월별로 데이터 초기화
    for month in months_info["months"]:
        result[month] = {}
    
    # 각 행(합계, 신발, 모자, 가방, 기타악세) 처리
    for row in rows:
        item = row.get("ITEM") or row.get("item", "")
        
        # 합계 행은 건너뛰기
        if item == "합계":
            continue
        
        # 아이템명을 키로 변환
        item_key = None
        if item == "신발":
            item_key = "Shoes"
        elif item == "모자":
            item_key = "Headwear"
        elif item == "가방":
            item_key = "Bag"
        elif item == "기타악세":
            item_key = "Acc_etc"
        
        if not item_key:
            continue
        
        # 각 월별 데이터 추출 및 변환
        for month_key, month in zip(months_info["monthKeys"], months_info["months"]):
            value = row.get(month_key)
            num_value = float(value) if value is not None else 0.0
            
            if month in result and item_key:
                result[month][item_key] = num_value
    
    return result


def main(reference_month: str = None):
    """
    메인 실행 함수
    
    Args:
        reference_month: 기준월 (예: "2025.11"). None이면 전체 처리
    """
    print("=" * 60)
    print("실제입고 데이터 전처리 시작")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 기준월 모드 확인
    if reference_month:
        # 기준월의 전월까지 처리
        end_year, end_month_num = map(int, reference_month.split("."))
        prev_year = end_year
        prev_month_num = end_month_num - 1
        if prev_month_num < 1:
            prev_month_num = 12
            prev_year -= 1
        end_month = f"{prev_year}.{str(prev_month_num).zfill(2)}"
        
        print(f"\n[실제입고] 기준월 모드: {reference_month}의 전월({end_month})까지 처리합니다.")
        print(f"[실제입고] 당월({reference_month})은 제외됩니다.")
    else:
        print("\n[실제입고] 전체 처리 모드: 모든 브랜드와 월을 처리합니다.")
        end_month = None
    
    # 기존 JSON 파일 로드
    output_file = OUTPUT_PATH / "accessory_actual_arrival_summary.json"
    existing_data = {"brands": {}, "months": []}
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[실제입고] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
    
    # 각 브랜드별로 처리
    for brand_name in VALID_BRANDS:
        brand_code = BRAND_CODE_MAP[brand_name]
        print(f"\n[실제입고] 브랜드: {brand_name} ({brand_code})")
        
        if brand_name not in existing_data["brands"]:
            existing_data["brands"][brand_name] = {}
        
        if reference_month and end_month:
            # 기준월 모드: 기준월 이전 월들만 처리
            try:
                print(f"  처리 중: {START_MONTH} ~ {end_month}...")
                result = fetch_actual_arrival_data(
                    brand_code,
                    START_MONTH,
                    end_month
                )
                
                # 기존 데이터와 병합 (기존 월 데이터 유지, 새로 처리한 월만 덮어쓰기)
                for month, month_data in result.items():
                    if month <= end_month:  # 기준월 이전만 저장
                        existing_data["brands"][brand_name][month] = month_data
                        if month not in existing_data["months"]:
                            existing_data["months"].append(month)
                
                print(f"  완료: {START_MONTH} ~ {end_month}")
            except Exception as e:
                print(f"  [ERROR] 처리 실패: {e}")
                import traceback
                traceback.print_exc()
        else:
            # 전체 처리 모드: 전체 기간 처리
            # 여기서는 간단히 처리하지 않고, 사용자가 기준월을 지정하도록 함
            print("  [INFO] 전체 처리 모드는 기준월을 지정하여 실행하세요.")
            print("  예: python preprocess_actual_arrival.py --reference-month 2025.11")
    
    # months 목록 정렬
    existing_data["months"] = sorted(existing_data["months"])
    
    # JSON 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 60)
    print("전처리 완료")
    print("=" * 60)
    print(f"[DONE] 저장 완료: {output_file}")
    if existing_data["months"]:
        print(f"처리된 월: {existing_data['months'][0]} ~ {existing_data['months'][-1]} ({len(existing_data['months'])}개월)")


if __name__ == "__main__":
    import sys
    
    # 기준월 모드: python preprocess_actual_arrival.py --reference-month 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_actual_arrival.py --reference-month 2025.11")
    else:
        main()
