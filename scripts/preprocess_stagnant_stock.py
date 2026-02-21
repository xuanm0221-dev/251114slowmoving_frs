"""
정체재고 데이터 전처리 스크립트
- Snowflake에서 정체재고 데이터 조회
- 브랜드별, 기준월별, dimensionTab별로 데이터 저장
- public/data/stagnant_stock_summary.json 생성
"""

import json
import calendar
from pathlib import Path
from typing import Dict, List, Any, Set, Optional
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

DIMENSION_TABS = ["스타일", "컬러", "사이즈", "컬러&사이즈"]

# 단위 탭별 KEY 컬럼 매핑
DIMENSION_KEY_MAP = {
    "스타일": {
        "salesKey": "s.prdt_cd",
        "stockKey": "a.prdt_cd",
    },
    "컬러": {
        "salesKey": "s.prdt_cd || '_' || s.color_cd",
        "stockKey": "a.prdt_cd || '_' || a.color_cd",
    },
    "사이즈": {
        "salesKey": "s.prdt_cd || '_' || s.size_cd",
        "stockKey": "a.prdt_cd || '_' || a.size_cd",
    },
    "컬러&사이즈": {
        "salesKey": "s.prdt_scs_cd",
        "stockKey": "a.prdt_scs_cd",
    },
}


def get_year_config(target_month: str) -> Dict[str, str]:
    """3월 기준 당시즌/차기시즌 연도(2자리) 계산"""
    year = int(target_month[:4])
    month = int(target_month[4:6])
    current_season_year = year if month >= 3 else year - 1
    current_year = str(current_season_year)[-2:].zfill(2)
    next_year = str(current_season_year + 1)[-2:].zfill(2)
    return {"currentYear": current_year, "nextYear": next_year}


def get_prev_month(target_month: str) -> str:
    """전월 계산 함수 (YYYYMM 형식)"""
    year = int(target_month[:4])
    month = int(target_month[4:6])
    
    if month == 1:
        return f"{year - 1}12"
    return f"{year}{str(month - 1).zfill(2)}"


def get_days_in_month(yyyymm: str) -> int:
    """월의 일수 계산"""
    if len(yyyymm) != 6:
        return 30
    year = int(yyyymm[:4])
    month = int(yyyymm[4:6])
    return calendar.monthrange(year, month)[1]


def get_season_group(
    season: str,
    ratio: float,
    threshold_ratio: float,
    current_year: str,
    next_year: str,
    prev_month_stock_qty: int,
    min_qty: int,
    ignore_min_qty: bool = False
) -> str:
    """시즌 그룹 결정"""
    # 1. 먼저 시즌 구분
    if season and season.startswith(current_year):
        return "당시즌"
    if season and season.startswith(next_year):
        return "차기시즌"
    
    # 2. 과시즌인 경우: 정체재고 판단
    if not ignore_min_qty and prev_month_stock_qty < min_qty:
        return "과시즌"
    
    # (2) 비율로 정체재고 판단
    if ratio < threshold_ratio:
        return "정체재고"
    return "과시즌"


def build_available_months_query(brand: str) -> str:
    """사용 가능한 월 목록 조회 쿼리"""
    return f"""
    WITH acc_item_map AS (
      SELECT DISTINCT ITEM
      FROM FNF.PRCS.DB_PRDT
      WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
    )
    SELECT DISTINCT TO_CHAR(sale_dt, 'YYYYMM') AS sale_ym
    FROM fnf.chn.dw_sale s
    LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
    WHERE s.brd_cd = '{brand}'
      AND db.ITEM IS NOT NULL
      AND sale_dt >= '2024-01-01'
    ORDER BY sale_ym DESC
    """


def build_style_stock_qty_query(brand: str, target_month: str) -> str:
    """스타일 기준 당월수량 조회 쿼리"""
    return f"""
    WITH acc_item_map AS (
      SELECT DISTINCT ITEM
      FROM FNF.PRCS.DB_PRDT
      WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
    )
    SELECT 
      a.prdt_cd AS style,
      SUM(a.stock_qty_expected) AS current_stock_qty
    FROM fnf.chn.dw_stock_m a
    LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
    WHERE a.yymm = '{target_month}'
      AND a.brd_cd = '{brand}'
      AND db.ITEM IS NOT NULL
    GROUP BY a.prdt_cd
    """


