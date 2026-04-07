"""
악세사리 판매매출 데이터 전처리 스크립트 (Snowflake 버전)
- 기존 CSV 기반에서 Snowflake 직접 조회로 전환
- 집계 결과를 JSON으로 저장
- 프론트엔드 변경 없음 (JSON 구조 100% 동일)
"""

import json
import os
from pathlib import Path
from typing import Dict, Set, Tuple, Any

# 프로젝트 루트로 경로 추가 (sales_aggregation 임포트용)
import sys
sys.path.insert(0, str(Path(__file__).parent))

from sales_aggregation import aggregate_sales_from_snowflake

# ========== 설정 ==========
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data"

# 분석 기간
ANALYSIS_MONTHS = [
    "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
    "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12",
    "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
    "2025.07", "2025.08", "2025.09", "2025.10", "2025.11", "2025.12",
    "2026.01", "2026.02", "2026.03"
]

# 브랜드 필터
VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}

# 정상 중분류 값 (검증용)
VALID_ITEM_CATEGORIES = {"Shoes", "Headwear", "Bag", "Acc_etc"}


def get_processed_months_from_json() -> set:
    """
    기존 JSON 파일에서 실제로 데이터가 있는 월 목록 추출
    
    Returns:
        set: 처리된 월 목록 (예: {"2024.01", "2024.02", ...})
    """
    output_file = OUTPUT_PATH / "accessory_sales_summary.json"
    if not output_file.exists():
        return set()
    
    try:
        with open(output_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # months 배열에서 추출
        months_list = data.get("months", [])
        return set(months_list)
    except Exception as e:
        print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
        return set()


def get_new_months_to_process() -> list:
    """
    ANALYSIS_MONTHS에서 새로 추가된 월만 반환
    
    Returns:
        list: 새로 처리할 월 목록 (예: ["2025.12", "2026.01"])
    """
    processed_months = get_processed_months_from_json()
    new_months = [m for m in ANALYSIS_MONTHS if m not in processed_months]
    return sorted(new_months)


def display_preprocessing_status() -> list:
    """
    현재 전처리 상태를 명확히 표시하고 새로 처리할 월 목록 반환
    
    Returns:
        list: 새로 처리할 월 목록
    """
    processed_months = get_processed_months_from_json()
    new_months = get_new_months_to_process()
    
    print("=" * 60)
    print("전처리 상태 확인")
    print("=" * 60)
    
    if processed_months:
        sorted_processed = sorted(processed_months)
        first_month = sorted_processed[0]
        last_month = sorted_processed[-1]
        count = len(processed_months)
        print(f"[판매] 기존 JSON에 포함된 월: {first_month} ~ {last_month} ({count}개월)")
    else:
        print("[판매] 기존 JSON 파일이 없습니다. 전체 기간을 처리합니다.")
    
    sorted_analysis = sorted(ANALYSIS_MONTHS)
    first_analysis = sorted_analysis[0]
    last_analysis = sorted_analysis[-1]
    count_analysis = len(ANALYSIS_MONTHS)
    print(f"[판매] ANALYSIS_MONTHS에 정의된 월: {first_analysis} ~ {last_analysis} ({count_analysis}개월)")
    
    if new_months:
        print(f"[판매] 새로 처리할 월: {', '.join(new_months)} ({len(new_months)}개월)")
    else:
        print("[판매] 새로 처리할 월이 없습니다. 모든 월이 이미 처리되었습니다.")
    
    print()
    return new_months


def get_reference_month() -> str:
    """
    기준월(reference_month) 계산: ANALYSIS_MONTHS 중 최대값 (YYYYMM)

    기준월은 operate_standard 소스를 결정한다.
    - 기준월 행 → MST 실시간
    - 25.12 ~ 기준월 미만 → PREP 익월
    CLI --reference-month 오버라이드가 있으면 그 값이 우선됨(호출자에서 처리).
    """
    ref_display = max(ANALYSIS_MONTHS)  # 예: "2026.03"
    return ref_display.replace('.', '')  # → "202603"


def process_retail_data(months_to_process: list = None, reference_month: str = None) -> Tuple[Dict[str, Any], Set[str]]:
    """
    Snowflake에서 판매 데이터 조회 및 집계
    (기존 CSV 기반 로직을 Snowflake로 완전 대체)
    
    Args:
        months_to_process: 처리할 월 목록 (None이면 전체 기간 처리)
        reference_month: 기준월 (YYYYMM). None이면 max(ANALYSIS_MONTHS) 사용.
                         기준월 행은 MST 실시간, 25.12~기준월 미만은 PREP 익월.
    
    Returns:
        Tuple[Dict, Set]: 집계 결과와 예상치 못한 카테고리
    """
    print("=" * 60)
    print("판매 데이터 Snowflake 조회 시작")
    print("=" * 60)

    ref = reference_month if reference_month else get_reference_month()
    print(f"[판매] 기준월(ref): {ref}  ← 이 월은 MST 실시간, 25.12~이전은 PREP 익월")

    try:
        if months_to_process is None:
            # 전체 기간 처리 (기존 동작)
            start_month = ANALYSIS_MONTHS[0].replace('.', '')  # "2024.01" → "202401"
            end_month = ANALYSIS_MONTHS[-1].replace('.', '')   # "2026.03" → "202603"
            print(f"[판매] 전체 기간 처리: {start_month} ~ {end_month}")
        else:
            # 선택된 월만 처리
            if not months_to_process:
                print("[판매] 처리할 월이 없습니다.")
                return {}, set()
            
            start_month = min(months_to_process).replace('.', '')  # "2025.12" → "202512"
            end_month = max(months_to_process).replace('.', '')   # "2026.03" → "202603"
            print(f"[판매] 선택된 월만 처리: {start_month} ~ {end_month}")
            print(f"[판매] 처리할 월 목록: {', '.join(months_to_process)}")
        
        agg_dict, unexpected_categories = aggregate_sales_from_snowflake(
            start_month=start_month,
            end_month=end_month,
            reference_month=ref
        )
        
        # months_to_process가 지정된 경우, 해당 월만 필터링
        if months_to_process:
            months_set = set(months_to_process)
            filtered_dict = {}
            for key, value in agg_dict.items():
                brand, item_tab, month, channel, ptype = key
                if month in months_set:
                    filtered_dict[key] = value
            agg_dict = filtered_dict
            print(f"[판매] 필터링 완료: {len(agg_dict):,}개 키 (선택된 월만)")
        
        print(f"[완료] 판매 데이터 집계 완료: {len(agg_dict):,}개 키")
        return agg_dict, unexpected_categories
    
    except Exception as e:
        print(f"[ERROR] Snowflake 조회 실패: {e}")
        import traceback
        traceback.print_exc()
        raise


def convert_sales_to_json_structure(agg_dict: Dict[Tuple, float], unexpected_categories: Set[str]) -> Dict[str, Any]:
    """
    판매 집계 결과를 JSON 구조로 변환
    """
    result = {
        "brands": {},
        "unexpectedCategories": sorted(list(unexpected_categories)),
        "months": ANALYSIS_MONTHS
    }
    
    for brand in VALID_BRANDS:
        result["brands"][brand] = {}
        
        for item_tab in ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"]:
            result["brands"][brand][item_tab] = {}
            
            for month in ANALYSIS_MONTHS:
                month_data = {}
                
                for channel_group in ["전체", "FRS", "OR"]:
                    for op_group in ["core", "outlet"]:
                        key = (brand, item_tab, month, channel_group, op_group)
                        amount = agg_dict.get(key, 0.0)
                        # 원 단위로 저장 (나누기 제거)
                        amount_won = round(amount)
                        month_data[f"{channel_group}_{op_group}"] = amount_won
                
                result["brands"][brand][item_tab][month] = month_data
    
    return result




def main(reference_month: str = None):
    """
    메인 실행 함수
    
    Args:
        reference_month: 기준월 (예: "2026.01"). None이면 ANALYSIS_MONTHS에서 새로 추가된 월만 처리
    """
    print("=" * 60)
    print("악세사리 판매매출 데이터 전처리 시작 (Snowflake 버전)")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    print(f"분석 기간: {ANALYSIS_MONTHS[0]} ~ {ANALYSIS_MONTHS[-1]}")
    print()
    
    # 출력 폴더 생성
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 기준월이 지정된 경우 해당 월만 처리
    if reference_month:
        print(f"[판매] 기준월 모드: {reference_month}만 처리합니다.")
        new_months = [reference_month]
    else:
        # 전처리 상태 확인 및 새로 처리할 월 목록 가져오기
        new_months = display_preprocessing_status()
    
    # 기존 JSON 파일 로드 (병합을 위해)
    sales_output_file = OUTPUT_PATH / "accessory_sales_summary.json"
    existing_data = None
    if sales_output_file.exists():
        try:
            with open(sales_output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[판매] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
    
    # 스냅샷 파일에서 2025년 11월까지 데이터 로드
    snapshot_path = OUTPUT_PATH / "snapshots" / "accessory_sales_summary_202511.json"
    snapshot_data = None
    if snapshot_path.exists():
        print("=" * 40)
        print("스냅샷 데이터 로드 중 (2025년 11월까지)...")
        print("=" * 40)
        with open(snapshot_path, 'r', encoding='utf-8') as f:
            snapshot_data = json.load(f)
        print(f"[완료] 스냅샷 로드: {snapshot_path}")
        print()
    
    # 새로 처리할 월이 있으면 해당 월만 처리, 없으면 전체 처리
    if new_months:
        print("=" * 60)
        print("판매 데이터 처리 시작 (증분 처리 모드)")
        print("=" * 60)
        months_to_process = new_months
    else:
        print("=" * 60)
        print("판매 데이터 처리 시작 (전체 처리 모드)")
        print("=" * 60)
        months_to_process = None
    
    # reference_month: CLI "--reference-month YYYY.MM" 값 또는 max(ANALYSIS_MONTHS)
    ref_yyyymm = reference_month.replace('.', '') if reference_month else get_reference_month()
    print(f"\n[기준월] {ref_yyyymm}  ← 이 월=MST 실시간, 25.12~이전=PREP 익월")

    sales_agg_dict, sales_unexpected = process_retail_data(months_to_process, reference_month=ref_yyyymm)
    
    if sales_unexpected:
        print()
        print("[WARNING] 판매 데이터 - 제품중분류에 예상치 못한 값:")
        for cat in sorted(sales_unexpected):
            print(f"   - {cat}")
    
    # JSON 변환 및 저장 - 판매
    print()
    print("판매 데이터 JSON 변환 중...")
    sales_json = convert_sales_to_json_structure(sales_agg_dict, sales_unexpected)
    
    # 기존 데이터와 병합
    if existing_data:
        print("기존 데이터와 병합 중...")
        # 기존 월 데이터 유지 (새로 처리한 월만 덮어쓰기)
        for brand in existing_data.get("brands", {}):
            if brand not in sales_json["brands"]:
                sales_json["brands"][brand] = {}
            for item_tab in existing_data["brands"][brand]:
                if item_tab not in sales_json["brands"][brand]:
                    sales_json["brands"][brand][item_tab] = {}
                # 기존 월 데이터 복사 (새로 처리한 월이 아니면)
                for month in existing_data["brands"][brand][item_tab]:
                    if not new_months or month not in new_months:
                        sales_json["brands"][brand][item_tab][month] = existing_data["brands"][brand][item_tab][month]
        
        # months 목록도 병합
        existing_months = set(existing_data.get("months", []))
        current_months = set(sales_json.get("months", []))
        sales_json["months"] = sorted(list(existing_months | current_months))
        
        print("[완료] 기존 데이터 병합 완료")
    
    # 스냅샷 데이터와 병합 (2025년 11월까지는 스냅샷 사용)
    if snapshot_data:
        print("스냅샷 데이터와 병합 중...")
        # 2025년 11월까지는 스냅샷 데이터 사용
        for brand in snapshot_data.get("brands", {}):
            if brand not in sales_json["brands"]:
                sales_json["brands"][brand] = {}
            for item_tab in snapshot_data["brands"][brand]:
                if item_tab not in sales_json["brands"][brand]:
                    sales_json["brands"][brand][item_tab] = {}
                # 2025년 11월까지 데이터는 스냅샷에서 가져오기
                for month in snapshot_data["brands"][brand][item_tab]:
                    if month <= "2025.11":
                        sales_json["brands"][brand][item_tab][month] = snapshot_data["brands"][brand][item_tab][month]
        
        # months 목록도 병합
        snapshot_months = set(snapshot_data.get("months", []))
        current_months = set(sales_json.get("months", []))
        sales_json["months"] = sorted(list(snapshot_months | current_months))
        
        print("[완료] 스냅샷 데이터 병합 완료 (2025년 11월까지 고정)")
    
    # JSON 저장
    with open(sales_output_file, 'w', encoding='utf-8') as f:
        json.dump(sales_json, f, ensure_ascii=False, indent=2)
    
    # 완료 상태 출력
    print("\n" + "=" * 60)
    print("전처리 완료")
    print("=" * 60)
    final_months = sorted(sales_json.get("months", []))
    if final_months:
        first_month = final_months[0]
        last_month = final_months[-1]
        count = len(final_months)
        print(f"[판매] 처리 완료된 월: {first_month} ~ {last_month} ({count}개월)")
        print(f"[판매] 마지막 처리 월: {last_month}")
    print(f"[판매] 판매 집계 키 수: {len(sales_agg_dict):,}")
    if sales_unexpected:
        print(f"[판매] 예상치 못한 중분류 수: {len(sales_unexpected)}")
    print(f"[DONE] 저장 완료: {sales_output_file}")
    print()
    print("[참고] 재고 데이터는 preprocess_inventory.py를 실행하세요.")
    print()


def merge_sales_month(months_to_merge: list, new_retail_path: str = None):
    """
    특정 월의 판매 데이터만 병합 (기존 JSON 유지)
    
    Args:
        months_to_merge: 병합할 월 목록 (예: ["2025.11"])
        new_retail_path: 새 데이터 경로 (None이면 기존 경로 사용)
    """
    import copy
    
    retail_path = Path(new_retail_path) if new_retail_path else RETAIL_DATA_PATH
    
    print("=" * 60)
    print("판매 데이터 병합 모드")
    print("=" * 60)
    print(f"병합할 월: {months_to_merge}")
    print(f"데이터 경로: {retail_path}")
    print()
    
    # 1. 기존 JSON 읽기
    sales_output_file = OUTPUT_PATH / "accessory_sales_summary.json"
    if not sales_output_file.exists():
        print(f"[ERROR] 기존 JSON 파일이 없습니다: {sales_output_file}")
        return
    
    with open(sales_output_file, 'r', encoding='utf-8') as f:
        existing_data = json.load(f)
    
    print(f"기존 JSON 로드 완료: {sales_output_file}")
    
    # 2. 새 월 데이터 처리
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    unexpected_categories: Set[str] = set()
    
    for month in months_to_merge:
        file_path = retail_path / f"{month}.csv"
        
        if not file_path.exists():
            print(f"[WARNING] 파일이 존재하지 않습니다: {file_path}")
            continue
        
        print(f"처리 중 (판매): {file_path}")
        
        try:
            for chunk in pd.read_csv(
                file_path,
                chunksize=CHUNK_SIZE,
                encoding='utf-8',
                usecols=RETAIL_COLUMNS,
                dtype={
                    "Channel 2": str,
                    "产品品牌": str,
                    "产品大分类": str,
                    "产品中分类": str,
                    "运营基准": str,
                    "产品季节": str,
                    "吊牌金额": float
                }
            ):
                # 브랜드 필터
                chunk = chunk[chunk["产品品牌"].isin(VALID_BRANDS)]
                if chunk.empty:
                    continue
                
                # 대분류 필터
                chunk = chunk[chunk["产品大分类"] == TARGET_CATEGORY]
                if chunk.empty:
                    continue
                
                # 예상치 못한 중분류 확인
                chunk_categories = set(chunk["产品中分类"].dropna().unique())
                for cat in chunk_categories:
                    if cat not in VALID_ITEM_CATEGORIES:
                        unexpected_categories.add(cat)
                
                # operation_group 파생
                chunk["operation_group"] = chunk.apply(
                    lambda row: determine_operation_group(row["运营基准"], row["产品季节"]), 
                    axis=1
                )
                
                # 연월 추출
                year = month[:4]
                month_num = month[5:7]
                year_month = f"{year}.{month_num}"
                
                # 집계
                for _, row in chunk.iterrows():
                    brand = row["产品品牌"]
                    item_cat = row["产品中分类"]
                    channel = row["Channel 2"]
                    op_group = row["operation_group"]
                    amount = row["吊牌金额"] if pd.notna(row["吊牌金额"]) else 0.0
                    
                    if channel not in ["FRS", "OR"]:
                        continue
                    
                    if item_cat in VALID_ITEM_CATEGORIES:
                        item_tabs = ["전체", item_cat]
                    else:
                        item_tabs = ["전체"]
                    
                    for item_tab in item_tabs:
                        key_total = (brand, item_tab, year_month, "전체", op_group)
                        agg_dict[key_total] += amount
                        
                        key_channel = (brand, item_tab, year_month, channel, op_group)
                        agg_dict[key_channel] += amount
                        
        except Exception as e:
            print(f"[ERROR] 파일 처리 실패: {file_path}")
            print(f"  - {e}")
    
    # 3. 기존 데이터에 병합
    print()
    print("기존 데이터에 병합 중...")
    
    for key, value in agg_dict.items():
        brand, item_tab, year_month, channel, op_group = key
        
        # 브랜드 키 변환
        brand_key = {"MLB": "MLB", "MLB KIDS": "MLB_KIDS", "DISCOVERY": "DISCOVERY"}[brand]
        
        # 브랜드 데이터 없으면 생성
        if brand_key not in existing_data["brands"]:
            existing_data["brands"][brand_key] = {}
        
        # 아이템탭 데이터 없으면 생성
        if item_tab not in existing_data["brands"][brand_key]:
            existing_data["brands"][brand_key][item_tab] = {}
        
        # 월 데이터 없으면 생성
        if year_month not in existing_data["brands"][brand_key][item_tab]:
            existing_data["brands"][brand_key][item_tab][year_month] = {}
        
        month_data = existing_data["brands"][brand_key][item_tab][year_month]
        
        # 필드 키 생성 및 값 저장
        if channel == "전체":
            field_key = f"전체_{op_group}"
        else:
            field_key = f"{channel}_{op_group}"
        
        month_data[field_key] = round(value)
    
    # months 목록 업데이트
    for month in months_to_merge:
        if month not in existing_data["months"]:
            existing_data["months"].append(month)
    existing_data["months"] = sorted(existing_data["months"])
    
    # 4. JSON 저장
    with open(sales_output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print(f"[DONE] 병합 완료: {sales_output_file}")
    print(f"병합된 월: {months_to_merge}")
    
    if unexpected_categories:
        print(f"[WARNING] 예상치 못한 중분류: {unexpected_categories}")


if __name__ == "__main__":
    import sys
    
    # 병합 모드: python preprocess_sales.py --merge 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--merge":
        months = sys.argv[2:]
        if months:
            # 새 경로 사용
            merge_sales_month(months, r"D:\data\retail")
        else:
            print("사용법: python preprocess_sales.py --merge 2025.11 [2025.12 ...]")
    # 기준월 모드: python preprocess_sales.py --reference-month 2026.01
    elif len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_sales.py --reference-month 2026.01")
    else:
        main()
