"""
악세사리 재고자산 데이터 전처리 스크립트
- 청크 기반 CSV 로딩으로 대용량 파일 처리
- 집계 결과를 JSON으로 저장
"""

import pandas as pd
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, Set, Tuple, Any
import calendar

# ========== 설정 ==========
CHUNK_SIZE = 200_000
INVENTORY_DATA_PATH = Path(r"C:\3.accweekcover\data\inventory")
SALES_JSON_PATH = Path(__file__).parent.parent / "public" / "data" / "accessory_sales_summary.json"
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data"

ANALYSIS_MONTHS = [
    "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
    "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12",
    "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
    "2025.07", "2025.08", "2025.09", "2025.10", "2025.11"
]

VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}
TARGET_CATEGORY = "饰品"
VALID_ITEM_CATEGORIES = {"Shoes", "Headwear", "Bag", "Acc_etc"}
CORE_SEASONS = ["24FW", "25SS", "25FW", "26SS"]

INVENTORY_COLUMNS = [
    "Channel 2", "产品品牌", "产品大分类", "产品中分类",
    "运营基准", "产品季节", "预计库存金额"
]


def determine_operation_group(op_basis: str, season: str) -> str:
    op_basis = str(op_basis).strip() if pd.notna(op_basis) else ""
    season = str(season).strip() if pd.notna(season) else ""
    
    if op_basis in ["INTRO", "FOCUS"]:
        return "core"
    
    if op_basis == "":
        for core_season in CORE_SEASONS:
            if core_season in season:
                return "core"
    
    return "outlet"


def get_days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def load_sales_or_data() -> Dict[Tuple, float]:
    """판매 JSON에서 OR 매출 데이터 추출 (원 단위로 저장되어 있음)"""
    sales_or_dict: Dict[Tuple, float] = {}
    
    if not SALES_JSON_PATH.exists():
        print(f"[WARNING] 판매 JSON 파일이 없습니다: {SALES_JSON_PATH}")
        return sales_or_dict
    
    with open(SALES_JSON_PATH, 'r', encoding='utf-8') as f:
        sales_data = json.load(f)
    
    for brand in VALID_BRANDS:
        if brand not in sales_data.get("brands", {}):
            continue
        for item_tab in ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"]:
            if item_tab not in sales_data["brands"][brand]:
                continue
            for month in ANALYSIS_MONTHS:
                if month not in sales_data["brands"][brand][item_tab]:
                    continue
                month_data = sales_data["brands"][brand][item_tab][month]
                # 이미 원 단위로 저장되어 있음
                for op_group in ["core", "outlet"]:
                    key = (brand, item_tab, month, "OR", op_group)
                    amount_won = month_data.get(f"OR_{op_group}", 0)
                    sales_or_dict[key] = amount_won
    
    return sales_or_dict


def process_inventory_data() -> Tuple[Dict[Tuple, float], Set[str]]:
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    unexpected_categories: Set[str] = set()
    
    for month in ANALYSIS_MONTHS:
        file_path = INVENTORY_DATA_PATH / f"{month}.csv"
        
        if not file_path.exists():
            print(f"[WARNING] 파일 없음: {file_path}")
            continue
        
        print(f"처리 중: {file_path}")
        
        try:
            for chunk in pd.read_csv(
                file_path,
                chunksize=CHUNK_SIZE,
                encoding='utf-8-sig',
                usecols=INVENTORY_COLUMNS,
                dtype={
                    "Channel 2": str, "产品品牌": str, "产品大分类": str,
                    "产品中分类": str, "运营基准": str, "产品季节": str,
                    "预计库存金额": float
                }
            ):
                chunk = chunk[chunk["产品品牌"].isin(VALID_BRANDS)]
                if chunk.empty:
                    continue
                
                chunk = chunk[chunk["产品大分类"] == TARGET_CATEGORY]
                if chunk.empty:
                    continue
                
                for cat in set(chunk["产品中分类"].dropna().unique()):
                    if cat not in VALID_ITEM_CATEGORIES:
                        unexpected_categories.add(cat)
                
                chunk["operation_group"] = chunk.apply(
                    lambda row: determine_operation_group(row["运营基准"], row["产品季节"]), 
                    axis=1
                )
                
                year_month = f"{month[:4]}.{month[5:7]}"
                
                for _, row in chunk.iterrows():
                    brand = row["产品品牌"]
                    item_cat = row["产品中分类"]
                    channel = row["Channel 2"]
                    op_group = row["operation_group"]
                    amount = row["预计库存金额"] if pd.notna(row["预计库存金额"]) else 0.0
                    
                    if channel not in ["FRS", "HQ", "OR"]:
                        continue
                    
                    item_tabs = ["전체", item_cat] if item_cat in VALID_ITEM_CATEGORIES else ["전체"]
                    
                    for item_tab in item_tabs:
                        key_total = (brand, item_tab, year_month, "전체", op_group)
                        agg_dict[key_total] += amount
                        
                        if channel == "FRS":
                            key_frs = (brand, item_tab, year_month, "FRS", op_group)
                            agg_dict[key_frs] += amount
                        
                        if channel in ["HQ", "OR"]:
                            key_hq_or = (brand, item_tab, year_month, "HQ_OR", op_group)
                            agg_dict[key_hq_or] += amount
        
        except Exception as e:
            print(f"[ERROR] {file_path}: {e}")
            continue
    
    return dict(agg_dict), unexpected_categories


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
    print("재고자산 데이터 전처리 시작")
    print("=" * 60)
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    print("\n판매 OR 데이터 로드 중...")
    sales_or_dict = load_sales_or_data()
    print(f"OR 판매 키 수: {len(sales_or_dict):,}")
    
    print("\n재고 데이터 처리 중...")
    inv_agg, unexpected = process_inventory_data()
    
    if unexpected:
        print(f"\n[WARNING] 예상치 못한 중분류: {sorted(unexpected)}")
    
    print("\nJSON 변환 중...")
    result = convert_to_json(inv_agg, sales_or_dict, unexpected)
    
    output_file = OUTPUT_PATH / "accessory_inventory_summary.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n[DONE] 저장 완료: {output_file}")
    print(f"재고 집계 키 수: {len(inv_agg):,}")


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
                encoding='utf-8',
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



