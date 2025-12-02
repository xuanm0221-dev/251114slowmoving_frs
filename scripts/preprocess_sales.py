"""
악세사리 판매매출 및 재고자산 데이터 전처리 스크립트
- 청크 기반 CSV 로딩으로 대용량 파일 처리
- 집계 결과를 JSON으로 저장
"""

import pandas as pd
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Dict, Set, Tuple, Any
import calendar

# ========== 설정 ==========
CHUNK_SIZE = 200_000  # 청크 크기 (메모리 여유에 따라 조정 가능)
RETAIL_DATA_PATH = Path(r"C:\3.accweekcover\data\retail")
INVENTORY_DATA_PATH = Path(r"C:\3.accweekcover\data\inventory")
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data"

# 분석 기간
ANALYSIS_MONTHS = [
    "2024.01", "2024.02", "2024.03", "2024.04", "2024.05", "2024.06",
    "2024.07", "2024.08", "2024.09", "2024.10", "2024.11", "2024.12",
    "2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06",
    "2025.07", "2025.08", "2025.09", "2025.10", "2025.11"
]

# 브랜드 필터
VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}

# 대분류 필터
TARGET_CATEGORY = "饰品"

# 정상 중분류 값
VALID_ITEM_CATEGORIES = {"Shoes", "Headwear", "Bag", "Acc_etc"}

# 시즌 문자열 (operation_group 판단용)
CORE_SEASONS = ["24FW", "25SS", "25FW", "26SS"]

# 판매 데이터 사용 컬럼
RETAIL_COLUMNS = [
    "Channel 2",
    "产品品牌",
    "产品大分类",
    "产品中分类",
    "运营基准",
    "产品季节",
    "吊牌金额"
]

# 재고 데이터 사용 컬럼
INVENTORY_COLUMNS = [
    "Channel 2",
    "产品品牌",
    "产品大分类",
    "产品中分类",
    "运营基准",
    "产品季节",
    "预计库存金额"
]


def determine_operation_group(op_basis: str, season: str) -> str:
    """
    운영기준(运营基准)과 제품시즌(产品季节)을 기반으로 operation_group 결정
    
    주력(core):
    - 运营基准이 "INTRO" 또는 "FOCUS"
    - 또는 运营基准이 빈값이고, 产品季节에 24FW/25SS/25FW/26SS 포함
    
    아울렛(outlet):
    - 그 외 모두
    """
    op_basis = str(op_basis).strip() if pd.notna(op_basis) else ""
    season = str(season).strip() if pd.notna(season) else ""
    
    # 运营基准이 INTRO 또는 FOCUS이면 주력
    if op_basis in ["INTRO", "FOCUS"]:
        return "core"
    
    # 运营基准이 빈값이고 시즌 문자열 포함하면 주력
    if op_basis == "":
        for core_season in CORE_SEASONS:
            if core_season in season:
                return "core"
    
    # 그 외 모두 아울렛
    return "outlet"


def get_days_in_month(year: int, month: int) -> int:
    """해당 월의 일수 반환 (윤년 처리 포함)"""
    return calendar.monthrange(year, month)[1]


def process_retail_data() -> Tuple[Dict[str, Any], Set[str]]:
    """
    retail CSV 파일들을 청크 단위로 처리하여 집계
    """
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    unexpected_categories: Set[str] = set()
    
    for month in ANALYSIS_MONTHS:
        file_path = RETAIL_DATA_PATH / f"{month}.csv"
        
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
                # 1. 브랜드 필터
                chunk = chunk[chunk["产品品牌"].isin(VALID_BRANDS)]
                if chunk.empty:
                    continue
                
                # 2. 대분류 필터 (饰品만)
                chunk = chunk[chunk["产品大分类"] == TARGET_CATEGORY]
                if chunk.empty:
                    continue
                
                # 3. 예상치 못한 중분류 값 확인
                chunk_categories = set(chunk["产品中分类"].dropna().unique())
                for cat in chunk_categories:
                    if cat not in VALID_ITEM_CATEGORIES:
                        unexpected_categories.add(cat)
                
                # 4. operation_group 파생 컬럼 생성
                chunk["operation_group"] = chunk.apply(
                    lambda row: determine_operation_group(row["运营基准"], row["产品季节"]), 
                    axis=1
                )
                
                # 5. 연월 추출
                year = month[:4]
                month_num = month[5:7]
                year_month = f"{year}.{month_num}"
                
                # 6. 집계
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
                        # 전체판매 (FRS + OR)
                        key_total = (brand, item_tab, year_month, "전체", op_group)
                        agg_dict[key_total] += amount
                        
                        # 채널별 판매
                        key_channel = (brand, item_tab, year_month, channel, op_group)
                        agg_dict[key_channel] += amount
        
        except Exception as e:
            print(f"[ERROR] 파일 처리 중 오류 발생 ({file_path}): {e}")
            continue
    
    return dict(agg_dict), unexpected_categories