def build_stagnant_stock_query(
    brand: str,
    target_month: str,
    dimension_tab: str,
    threshold_ratio: float,
    prev_month: str
) -> str:
    """정체재고 분석 메인 쿼리 생성"""
    dim_config = DIMENSION_KEY_MAP[dimension_tab]
    
    return f"""
    WITH 
    acc_item_map AS (
      SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
      FROM FNF.PRCS.DB_PRDT
      WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
    ),
    -- 전월 재고 수량 집계 (정체재고 판단용)
    prev_month_stock AS (
      SELECT 
        {dim_config['stockKey']} AS dimension_key,
        SUM(a.stock_qty_expected) AS prev_stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
      WHERE a.yymm = '{prev_month}'
        AND a.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
      GROUP BY {dim_config['stockKey']}
    ),
    
    -- 채널별 판매 데이터 집계
    sales_by_channel AS (
      SELECT 
        {dim_config['salesKey']} AS dimension_key,
        d.fr_or_cls AS channel,
        MAX(s.prdt_cd) AS prdt_cd,
        MAX(s.color_cd) AS color_cd,
        MAX(s.size_cd) AS size_cd,
        MAX(p.prdt_nm) AS prdt_nm,
        MAX(SUBSTR(s.prdt_cd, 2, 3)) AS season,
        MAX(CASE
          WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
          WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
          WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
          WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
          ELSE db.PRDT_KIND_NM_ENG
        END) AS mid_category_kr,
        SUM(s.tag_amt) AS sales_tag_amt,
        SUM(s.qty) AS sales_qty
      FROM fnf.chn.dw_sale s
      LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
      LEFT JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
      LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
      WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '{target_month}'
        AND s.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
        AND d.fr_or_cls IN ('FR', 'OR', 'HQ')
      GROUP BY {dim_config['salesKey']}, d.fr_or_cls
    ),
    
    -- 전체 기준 판매 집계 (정체/정상 판단용)
    sales_agg AS (
      SELECT 
        dimension_key,
        MAX(prdt_cd) AS prdt_cd,
        MAX(color_cd) AS color_cd,
        MAX(size_cd) AS size_cd,
        MAX(prdt_nm) AS prdt_nm,
        MAX(season) AS season,
        MAX(mid_category_kr) AS mid_category_kr,
        SUM(sales_tag_amt) AS sales_tag_amt,
        SUM(sales_qty) AS sales_qty
      FROM sales_by_channel
      GROUP BY dimension_key
    ),
    
    -- 채널별 재고 데이터 집계
    stock_by_channel AS (
      SELECT 
        {dim_config['stockKey']} AS dimension_key,
        COALESCE(c.fr_or_cls, 'HQ') AS channel,
        MAX(a.prdt_cd) AS prdt_cd,
        MAX(a.color_cd) AS color_cd,
        MAX(a.size_cd) AS size_cd,
        MAX(b.prdt_nm) AS prdt_nm,
        MAX(a.sesn) AS season,
        MAX(CASE
          WHEN db.PRDT_KIND_NM_ENG = 'Shoes' THEN '신발'
          WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
          WHEN db.PRDT_KIND_NM_ENG = 'Bag' THEN '가방'
          WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc' THEN '기타'
          ELSE db.PRDT_KIND_NM_ENG
        END) AS mid_category_kr,
        SUM(COALESCE(a.stock_tag_amt_insp, 0) + COALESCE(a.stock_tag_amt_frozen, 0) + COALESCE(a.stock_tag_amt_expected, 0)) AS stock_amt,
        SUM(a.stock_qty_expected) AS stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      LEFT JOIN acc_item_map db ON SUBSTR(a.prdt_scs_cd, 7, 2) = db.ITEM
      LEFT JOIN fnf.chn.dw_shop_wh_detail c ON a.shop_id = c.oa_map_shop_id
      WHERE a.yymm = '{target_month}'
        AND a.brd_cd = '{brand}'
        AND db.ITEM IS NOT NULL
        AND COALESCE(c.fr_or_cls, 'HQ') IN ('FR', 'OR', 'HQ')
      GROUP BY {dim_config['stockKey']}, COALESCE(c.fr_or_cls, 'HQ')
    ),
    
    -- 전체 기준 재고 집계 (정체/정상 판단용)
    stock_agg AS (
      SELECT 
        dimension_key,
        MAX(prdt_cd) AS prdt_cd,
        MAX(color_cd) AS color_cd,
        MAX(size_cd) AS size_cd,
        MAX(prdt_nm) AS prdt_nm,
        MAX(season) AS season,
        MAX(mid_category_kr) AS mid_category_kr,
        SUM(stock_amt) AS stock_amt,
        SUM(stock_qty) AS stock_qty
      FROM stock_by_channel
      GROUP BY dimension_key
    ),
    
    -- 중분류별 재고금액 합계 (비율 계산용)
    mid_category_stock AS (
      SELECT 
        mid_category_kr,
        SUM(stock_amt) AS total_stock_amt
      FROM stock_agg
      GROUP BY mid_category_kr
    ),
    
    -- 판매/재고 조인 및 비율 계산
    with_ratio AS (
      SELECT 
        COALESCE(sa.dimension_key, st.dimension_key) AS dimension_key,
        COALESCE(sa.prdt_cd, st.prdt_cd) AS prdt_cd,
        COALESCE(sa.color_cd, st.color_cd) AS color_cd,
        COALESCE(sa.size_cd, st.size_cd) AS size_cd,
        COALESCE(sa.prdt_nm, st.prdt_nm) AS prdt_nm,
        COALESCE(sa.season, st.season) AS season,
        COALESCE(sa.mid_category_kr, st.mid_category_kr) AS mid_category_kr,
        COALESCE(st.stock_qty, 0) AS stock_qty,
        COALESCE(st.stock_amt, 0) AS stock_amt,
        COALESCE(sa.sales_tag_amt, 0) AS sales_tag_amt,
        COALESCE(mcs.total_stock_amt, 0) AS stock_amt_total_mid,
        CASE 
          WHEN COALESCE(mcs.total_stock_amt, 0) > 0 
          THEN COALESCE(sa.sales_tag_amt, 0) / mcs.total_stock_amt
          ELSE 0
        END AS ratio,
        COALESCE(pms.prev_stock_qty, 0) AS prev_stock_qty
      FROM stock_agg st
      FULL OUTER JOIN sales_agg sa ON st.dimension_key = sa.dimension_key
      LEFT JOIN mid_category_stock mcs ON COALESCE(sa.mid_category_kr, st.mid_category_kr) = mcs.mid_category_kr
      LEFT JOIN prev_month_stock pms ON st.dimension_key = pms.dimension_key
      WHERE COALESCE(st.stock_amt, 0) > 0
    ),
    
    -- 채널별 데이터 집계
    channel_data AS (
      SELECT 
        COALESCE(sc.dimension_key, stc.dimension_key) AS dimension_key,
        COALESCE(sc.channel, stc.channel) AS channel,
        COALESCE(stc.stock_amt, 0) AS channel_stock_amt,
        COALESCE(stc.stock_qty, 0) AS channel_stock_qty,
        COALESCE(sc.sales_tag_amt, 0) AS channel_sales_amt
      FROM sales_by_channel sc
      FULL OUTER JOIN stock_by_channel stc 
        ON sc.dimension_key = stc.dimension_key AND sc.channel = stc.channel
    ),
    
    -- 최종 결과
    SELECT 
      ws.dimension_key,
      ws.prdt_cd,
      ws.color_cd,
      ws.size_cd,
      ws.prdt_nm,
      ws.season,
      ws.mid_category_kr,
      ws.stock_qty,
      ws.stock_amt,
      ws.sales_tag_amt,
      ws.stock_amt_total_mid,
      ws.ratio,
      ws.prev_stock_qty,
      -- 채널별 재고/판매 (FR)
      COALESCE(fr.channel_stock_amt, 0) AS fr_stock_amt,
      COALESCE(fr.channel_stock_qty, 0) AS fr_stock_qty,
      COALESCE(fr.channel_sales_amt, 0) AS fr_sales_amt,
      -- 채널별 재고/판매 (OR + HQ)
      COALESCE(or_hq.or_stock_amt, 0) AS or_stock_amt,
      COALESCE(or_hq.or_stock_qty, 0) AS or_stock_qty,
      COALESCE(or_hq.or_sales_amt, 0) AS or_sales_amt
    FROM with_ratio ws
    LEFT JOIN (
      SELECT dimension_key, channel_stock_amt, channel_stock_qty, channel_sales_amt
      FROM channel_data WHERE channel = 'FR'
    ) fr ON ws.dimension_key = fr.dimension_key
    LEFT JOIN (
      SELECT 
        dimension_key, 
        SUM(channel_stock_amt) AS or_stock_amt,
        SUM(channel_stock_qty) AS or_stock_qty,
        SUM(channel_sales_amt) AS or_sales_amt
      FROM channel_data 
      WHERE channel IN ('OR', 'HQ')
      GROUP BY dimension_key
    ) or_hq ON ws.dimension_key = or_hq.dimension_key
    ORDER BY ws.stock_amt DESC
    """


