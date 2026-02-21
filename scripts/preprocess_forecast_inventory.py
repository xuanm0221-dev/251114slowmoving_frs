"""
입고예정 재고자산 데이터 전처리 스크립트
- CSV 파일을 읽어서 JSON으로 변환
- public/data/accessory_forecast_inventory_summary.json 생성
"""

import pandas as pd
import json
from pathlib import Path
from typing import Dict, Set

# ========== 설정 ==========
FORECAST_DATA_PATH = Path(r"D:\data\inventory(forecast)")
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data"

# 처리할 월 목록 (파일명 형식: "25.12.csv")
FORECAST_MONTH_FILES = ["25.12", "26.01", "26.02", "26.03"]

VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}
VALID_ITEM_CATEGORIES = {"Shoes", "Headwear", "Bag", "Acc_etc"}

# CSV 컬럼 이름
COL_BRAND = "产品品牌"
COL_ITEM = "产品中分类"
COL_AMOUNT = "预计库存入库"


def to_full_year_month(short_ym: str) -> str:
    """월 문자열 변환: "25.11" -> "2025.11" """
    yy, mm = short_ym.split(".")
    year_num = int(yy)
    full_year = 2000 + year_num if 0 <= year_num < 50 else 1900 + year_num
    return f"{full_year}.{mm}"


def process_forecast_data(months_to_process: list = None) -> Dict:
    """
    입고예정 CSV 파일들을 읽어서 집계
    
    Args:
        months_to_process: 처리할 월 목록 (예: ["2025.11"]). None이면 FORECAST_MONTH_FILES 전체 처리
    """
    brands: Dict = {
        "MLB": {},
        "MLB KIDS": {},
        "DISCOVERY": {},
    }
    month_set = set()

    # 처리할 월 목록 결정
    if months_to_process:
        # 기준월 모드: "2025.11" 형식의 월을 "25.11" 형식으로 변환
        files_to_process = []
        for month in months_to_process:
            # "2025.11" -> "25.11"
            year, month_num = month.split(".")
            short_year = year[-2:]
            files_to_process.append(f"{short_year}.{month_num}")
    else:
        files_to_process = FORECAST_MONTH_FILES

    for short_ym in files_to_process:
        file_path = FORECAST_DATA_PATH / f"{short_ym}.csv"
        
        if not file_path.exists():
            print(f"[WARNING] 파일 없음: {file_path}")
            continue

        print(f"처리 중: {file_path}")
        
        try:
            # CSV 읽기 (BOM 처리 포함)
            df = pd.read_csv(
                file_path,
                encoding='utf-8-sig',
                dtype={
                    COL_BRAND: str,
                    COL_ITEM: str,
                    COL_AMOUNT: str,  # 쉼표 제거를 위해 문자열로 읽기
                }
            )

            # 브랜드 필터
            df = df[df[COL_BRAND].isin(VALID_BRANDS)]
            if df.empty:
                continue

            # 아이템 필터
            df = df[df[COL_ITEM].isin(VALID_ITEM_CATEGORIES)]
            if df.empty:
                continue

            # 금액 파싱 (쉼표 제거)
            df[COL_AMOUNT] = df[COL_AMOUNT].astype(str).str.replace(",", "").astype(float)

            full_ym = to_full_year_month(short_ym)
            month_set.add(full_ym)

            # 브랜드별 집계
            for _, row in df.iterrows():
                brand_name = str(row[COL_BRAND]).strip()
                item = str(row[COL_ITEM]).strip()
                amount = float(row[COL_AMOUNT]) if pd.notna(row[COL_AMOUNT]) else 0.0

                if brand_name not in VALID_BRANDS or item not in VALID_ITEM_CATEGORIES:
                    continue

                brand_data = brands[brand_name]
                if full_ym not in brand_data:
                    brand_data[full_ym] = {}

                month_data = brand_data[full_ym]
                month_data[item] = month_data.get(item, 0) + amount

        except Exception as e:
            print(f"[ERROR] {file_path}: {e}")
            continue

    # 월 목록 정렬
    months = sorted(list(month_set), key=lambda m: (int(m.split(".")[0]), int(m.split(".")[1])))

    return {
        "brands": brands,
        "months": months,
    }


def main(reference_month: str = None):
    """
    메인 실행 함수
    
    Args:
        reference_month: 기준월 (예: "2025.11"). None이면 FORECAST_MONTH_FILES 전체 처리
    """
    print("=" * 60)
    print("입고예정 재고자산 데이터 전처리 시작")
    print("=" * 60)

    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)

    print(f"\n입고예정 데이터 경로: {FORECAST_DATA_PATH}")
    print(f"출력 경로: {OUTPUT_PATH}")

    # 기준월 모드 확인
    if reference_month:
        print(f"\n[입고예정] 기준월 모드: {reference_month}만 처리합니다.")
        months_to_process = [reference_month]
    else:
        print(f"\n[입고예정] 전체 처리 모드: {FORECAST_MONTH_FILES}")
        months_to_process = None

    # 기존 JSON 파일 로드 (병합을 위해)
    output_file = OUTPUT_PATH / "accessory_forecast_inventory_summary.json"
    existing_data = None
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[입고예정] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")

    print("\n입고예정 데이터 처리 중...")
    result = process_forecast_data(months_to_process)

    # 기존 데이터와 병합
    if existing_data:
        print("기존 데이터와 병합 중...")
        # 기존 월 데이터 유지 (새로 처리한 월만 덮어쓰기)
        for brand in existing_data.get("brands", {}):
            if brand not in result["brands"]:
                result["brands"][brand] = {}
            for month in existing_data["brands"][brand]:
                if not months_to_process or month not in months_to_process:
                    result["brands"][brand][month] = existing_data["brands"][brand][month]
        
        # months 목록도 병합
        existing_months = set(existing_data.get("months", []))
        current_months = set(result.get("months", []))
        result["months"] = sorted(list(existing_months | current_months))
        print("[완료] 기존 데이터 병합 완료")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] 저장 완료: {output_file}")
    print(f"처리된 월 수: {len(result['months'])}")
    for month in result['months']:
        print(f"  - {month}")


if __name__ == "__main__":
    import sys
    
    # 기준월 모드: python preprocess_forecast_inventory.py --reference-month 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_forecast_inventory.py --reference-month 2025.11")
    else:
        main()

