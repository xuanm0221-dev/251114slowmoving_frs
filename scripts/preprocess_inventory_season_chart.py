"""
재고 시즌 차트 데이터 전처리 스크립트
- Snowflake에서 재고 시즌 차트 데이터 조회 (24개월)
- 브랜드별, 월별로 데이터 저장
- public/data/inventory_season_chart_summary.json 생성
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

DIMENSION_TABS = ["컬러&사이즈"]  # 차트에서는 컬러&사이즈만 사용

# 단위 탭별 KEY 컬럼 매핑
DIMENSION_KEY_MAP = {
    "컬러&사이즈": {
        "salesKey": "s.prdt_scs_cd",
        "stockKey": "a.prdt_scs_cd",
    },
}


def get_year_config(reference_month: str) -> Dict[str, str]:
    """기준월 기준으로 당해/차기 연도 계산"""
    month_str = reference_month.replace(".", "")
    year = int(month_str[:4])
    return {
        "currentYear": str(year)[-2:],
        "nextYear": str(year + 1)[-2:],
    }


def get_month_before_yyyymm(reference_month: str, months_before: int) -> str:
    """기준월(YYYY.MM 또는 YYYYMM)에서 N개월 이전 월을 YYYYMM으로 반환"""
    normalized = reference_month.replace(".", "")
    y = int(normalized[:4])
    m = int(normalized[4:6])
    target_year = y
    target_month = m - months_before
    while target_month <= 0:
        target_month += 12
        target_year -= 1
    return f"{target_year}{str(target_month).zfill(2)}"


def get_twelve_months_ending_at(reference_month: str) -> List[str]:
    """기준월 포함 최근 12개월 YYYYMM 배열 (기준월-11 ~ 기준월)"""
    months = []
    for i in range(11, -1, -1):
        months.append(get_month_before_yyyymm(reference_month, i))
    return months


def build_monthly_stock_query(
    brand: str,
    year_prefix: str,
    threshold_ratio: float,
    current_year: str,
    next_year: str,
    dimension_tab: str = "컬러&사이즈",
    item_filter: str = "ACC합계",
    min_qty: int = 10,
    current_month_min_qty: int = 10,
    start_month: Optional[str] = None,
    end_month: Optional[str] = None
) -> str:
    """재고 쿼리 (월별, 시즌별 집계)"""
    yymm_condition = (
        f"a.yymm >= '{start_month}' AND a.yymm <= '{end_month}'"
        if start_month and end_month
        else f"a.yymm >= '{year_prefix}01' AND a.yymm <= '{year_prefix}12'"
    )
    sales_yymm_condition = (
        f"TO_CHAR(s.sale_dt, 'YYYYMM') >= '{start_month}' AND TO_CHAR(s.sale_dt, 'YYYYMM') <= '{end_month}'"
        if start_month and end_month
        else f"TO_CHAR(s.sale_dt, 'YYYYMM') >= '{year_prefix}01' AND TO_CHAR(s.sale_dt, 'YYYYMM') <= '{year_prefix}12'"
    )
    
    # 전월 재고 수량은 "조회 구간의 전월"까지 포함
    if start_month and end_month:
        prev_start = get_month_before_yyyymm(start_month, 1)
        prev_end = get_month_before_yyyymm(end_month, 1)
        prev_yymm_condition = f"a.yymm >= '{prev_start}' AND a.yymm <= '{prev_end}'"
    else:
        prev_yymm_condition = f"a.yymm >= '{year_prefix}01' AND a.yymm <= '{year_prefix}12'"
    
    year_short = year_prefix[-2:]
    next_year_short = str(int(year_short) + 1).zfill(2)
    
    dim_config = DIMENSION_KEY_MAP[dimension_tab]
    
    item_filter_condition = "" if item_filter == "ACC합계" else f" AND mid_category_kr = '{item_filter}'"
    
    return f"""
    WITH 
    acc_item_map AS (
      SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
      FROM FNF.PRCS.DB_PRDT
      WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
    ),
    -- 월별 스타일 기준 당월수량 집계 (당월수량미달 판단용)
    style_monthly_qty AS (
      SELECT 
        a.yymm AS month,
        a.prdt_cd AS style,
        SUM(a.stock_qty_expected) AS current_stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
      WHERE {yymm_condition}
        AND a.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
      GROUP BY a.yymm, a.prdt_cd
    ),
    
    -- 월별 재고 데이터 (dimension 기준)
    stock_monthly AS (
      SELECT 
        a.yymm AS month,
        {dim_config['stockKey']} AS dimension_key,
        a.prdt_cd AS style,
        MAX(a.sesn) AS season,
        MAX(CASE
          WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
          WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
          WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
          WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
          ELSE db.PRDT_KIND_NM_ENG
        END) AS mid_category_kr,
        SUM(COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0)) AS stock_amt
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
      WHERE {yymm_condition}
        AND a.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
      GROUP BY a.yymm, {dim_config['stockKey']}, a.prdt_cd
    ),
    
    -- 월별 판매 데이터 (dimension 기준)
    sales_monthly AS (
      SELECT 
        TO_CHAR(s.sale_dt, 'YYYYMM') AS month,
        {dim_config['salesKey']} AS dimension_key,
        MAX(SUBSTR(s.prdt_cd, 2, 3)) AS season,
        MAX(CASE
          WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
          WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
          WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
          WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
          ELSE db.PRDT_KIND_NM_ENG
        END) AS mid_category_kr,
        SUM(s.tag_amt) AS sales_amt
      FROM fnf.chn.dw_sale s
      LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
      LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
      WHERE {sales_yymm_condition}
        AND s.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
        AND d.fr_or_cls IN ('FR', 'OR')
      GROUP BY TO_CHAR(s.sale_dt, 'YYYYMM'), {dim_config['salesKey']}
    ),
    
    -- 월별 중분류별 재고 합계 (정체재고 판단 분모)
    mid_category_totals AS (
      SELECT 
        month,
        mid_category_kr,
        SUM(stock_amt) AS stock_amt_total_mid
      FROM stock_monthly
      WHERE mid_category_kr IN ('신발', '모자', '가방', '기타')
      GROUP BY month, mid_category_kr
    ),
    
    -- 전월 재고 수량 집계 (정체재고 판단용, 조회 구간의 전월 포함)
    prev_month_stock AS (
      SELECT
        a.yymm AS month,
        {dim_config['stockKey']} AS dimension_key,
        SUM(a.stock_qty_expected) AS prev_stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
      WHERE {prev_yymm_condition}
        AND a.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
      GROUP BY a.yymm, {dim_config['stockKey']}
    ),
    
    -- 재고+판매 조인하여 정체 여부 판단 (dimension 기준)
    combined AS (
      SELECT 
        st.month,
        st.dimension_key,
        st.style,
        st.season,
        st.mid_category_kr,
        st.stock_amt,
        COALESCE(sa.sales_amt, 0) AS sales_amt,
        mt.stock_amt_total_mid,
        -- 전월 수량 조회 (현재월 - 1)
        COALESCE(pms.prev_stock_qty, 0) AS prev_stock_qty,
        -- 스타일 기준 당월수량
        COALESCE(smq.current_stock_qty, 0) AS style_current_qty
      FROM stock_monthly st
      LEFT JOIN sales_monthly sa 
        ON st.month = sa.month AND st.dimension_key = sa.dimension_key
      LEFT JOIN mid_category_totals mt 
        ON st.month = mt.month AND st.mid_category_kr = mt.mid_category_kr
      LEFT JOIN prev_month_stock pms
        ON CASE 
            WHEN SUBSTR(st.month, 5, 2) = '01' THEN CAST(CAST(SUBSTR(st.month, 1, 4) AS INT) - 1 AS VARCHAR) || '12'
            ELSE SUBSTR(st.month, 1, 4) || LPAD(CAST(CAST(SUBSTR(st.month, 5, 2) AS INT) - 1 AS VARCHAR), 2, '0')
           END = pms.month 
        AND st.dimension_key = pms.dimension_key
      LEFT JOIN style_monthly_qty smq
        ON st.month = smq.month AND st.style = smq.style
      WHERE st.stock_amt > 0
        AND st.mid_category_kr IN ('신발', '모자', '가방', '기타')
    ),
    
    -- 3월 기준 당시즌 연도(YY): 기준월 3~12월이면 해당연도, 1~2월이면 전년
    with_season_base AS (
      SELECT 
        month,
        dimension_key,
        season,
        mid_category_kr,
        stock_amt,
        sales_amt,
        stock_amt_total_mid,
        prev_stock_qty,
        style_current_qty,
        CASE WHEN CAST(SUBSTR(month, 5, 2) AS INT) >= 3 THEN SUBSTR(month, 3, 2)
             ELSE SUBSTR(LPAD(CAST(CAST(SUBSTR(month, 1, 4) AS INT) - 1 AS VARCHAR), 4, '0'), 3, 2) END AS current_season_year
      FROM combined
    ),
    
    -- 시즌 그룹 분류 (3월 기준: 당시즌=YY*, 차기시즌=(YY+1)*, 과시즌=<YY*)
    with_season_group AS (
      SELECT 
        month,
        dimension_key,
        season,
        mid_category_kr,
        stock_amt,
        sales_amt,
        stock_amt_total_mid,
        prev_stock_qty,
        style_current_qty,
        CASE 
          WHEN style_current_qty < {current_month_min_qty} THEN '당월수량미달'
          WHEN SUBSTR(season, 1, 2) = current_season_year THEN '당시즌'
          WHEN SUBSTR(season, 1, 2) = LPAD(CAST(current_season_year AS INT) + 1, 2, '0') THEN '차기시즌'
          WHEN TRY_CAST(SUBSTR(season, 1, 2) AS INT) < CAST(current_season_year AS INT) THEN
            CASE WHEN prev_stock_qty < {min_qty} THEN '과시즌'
                 WHEN stock_amt_total_mid > 0 AND (sales_amt / stock_amt_total_mid) < {threshold_ratio} THEN '정체재고'
                 ELSE '과시즌' END
          ELSE '과시즌'
        END AS season_group
      FROM with_season_base
    )
    
    -- 월별, 시즌그룹별 집계
    SELECT 
      month,
      season_group,
      SUM(stock_amt) AS stock_amt,
      SUM(sales_amt) AS sales_amt
    FROM with_season_group
    WHERE 1=1{item_filter_condition}
    GROUP BY month, season_group
    ORDER BY month, season_group
    """


def transform_results_by_months(rows: List[Dict], expected_months: List[str]) -> List[Dict]:
    """지정한 YYYYMM 목록 순서로 MonthSeasonData 배열 생성"""
    month_map = {}
    
    for ym in expected_months:
        month_map[ym] = {
            "month": ym,
            "정체재고": {"stock_amt": 0, "sales_amt": 0},
            "과시즌": {"stock_amt": 0, "sales_amt": 0},
            "당시즌": {"stock_amt": 0, "sales_amt": 0},
            "차기시즌": {"stock_amt": 0, "sales_amt": 0},
            "당월수량미달": {"stock_amt": 0, "sales_amt": 0},
            "total_stock_amt": 0,
            "total_sales_amt": 0,
        }
    
    for row in rows:
        raw = str(row.get("MONTH", "")).strip()
        # Snowflake가 숫자/float로 주면 "202602.0" 등이 되므로 6자리 YYYYMM으로 정규화
        if "." in raw:
            month_full = raw.split(".")[0]
        else:
            month_full = raw
        if len(month_full) < 6:
            continue
        month_full = month_full[:6]
        data = month_map.get(month_full)
        season_group = row.get("SEASON_GROUP", "")
        stock_amt = float(row.get("STOCK_AMT", 0) or 0)
        sales_amt = float(row.get("SALES_AMT", 0) or 0)
        
        if data and season_group and season_group in data:
            data[season_group]["stock_amt"] += stock_amt
            data[season_group]["sales_amt"] += sales_amt
            data["total_stock_amt"] += stock_amt
            data["total_sales_amt"] += sales_amt
    
    return [month_map[ym] for ym in expected_months if ym in month_map]


def fetch_inventory_season_chart_data(
    brand: str,
    reference_month: str,
    threshold_pct: float = 0.01,
    dimension_tab: str = "컬러&사이즈",
    item_filter: str = "ACC합계",
    min_qty: int = 10,
    current_month_min_qty: int = 10,
    months_to_fetch: Optional[List[str]] = None
) -> Dict[str, Any]:
    """재고 시즌 차트 데이터 조회
    
    Args:
        months_to_fetch: 조회할 월 목록 (YYYYMM 형식). None이면 기준월 기준 24개월 모두 조회
    """
    threshold_ratio = threshold_pct / 100
    year_config = get_year_config(reference_month)
    current_year = year_config["currentYear"]
    next_year = year_config["nextYear"]
    
    if months_to_fetch is None:
        # 기준월 포함 최근 12개월
        current_months = get_twelve_months_ending_at(reference_month)
        
        # 전년 12개월
        prev_months = []
        for i in range(23, 11, -1):
            prev_months.append(get_month_before_yyyymm(reference_month, i))
        
        all_months = prev_months + current_months
    else:
        # 지정된 월만 조회
        all_months = months_to_fetch
        # current_months와 prev_months는 year2024/year2025 분류를 위해 계산
        current_months = get_twelve_months_ending_at(reference_month)
        prev_months = []
        for i in range(23, 11, -1):
            prev_months.append(get_month_before_yyyymm(reference_month, i))
    
    # 조회할 월들을 current_months와 prev_months로 분류
    if months_to_fetch is not None:
        # months_to_fetch가 제공되면, 해당 월들을 current/prev로 분류
        fetch_current_months = [m for m in months_to_fetch if m in current_months]
        fetch_prev_months = [m for m in months_to_fetch if m in prev_months]
    else:
        fetch_current_months = current_months
        fetch_prev_months = prev_months
    
    # 당년 월들: 연도별로 쿼리 후 병합
    year_ranges_current = {}
    for ym in fetch_current_months:
        y = ym[:4]
        if y not in year_ranges_current:
            year_ranges_current[y] = {"start": ym, "end": ym}
        else:
            if ym < year_ranges_current[y]["start"]:
                year_ranges_current[y]["start"] = ym
            if ym > year_ranges_current[y]["end"]:
                year_ranges_current[y]["end"] = ym
    
    all_rows_current = []
    for year_prefix, range_info in year_ranges_current.items():
        query = build_monthly_stock_query(
            brand, year_prefix, threshold_ratio, current_year, next_year,
            dimension_tab, item_filter, min_qty, current_month_min_qty,
            range_info["start"], range_info["end"]
        )
        rows = execute_query(query)
        all_rows_current.extend(rows)
    
    data2025 = transform_results_by_months(all_rows_current, fetch_current_months)
    
    # 전년 월들: 연도별로 쿼리 후 병합
    year_ranges_prev = {}
    for ym in fetch_prev_months:
        y = ym[:4]
        if y not in year_ranges_prev:
            year_ranges_prev[y] = {"start": ym, "end": ym}
        else:
            if ym < year_ranges_prev[y]["start"]:
                year_ranges_prev[y]["start"] = ym
            if ym > year_ranges_prev[y]["end"]:
                year_ranges_prev[y]["end"] = ym
    
    all_rows_prev = []
    for year_prefix, range_info in year_ranges_prev.items():
        prev_y = year_prefix[-2:]
        prev_next = str(int(prev_y) + 1).zfill(2)
        query = build_monthly_stock_query(
            brand, year_prefix, threshold_ratio, prev_y, prev_next,
            dimension_tab, item_filter, min_qty, current_month_min_qty,
            range_info["start"], range_info["end"]
        )
        rows = execute_query(query)
        all_rows_prev.extend(rows)
    
    data2024 = transform_results_by_months(all_rows_prev, fetch_prev_months)
    
    # 응답 생성
    response = {
        "year2024": data2024,
        "year2025": data2025,
        "meta": {
            "brand": brand,
            "thresholdPct": threshold_pct,
            "currentYear": current_year,
            "nextYear": next_year,
            "currentMonthMinQty": current_month_min_qty,
        },
    }
    
    return response


def main(reference_month: str = None):
    """
    메인 실행 함수
    
    Args:
        reference_month: 기준월 (예: "2025.11"). None이면 전체 처리
    """
    print("=" * 60)
    print("재고 시즌 차트 데이터 전처리 시작")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 기준월 모드 확인
    if reference_month:
        print(f"\n[재고 시즌 차트] 기준월 모드: {reference_month}만 처리합니다.")
        months_to_process = [reference_month]
    else:
        print("\n[재고 시즌 차트] 전체 처리 모드: 모든 브랜드와 월을 처리합니다.")
        months_to_process = None
    
    # 기존 JSON 파일 로드
    output_file = OUTPUT_PATH / "inventory_season_chart_summary.json"
    existing_data = {"brands": {}}
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[재고 시즌 차트] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
    
    # 각 브랜드별로 처리
    for brand_name in VALID_BRANDS:
        brand_code = BRAND_CODE_MAP[brand_name]
        print(f"\n[재고 시즌 차트] 브랜드: {brand_name} ({brand_code})")
        
        # API가 brand 쿼리로 M, I, X를 사용하므로 JSON 키는 brand_code 사용
        if brand_code not in existing_data["brands"]:
            existing_data["brands"][brand_code] = {}
        
        if months_to_process:
            # 기준월 모드: 지정된 월만 처리
            for reference_month_str in months_to_process:
                try:
                    print(f"  처리 중: {reference_month_str}...")
                    
                    # 기준월 기준으로 24개월 목록 생성
                    current_months = get_twelve_months_ending_at(reference_month_str)
                    prev_months = [get_month_before_yyyymm(reference_month_str, i) for i in range(23, 11, -1)]
                    all_24_months = prev_months + current_months
                    
                    # 기존 JSON에서 브랜드별로 이미 존재하는 월 확인 (brand_code 키 사용)
                    existing_months = set()
                    if brand_code in existing_data.get("brands", {}):
                        existing_months = set(existing_data["brands"][brand_code].keys())
                    
                    # 누락된 월만 필터링
                    missing_months = [m for m in all_24_months if m not in existing_months]
                    
                    if not missing_months:
                        print(f"  [SKIP] 모든 월이 이미 전처리되어 있습니다. (24개월)")
                        continue
                    
                    print(f"  [INFO] 누락된 월 {len(missing_months)}개 조회: {', '.join(missing_months[:5])}{'...' if len(missing_months) > 5 else ''}")
                    
                    # 누락된 월만 조회
                    response = fetch_inventory_season_chart_data(
                        brand_code,
                        reference_month_str,
                        threshold_pct=0.01,
                        dimension_tab="컬러&사이즈",
                        item_filter="ACC합계",
                        min_qty=10,
                        current_month_min_qty=10,
                        months_to_fetch=missing_months
                    )
                    
                    # 조회한 데이터를 월별로 저장 (누락된 월만, brand_code 키로 저장)
                    for month_data in response["year2024"] + response["year2025"]:
                        month = month_data["month"]
                        if month in missing_months:  # 누락된 월만 저장
                            existing_data["brands"][brand_code][month] = month_data
                    
                    print(f"  완료: {reference_month_str} (누락된 {len(missing_months)}개월 조회 및 저장)")
                except Exception as e:
                    print(f"  [ERROR] {reference_month_str} 처리 실패: {e}")
                    import traceback
                    traceback.print_exc()
        else:
            # 전체 처리 모드: 기준월 목록 생성 (예: 2024.01 ~ 2026.01)
            # 여기서는 간단히 처리하지 않고, 사용자가 기준월을 지정하도록 함
            print("  [INFO] 전체 처리 모드는 기준월을 지정하여 실행하세요.")
            print("  예: python preprocess_inventory_season_chart.py --reference-month 2025.11")
    
    # JSON 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 60)
    print("전처리 완료")
    print("=" * 60)
    print(f"[DONE] 저장 완료: {output_file}")


if __name__ == "__main__":
    import sys
    
    # 기준월 모드: python preprocess_inventory_season_chart.py --reference-month 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_inventory_season_chart.py --reference-month 2025.11")
    else:
        main()