def fetch_stagnant_stock_data(
    brand: str,
    target_month: str,
    dimension_tab: str = "스타일",
    threshold_pct: float = 0.01,
    min_qty: int = 10,
    current_month_min_qty: int = 10,
    include_account_breakdown: bool = False,
    ignore_min_qty: bool = False
) -> Dict[str, Any]:
    """정체재고 분석 데이터 조회"""
    threshold_ratio = threshold_pct / 100
    prev_month = get_prev_month(target_month)
    days_in_month = get_days_in_month(target_month)
    year_config = get_year_config(target_month)
    current_year = year_config["currentYear"]
    next_year = year_config["nextYear"]
    
    # 1. 사용 가능한 월 목록 조회
    months_query = build_available_months_query(brand)
    months_result = execute_query(months_query)
    available_months = [row["SALE_YM"] for row in months_result]
    
    # 2. 스타일 기준 당월수량 조회
    style_stock_query = build_style_stock_qty_query(brand, target_month)
    style_stock_result = execute_query(style_stock_query)
    
    style_stock_qty_map = {}
    low_stock_styles = set()
    
    for row in style_stock_result:
        style = row.get("STYLE", "")
        qty = float(row.get("CURRENT_STOCK_QTY", 0) or 0)
        style_stock_qty_map[style] = qty
        
        if qty < current_month_min_qty:
            low_stock_styles.add(style)
    
    # 3. 정체재고 분석 데이터 조회
    main_query = build_stagnant_stock_query(
        brand, target_month, dimension_tab, threshold_ratio, prev_month
    )
    main_result = execute_query(main_query)
    
    # 4. 결과 변환
    items = []
    for row in main_result:
        season = row.get("SEASON", "") or ""
        ratio = float(row.get("RATIO", 0) or 0)
        prev_stock_qty = int(row.get("PREV_STOCK_QTY", 0) or 0)
        prdt_cd = row.get("PRDT_CD", "") or ""
        
        # 당월수량미달 판단
        is_low_stock = prdt_cd in low_stock_styles
        
        # seasonGroup 결정
        if is_low_stock:
            season_group = "당월수량미달"
        else:
            season_group = get_season_group(
                season, ratio, threshold_ratio, current_year, next_year,
                prev_stock_qty, min_qty, ignore_min_qty
            )
        
        status = "정체재고" if season_group == "정체재고" else "정상재고"
        
        item = {
            "dimensionKey": row.get("DIMENSION_KEY", "") or "",
            "prdt_cd": prdt_cd,
            "prdt_nm": row.get("PRDT_NM", "") or "",
            "color_cd": row.get("COLOR_CD"),
            "size_cd": row.get("SIZE_CD"),
            "mid_category_kr": row.get("MID_CATEGORY_KR", "기타") or "기타",
            "season": season,
            "stock_qty": int(row.get("STOCK_QTY", 0) or 0),
            "stock_amt": float(row.get("STOCK_AMT", 0) or 0),
            "sales_tag_amt": float(row.get("SALES_TAG_AMT", 0) or 0),
            "ratio": ratio,
            "prev_stock_qty": prev_stock_qty,
            "status": status,
            "seasonGroup": season_group,
            "fr_stock_amt": float(row.get("FR_STOCK_AMT", 0) or 0),
            "fr_stock_qty": int(row.get("FR_STOCK_QTY", 0) or 0),
            "fr_sales_amt": float(row.get("FR_SALES_AMT", 0) or 0),
            "or_stock_amt": float(row.get("OR_STOCK_AMT", 0) or 0),
            "or_stock_qty": int(row.get("OR_STOCK_QTY", 0) or 0),
            "or_sales_amt": float(row.get("OR_SALES_AMT", 0) or 0),
        }
        items.append(item)
    
    # 5. 전체 재고금액 계산
    total_stock_amt = sum(item["stock_amt"] for item in items)
    
    # 6. 정체/정상/당월수량미달 재고 분리
    stagnant_items = [item for item in items if item["seasonGroup"] == "정체재고"]
    low_stock_items = [item for item in items if item["seasonGroup"] == "당월수량미달"]
    normal_items = [
        item for item in items
        if item["seasonGroup"] != "정체재고" and item["seasonGroup"] != "당월수량미달"
    ]
    
    # 7. 카테고리별 집계
    def aggregate_by_category(item_list: List[Dict], total: float) -> List[Dict]:
        categories = ["전체", "신발", "모자", "가방", "기타"]
        result = []
        
        for category in categories:
            filtered = item_list if category == "전체" else [
                item for item in item_list if item["mid_category_kr"] == category
            ]
            
            stock_amt = sum(item["stock_amt"] for item in filtered)
            stock_qty = sum(item["stock_qty"] for item in filtered)
            sales_tag_amt = sum(item["sales_tag_amt"] for item in filtered)
            item_count = len(set(item["dimensionKey"] for item in filtered))
            
            result.append({
                "category": category,
                "stock_amt": stock_amt,
                "stock_amt_pct": (stock_amt / total * 100) if total > 0 else 0,
                "stock_qty": stock_qty,
                "item_count": item_count,
                "sales_tag_amt": sales_tag_amt,
            })
        
        return result
    
    # 8. 요약 박스 생성
    def create_summary_box(title: str, item_list: List[Dict], total: float) -> Dict:
        categories = aggregate_by_category(item_list, total)
        total_cat = next((c for c in categories if c["category"] == "전체"), None)
        
        return {
            "title": title,
            "categories": categories,
            "total": total_cat,
        }
    
    # 9. 상세 테이블 생성
    def create_detail_table(title: str, season_group: str, item_list: List[Dict]) -> Dict:
        filtered = [item for item in item_list if item["seasonGroup"] == season_group]
        filtered_sorted = sorted(filtered, key=lambda x: x["stock_amt"], reverse=True)
        
        return {
            "title": title,
            "seasonGroup": season_group,
            "items": filtered_sorted,
            "totalRow": {
                "stock_qty": sum(item["stock_qty"] for item in filtered),
                "stock_amt": sum(item["stock_amt"] for item in filtered),
                "sales_tag_amt": sum(item["sales_tag_amt"] for item in filtered),
            },
        }
    
    # 10. 응답 생성
    response = {
        "availableMonths": available_months,
        "totalSummary": create_summary_box("전체 재고", items, total_stock_amt),
        "stagnantSummary": create_summary_box("정체재고", stagnant_items, total_stock_amt),
        "normalSummary": create_summary_box("정상재고", normal_items, total_stock_amt),
        "lowStockSummary": create_summary_box("당월수량미달", low_stock_items, total_stock_amt),
        "stagnantDetail": create_detail_table("정체재고 - 전체", "정체재고", items),
        "currentSeasonDetail": create_detail_table("당시즌 정상재고", "당시즌", items),
        "nextSeasonDetail": create_detail_table("차기시즌 정상재고", "차기시즌", items),
        "pastSeasonDetail": create_detail_table("과시즌 정상재고", "과시즌", items),
        "lowStockDetail": create_detail_table("당월수량미달 재고", "당월수량미달", items),
        "excludedStyles": list(low_stock_styles),
        "meta": {
            "targetMonth": target_month,
            "brand": brand,
            "dimensionTab": dimension_tab,
            "thresholdPct": threshold_pct,
            "currentYear": current_year,
            "nextYear": next_year,
            "currentMonthMinQty": current_month_min_qty,
            "daysInMonth": days_in_month,
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
    print("정체재고 데이터 전처리 시작")
    print("=" * 60)
    print(f"출력 경로: {OUTPUT_PATH}")
    
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    
    # 기준월 모드 확인
    if reference_month:
        # "2025.11" -> "202511"
        target_month = reference_month.replace(".", "")
        print(f"\n[정체재고] 기준월 모드: {reference_month} ({target_month})만 처리합니다.")
        months_to_process = [target_month]
    else:
        print("\n[정체재고] 전체 처리 모드: 모든 브랜드와 월을 처리합니다.")
        months_to_process = None
    
    # 기존 JSON 파일 로드
    output_file = OUTPUT_PATH / "stagnant_stock_summary.json"
    existing_data = {"brands": {}}
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print("[정체재고] 기존 JSON 파일 로드 완료")
        except Exception as e:
            print(f"[WARNING] 기존 JSON 파일 읽기 실패: {e}")
    
    # 각 브랜드별로 처리
    for brand_name in VALID_BRANDS:
        brand_code = BRAND_CODE_MAP[brand_name]
        print(f"\n[정체재고] 브랜드: {brand_name} ({brand_code})")
        
        if brand_name not in existing_data["brands"]:
            existing_data["brands"][brand_name] = {}
        
        # 각 dimensionTab별로 처리
        for dimension_tab in DIMENSION_TABS:
            print(f"  - 단위: {dimension_tab}")
            
            if months_to_process:
                # 기준월 모드: 지정된 월만 처리
                for target_month in months_to_process:
                    try:
                        print(f"    처리 중: {target_month}...")
                        response = fetch_stagnant_stock_data(
                            brand_code,
                            target_month,
                            dimension_tab,
                            threshold_pct=0.01,
                            min_qty=10,
                            current_month_min_qty=10,
                            include_account_breakdown=False,
                            ignore_min_qty=False
                        )
                        
                        if target_month not in existing_data["brands"][brand_name]:
                            existing_data["brands"][brand_name][target_month] = {}
                        
                        existing_data["brands"][brand_name][target_month][dimension_tab] = response
                        print(f"    완료: {target_month}")
                    except Exception as e:
                        print(f"    [ERROR] {target_month} 처리 실패: {e}")
                        import traceback
                        traceback.print_exc()
            else:
                # 전체 처리 모드: 사용 가능한 모든 월 처리
                months_query = build_available_months_query(brand_code)
                months_result = execute_query(months_query)
                available_months = [row["SALE_YM"] for row in months_result]
                
                for target_month in available_months:
                    # 이미 처리된 월은 건너뛰기
                    if (target_month in existing_data["brands"][brand_name] and
                        dimension_tab in existing_data["brands"][brand_name][target_month]):
                        print(f"    건너뛰기: {target_month} (이미 처리됨)")
                        continue
                    
                    try:
                        print(f"    처리 중: {target_month}...")
                        response = fetch_stagnant_stock_data(
                            brand_code,
                            target_month,
                            dimension_tab,
                            threshold_pct=0.01,
                            min_qty=10,
                            current_month_min_qty=10,
                            include_account_breakdown=False,
                            ignore_min_qty=False
                        )
                        
                        if target_month not in existing_data["brands"][brand_name]:
                            existing_data["brands"][brand_name][target_month] = {}
                        
                        existing_data["brands"][brand_name][target_month][dimension_tab] = response
                        print(f"    완료: {target_month}")
                    except Exception as e:
                        print(f"    [ERROR] {target_month} 처리 실패: {e}")
                        import traceback
                        traceback.print_exc()
    
    # JSON 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 60)
    print("전처리 완료")
    print("=" * 60)
    print(f"[DONE] 저장 완료: {output_file}")


if __name__ == "__main__":
    import sys
    
    # 기준월 모드: python preprocess_stagnant_stock.py --reference-month 2025.11
    if len(sys.argv) > 1 and sys.argv[1] == "--reference-month":
        if len(sys.argv) > 2:
            reference_month = sys.argv[2]
            main(reference_month=reference_month)
        else:
            print("사용법: python preprocess_stagnant_stock.py --reference-month 2025.11")
    else:
        main()
