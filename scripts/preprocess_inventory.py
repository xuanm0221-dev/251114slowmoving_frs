"""
악세사리 재고자산 데이터 전처리 스크립트 (Snowflake 버전)
- 기존 CSV 기반에서 Snowflake 직접 조회로 전환
- 집계 결과를 JSON으로 저장
- 프론트엔드 변경 없음 (JSON 구조 100% 동일)
"""

import json
import calendar
from pathlib import Path
from typing import Dict, Set, Tuple, Any

# 프로젝트 루트로 경로 추가
import sys
sys.path.insert(0, str(Path(__file__).parent))

from inventory_aggregation import aggregate_inventory_from_snowflake
from sales_aggregation import aggregate_sales_from_snowflake

# ========== 설정 ==========
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data"

ANALYSIS_MONTHS = [
    "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
    "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12",
    "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
    "2025.07", "2025.08", "2025.09", "2025.10", "2025.11"
]

VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}
VALID_ITEM_CATEGORIES = {"Shoes", "Headwear", "Bag", "Acc_etc"}


def get_days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def load_sales_or_data() -> Dict[Tuple, float]:
    """
    Snowflake에서 OR 판매 매출 데이터 조회
    (재고 JSON에서 OR_sales 필드에 사용)
    """
    print("[재고] OR 판매 데이터 조회 중...")
    
    start_month = ANALYSIS_MONTHS[0].replace('.', '')
    end_month = ANALYSIS_MONTHS[-1].replace('.', '')
    
    sales_agg_dict, _ = aggregate_sales_from_snowflake(start_month, end_month)
    
    # OR 채널 데이터만 추출
    sales_or_dict: Dict[Tuple, float] = {}
    for key, value in sales_agg_dict.items():
        brand, item_tab, month, channel, product_type = key
        if channel == 'OR':
            sales_or_dict[key] = value
    
    print(f"[재고] OR 판매 데이터 추출 완료: {len(sales_or_dict):,}개 키")
    return sales_or_dict


def process_inventory_data() -> Tuple[Dict[Tuple, float], Set[str]]:
    """
    Snowflake에서 재고 데이터 조회 및 집계
    (기존 CSV 기반 로직을 Snowflake로 완전 대체)
    """
    print("=" * 60)
    print("재고 데이터 Snowflake 조회 시작")
    print("=" * 60)
    
    try:
        # Snowflake에서 전체 기간 데이터 조회
        start_month = ANALYSIS_MONTHS[0].replace('.', '')  # "2024.01" → "202401"
        end_month = ANALYSIS_MONTHS[-1].replace('.', '')   # "2025.11" → "202511"
        
        agg_dict, unexpected_categories = aggregate_inventory_from_snowflake(
            start_month=start_month,
            end_month=end_month
        )
        
        print(f"[완료] 재고 데이터 집계 완료: {len(agg_dict):,}개 키")
        return agg_dict, unexpected_categories
    
    except Exception as e:
        print(f"[ERROR] Snowflake 조회 실패: {e}")
        import traceback
        traceback.print_exc()
        raise


def convert_to_json(inv_agg: Dict, sales_or: Dict, unexpected: Set) -> Dict:
    result = {
        "brands": {},
        "unexpectedCategories": sorted(list(unexpected)),
        "months": ANALYSIS_MONTHS,
        "daysInMonth": {}
    }
    
    for month in ANALYSIS_MONTHS:
        year, month_num = int(month[:4]), int(month[5:7])
        result["daysInMonth"][month] = get_days_in_month(year, month_num)
    
    for brand in VALID_BRANDS:
        result["brands"][brand] = {}
        for item_tab in ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"]:
            result["brands"][brand][item_tab] = {}
            for month in ANALYSIS_MONTHS:
                md = {}
                for op in ["core", "outlet"]:
                    md[f"전체_{op}"] = round(inv_agg.get((brand, item_tab, month, "전체", op), 0))
                    md[f"FRS_{op}"] = round(inv_agg.get((brand, item_tab, month, "FRS", op), 0))
                    md[f"HQ_OR_{op}"] = round(inv_agg.get((brand, item_tab, month, "HQ_OR", op), 0))
                    md[f"OR_sales_{op}"] = sales_or.get((brand, item_tab, month, "OR", op), 0)
                result["brands"][brand][item_tab][month] = md
    
    return result


