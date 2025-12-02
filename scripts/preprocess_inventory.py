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


if __name__ == "__main__":
    main()