def process_inventory_data() -> Tuple[Dict[str, Any], Set[str]]:
    """
    inventory CSV 파일들을 청크 단위로 처리하여 집계
    """
    agg_dict: Dict[Tuple, float] = defaultdict(float)
    unexpected_categories: Set[str] = set()
    
    for month in ANALYSIS_MONTHS:
        file_path = INVENTORY_DATA_PATH / f"{month}.csv"
        
        if not file_path.exists():
            print(f"[WARNING] 재고 파일이 존재하지 않습니다: {file_path}")
            continue
        
        print(f"처리 중 (재고): {file_path}")
        
        try:
            for chunk in pd.read_csv(
                file_path,
                chunksize=CHUNK_SIZE,
                encoding='utf-8-sig',  # BOM 처리
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
                # 1. 브랜드 필터
                chunk = chunk[chunk["产品品牌"].isin(VALID_BRANDS)]
                if chunk.empty:
                    continue
                
                # 2. 대분류 필터 (饰品만)
                chunk = chunk[chunk["产品大分类"] == TARGET_CATEGORY]
                if chunk.empty:
                    continue
                
                # 3. 예상치 못한 중분류 값 확인
                chunk_categories = set(chunk["产品中分类"].dropna().unique())
                for cat in chunk_categories:
                    if cat not in VALID_ITEM_CATEGORIES:
                        unexpected_categories.add(cat)
                
                # 4. operation_group 파생 컬럼 생성
                chunk["operation_group"] = chunk.apply(
                    lambda row: determine_operation_group(row["运营基准"], row["产品季节"]), 
                    axis=1
                )
                
                # 5. 연월 추출
                year = month[:4]
                month_num = month[5:7]
                year_month = f"{year}.{month_num}"
                
                # 6. 집계
                for _, row in chunk.iterrows():
                    brand = row["产品品牌"]
                    item_cat = row["产品中分类"]
                    channel = row["Channel 2"]
                    op_group = row["operation_group"]
                    amount = row["预计库存金额"] if pd.notna(row["预计库存金额"]) else 0.0
                    
                    # Channel 2 유효값: FRS, HQ, OR
                    if channel not in ["FRS", "HQ", "OR"]:
                        continue
                    
                    if item_cat in VALID_ITEM_CATEGORIES:
                        item_tabs = ["전체", item_cat]
                    else:
                        item_tabs = ["전체"]
                    
                    for item_tab in item_tabs:
                        # 전체재고 (FRS + HQ + OR)
                        key_total = (brand, item_tab, year_month, "전체", op_group)
                        agg_dict[key_total] += amount
                        
                        # 대리상재고 (FRS)
                        if channel == "FRS":
                            key_frs = (brand, item_tab, year_month, "FRS", op_group)
                            agg_dict[key_frs] += amount
                        
                        # 본사재고 (HQ + OR)
                        if channel in ["HQ", "OR"]:
                            key_hq_or = (brand, item_tab, year_month, "HQ_OR", op_group)
                            agg_dict[key_hq_or] += amount
        
        except Exception as e:
            print(f"[ERROR] 재고 파일 처리 중 오류 발생 ({file_path}): {e}")
            continue
    
    return dict(agg_dict), unexpected_categories


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


def convert_inventory_to_json_structure(
    inv_agg_dict: Dict[Tuple, float], 
    sales_agg_dict: Dict[Tuple, float],
    unexpected_categories: Set[str]
) -> Dict[str, Any]:
    """
    재고 집계 결과를 JSON 구조로 변환
    직영재고와 창고재고는 프론트엔드에서 stock_week를 사용해 계산
    """
    result = {
        "brands": {},
        "unexpectedCategories": sorted(list(unexpected_categories)),
        "months": ANALYSIS_MONTHS,
        "daysInMonth": {}
    }
    
    # 각 월의 일수 계산
    for month in ANALYSIS_MONTHS:
        year = int(month[:4])
        month_num = int(month[5:7])
        result["daysInMonth"][month] = get_days_in_month(year, month_num)
    
    for brand in VALID_BRANDS:
        result["brands"][brand] = {}
        
        for item_tab in ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"]:
            result["brands"][brand][item_tab] = {}
            
            for month in ANALYSIS_MONTHS:
                month_data = {}
                
                # 전체재고 (FRS + HQ + OR)
                for op_group in ["core", "outlet"]:
                    key = (brand, item_tab, month, "전체", op_group)
                    amount = inv_agg_dict.get(key, 0.0)
                    amount_won = round(amount)  # 원 단위로 저장
                    month_data[f"전체_{op_group}"] = amount_won
                
                # 대리상재고 (FRS)
                for op_group in ["core", "outlet"]:
                    key = (brand, item_tab, month, "FRS", op_group)
                    amount = inv_agg_dict.get(key, 0.0)
                    amount_won = round(amount)  # 원 단위로 저장
                    month_data[f"FRS_{op_group}"] = amount_won
                
                # 본사재고 (HQ + OR)
                for op_group in ["core", "outlet"]:
                    key = (brand, item_tab, month, "HQ_OR", op_group)
                    amount = inv_agg_dict.get(key, 0.0)
                    amount_won = round(amount)  # 원 단위로 저장
                    month_data[f"HQ_OR_{op_group}"] = amount_won
                
                # OR 판매매출 (직영재고 계산용) - 원 단위로 저장
                for op_group in ["core", "outlet"]:
                    key = (brand, item_tab, month, "OR", op_group)
                    amount = sales_agg_dict.get(key, 0.0)
                    month_data[f"OR_sales_{op_group}"] = amount  # 원 단위 저장
                
                result["brands"][brand][item_tab][month] = month_data
    
    return result


def main():
    """메인 실행 함수"""
    print("=" * 60)
    print("악세사리 판매매출 및 재고자산 데이터 전처리 시작")
    print("=" * 60)
    print(f"판매 데이터 경로: {RETAIL_DATA_PATH}")
    print(f"재고 데이터 경로: {INVENTORY_DATA_PATH}")
    print(f"출력 경로: {OUTPUT_PATH}")
    print(f"청크 크기: {CHUNK_SIZE:,}")
    print()
    
    # 출력 폴더 생성
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 판매 데이터 처리
    print("=" * 40)
    print("판매(retail) 데이터 처리 중...")
    print("=" * 40)
    sales_agg_dict, sales_unexpected = process_retail_data()
    
    if sales_unexpected:
        print()
        print("[WARNING] 판매 데이터 - 제품중분류에 예상치 못한 값:")
        for cat in sorted(sales_unexpected):
            print(f"   - {cat}")
    
    # 재고 데이터 처리
    print()
    print("=" * 40)
    print("재고(inventory) 데이터 처리 중...")
    print("=" * 40)
    inv_agg_dict, inv_unexpected = process_inventory_data()
    
    if inv_unexpected:
        print()
        print("[WARNING] 재고 데이터 - 제품중분류에 예상치 못한 값:")
        for cat in sorted(inv_unexpected):
            print(f"   - {cat}")
    
    # JSON 변환 및 저장 - 판매
    print()
    print("판매 데이터 JSON 변환 중...")
    sales_json = convert_sales_to_json_structure(sales_agg_dict, sales_unexpected)
    
    sales_output_file = OUTPUT_PATH / "accessory_sales_summary.json"
    with open(sales_output_file, 'w', encoding='utf-8') as f:
        json.dump(sales_json, f, ensure_ascii=False, indent=2)
    print(f"[DONE] 판매 JSON 저장: {sales_output_file}")
    
    # JSON 변환 및 저장 - 재고
    print()
    print("재고 데이터 JSON 변환 중...")
    inv_json = convert_inventory_to_json_structure(inv_agg_dict, sales_agg_dict, inv_unexpected)
    
    inv_output_file = OUTPUT_PATH / "accessory_inventory_summary.json"
    with open(inv_output_file, 'w', encoding='utf-8') as f:
        json.dump(inv_json, f, ensure_ascii=False, indent=2)
    print(f"[DONE] 재고 JSON 저장: {inv_output_file}")
    
    # 통계 출력
    print()
    print("=" * 60)
    print("처리 완료 요약")
    print("=" * 60)
    print(f"처리된 월 수: {len(ANALYSIS_MONTHS)}")
    print(f"판매 집계 키 수: {len(sales_agg_dict):,}")
    print(f"재고 집계 키 수: {len(inv_agg_dict):,}")
    if sales_unexpected:
        print(f"판매 예상치 못한 중분류 수: {len(sales_unexpected)}")
    if inv_unexpected:
        print(f"재고 예상치 못한 중분류 수: {len(inv_unexpected)}")
    print()


if __name__ == "__main__":
    main()