def main():
    print("=" * 60)
    print("재고자산 데이터 전처리 시작 (Snowflake 버전)")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    print(f"분석 기간: {ANALYSIS_MONTHS[0]} ~ {ANALYSIS_MONTHS[-1]}")
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 스냅샷 파일에서 2025년 11월까지 데이터 로드
    snapshot_path = OUTPUT_PATH / "snapshots" / "accessory_inventory_summary_202511.json"
    snapshot_data = None
    if snapshot_path.exists():
        print("\n" + "=" * 40)
        print("스냅샷 데이터 로드 중 (2025년 11월까지)...")
        print("=" * 40)
        with open(snapshot_path, 'r', encoding='utf-8') as f:
            snapshot_data = json.load(f)
        print(f"[완료] 스냅샷 로드: {snapshot_path}")
    
    print("\n판매 OR 데이터 로드 중 (Snowflake)...")
    sales_or_dict = load_sales_or_data()
    print(f"OR 판매 키 수: {len(sales_or_dict):,}")
    
    print("\n재고 데이터 처리 중 (Snowflake, 2025년 12월부터)...")
    inv_agg, unexpected = process_inventory_data()
    
    if unexpected:
        print(f"\n[WARNING] 예상치 못한 중분류: {sorted(unexpected)}")
    
    print("\nJSON 변환 중...")
    result = convert_to_json(inv_agg, sales_or_dict, unexpected)
    
    # 스냅샷 데이터와 병합 (2025년 11월까지는 스냅샷 사용)
    if snapshot_data:
        print("스냅샷 데이터와 병합 중...")
        # 2025년 11월까지는 스냅샷 데이터 사용
        for brand in snapshot_data.get("brands", {}):
            if brand not in result["brands"]:
                result["brands"][brand] = {}
            for item_tab in snapshot_data["brands"][brand]:
                if item_tab not in result["brands"][brand]:
                    result["brands"][brand][item_tab] = {}
                # 2025년 11월까지 데이터는 스냅샷에서 가져오기
                for month in snapshot_data["brands"][brand][item_tab]:
                    if month <= "2025.11":
                        result["brands"][brand][item_tab][month] = snapshot_data["brands"][brand][item_tab][month]
        
        # months와 daysInMonth도 병합
        snapshot_months = set(snapshot_data.get("months", []))
        current_months = set(result.get("months", []))
        result["months"] = sorted(list(snapshot_months | current_months))
        
        # daysInMonth 병합
        for month in snapshot_data.get("daysInMonth", {}):
            if month <= "2025.11":
                result["daysInMonth"][month] = snapshot_data["daysInMonth"][month]
        
        print("[완료] 스냅샷 데이터 병합 완료 (2025년 11월까지 고정)")
    
    output_file = OUTPUT_PATH / "accessory_inventory_summary.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n[DONE] 저장 완료: {output_file}")
    print(f"재고 집계 키 수: {len(inv_agg):,}")
    print()


def merge_inventory_month(months_to_merge: list, new_inventory_path: str = None):
    """
    특정 월의 재고 데이터만 병합 (기존 JSON 유지)
    
    Args:
        months_to_merge: 병합할 월 목록 (예: ["2025.11"])
        new_inventory_path: 새 데이터 경로 (None이면 기존 경로 사용)
    """
    inventory_path = Path(new_inventory_path) if new_inventory_path else INVENTORY_DATA_PATH
    
    print("=" * 60)
    print("재고 데이터 병합 모드")
    print("=" * 60)
    print(f"병합할 월: {months_to_merge}")
    print(f"데이터 경로: {inventory_path}")
    print()
    
    # 1. 기존 JSON 읽기
    output_file = OUTPUT_PATH / "accessory_inventory_summary.json"
    if not output_file.exists():
        print(f"[ERROR] 기존 JSON 파일이 없습니다: {output_file}")
        return
    
    with open(output_file, 'r', encoding='utf-8') as f:
        existing_data = json.load(f)
    
    print(f"기존 JSON 로드 완료: {output_file}")
    
    # 2. 판매 OR 데이터 로드
    print("\n판매 OR 데이터 로드 중...")
    sales_or_dict = load_sales_or_data()
    
    # 3. 새 월 데이터 처리
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    unexpected_categories: Set[str] = set()
    
    for month in months_to_merge:
        file_path = inventory_path / f"{month}.csv"
        
        if not file_path.exists():
            print(f"[WARNING] 파일이 존재하지 않습니다: {file_path}")
            continue
        
        print(f"처리 중 (재고): {file_path}")
        
        try:
            for chunk in pd.read_csv(
                file_path,
                chunksize=CHUNK_SIZE,
                encoding='utf-8-sig',
                usecols=INVENTORY_COLUMNS,
                dtype={
                    "Channel 2": str,
                    "产品品牌": str,
                    "产品大分类": str,
                    "产品中分类": str,
                    "运营基准": str,
                    "产品季节": str,
                    "预计库存金额": float
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
                    amount = row["预计库存金额"] if pd.notna(row["预计库存金额"]) else 0.0
                    
                    if item_cat in VALID_ITEM_CATEGORIES:
                        item_tabs = ["전체", item_cat]
                    else:
                        item_tabs = ["전체"]
                    
                    for item_tab in item_tabs:
                        # 전체재고
                        key_total = (brand, item_tab, year_month, "전체", op_group)
                        agg_dict[key_total] += amount
                        
                        # 채널별 재고
                        if channel == "FRS":
                            key_frs = (brand, item_tab, year_month, "FRS", op_group)
                            agg_dict[key_frs] += amount
                        elif channel in ["HQ", "OR"]:  # HQ + OR = 본사재고
                            key_hq_or = (brand, item_tab, year_month, "HQ_OR", op_group)
                            agg_dict[key_hq_or] += amount
                        
        except Exception as e:
            print(f"[ERROR] 파일 처리 실패: {file_path}")
            print(f"  - {e}")
    
    # 4. 기존 데이터에 병합
    print()
    print("기존 데이터에 병합 중...")
    
    for month in months_to_merge:
        year, month_num = int(month[:4]), int(month[5:7])
        
        # daysInMonth 업데이트
        existing_data["daysInMonth"][month] = get_days_in_month(year, month_num)
        
        # 브랜드별 데이터 업데이트
        for brand in VALID_BRANDS:
            brand_key = brand  # 재고는 브랜드명 그대로 사용
            
            if brand_key not in existing_data["brands"]:
                existing_data["brands"][brand_key] = {}
            
            for item_tab in ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"]:
                if item_tab not in existing_data["brands"][brand_key]:
                    existing_data["brands"][brand_key][item_tab] = {}
                
                # 해당 월 데이터 생성
                md = {}
                for op in ["core", "outlet"]:
                    md[f"전체_{op}"] = round(agg_dict.get((brand, item_tab, month, "전체", op), 0))
                    md[f"FRS_{op}"] = round(agg_dict.get((brand, item_tab, month, "FRS", op), 0))
                    md[f"HQ_OR_{op}"] = round(agg_dict.get((brand, item_tab, month, "HQ_OR", op), 0))
                    md[f"OR_sales_{op}"] = sales_or_dict.get((brand, item_tab, month, "OR", op), 0)
                
                existing_data["brands"][brand_key][item_tab][month] = md
    
    # months 목록 업데이트
    for month in months_to_merge:
        if month not in existing_data["months"]:
            existing_data["months"].append(month)
    existing_data["months"] = sorted(existing_data["months"])
    
    # 5. JSON 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print(f"[DONE] 병합 완료: {output_file}")
    print(f"병합된 월: {months_to_merge}")
    
    if unexpected_categories:
        print(f"[WARNING] 예상치 못한 중분류: {unexpected_categories}")


if __name__ == "__main__":
    import sys
    
    # 병합 모드: python preprocess_inventory.py --merge 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--merge":
        months = sys.argv[2:]
        if months:
            # 새 경로 사용
            merge_inventory_month(months, r"D:\data\inventory")
        else:
            print("사용법: python preprocess_inventory.py --merge 2025.11 [2025.12 ...]")
    else:
        main()



