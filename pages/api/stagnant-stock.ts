import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import type {
  StagnantStockResponse,
  StagnantStockItem,
  CategorySummary,
  SummaryBoxData,
  DetailTableData,
  DimensionTab,
  MidCategory,
  StockStatus,
  SeasonGroup,
  AccountBreakdownItem,
} from "../../src/types/stagnantStock";

// 단위 탭별 KEY 컬럼 매핑 (판매: s, 재고: a 테이블 alias 사용)
const DIMENSION_KEY_MAP: Record<DimensionTab, { salesKey: string; stockKey: string }> = {
  "스타일": {
    salesKey: "s.prdt_cd",
    stockKey: "a.prdt_cd",
  },
  "컬러": {
    salesKey: "s.prdt_cd || '_' || s.color_cd",
    stockKey: "a.prdt_cd || '_' || a.color_cd",
  },
  "사이즈": {
    salesKey: "s.prdt_cd || '_' || s.size_cd",
    stockKey: "a.prdt_cd || '_' || a.size_cd",
  },
  "컬러&사이즈": {
    salesKey: "s.prdt_scs_cd",
    stockKey: "a.prdt_scs_cd",
  },
};

// 현재 연도 기준으로 당해/차기 연도 계산
function getYearConfig(): { currentYear: string; nextYear: string } {
  const now = new Date();
  const year = now.getFullYear();
  return {
    currentYear: String(year).slice(-2), // "25"
    nextYear: String(year + 1).slice(-2), // "26"
  };
}

// 전월 계산 함수 (YYYYMM 형식)
function getPrevMonth(targetMonth: string): string {
  const year = parseInt(targetMonth.slice(0, 4), 10);
  const month = parseInt(targetMonth.slice(4, 6), 10);
  
  if (month === 1) {
    return `${year - 1}12`;
  }
  return `${year}${String(month - 1).padStart(2, '0')}`;
}

// 시즌 그룹 결정 - 시즌 구분 선행, 과시즌만 정체재고 판단 (2단계)
// 변경: 과시즌 상품에 대해 전월말 수량 조건 추가
// ignoreMinQty: true일 경우 전월말 수량 조건 무시 (대리상 단위 분석용)
function getSeasonGroup(
  season: string, 
  ratio: number, 
  thresholdRatio: number,
  currentYear: string, 
  nextYear: string,
  prevMonthStockQty: number,
  minQty: number,
  ignoreMinQty: boolean = false
): SeasonGroup {
  // 1. 먼저 시즌 구분 (당시즌, 차기시즌은 정체재고로 바뀌지 않음)
  if (season && season.startsWith(currentYear)) return "당시즌";
  if (season && season.startsWith(nextYear)) return "차기시즌";
  
  // 2. 과시즌인 경우: 정체재고 판단
  // ignoreMinQty=false: 전월말 수량이 minQty 미만이면 정체 아님 (과시즌)
  // ignoreMinQty=true: 전월말 수량 조건 무시
  if (!ignoreMinQty && prevMonthStockQty < minQty) return "과시즌";
  
  // (2) 비율로 정체재고 판단
  if (ratio < thresholdRatio) return "정체재고";
  return "과시즌";
}

// 사용 가능한 월 목록 조회 쿼리
function buildAvailableMonthsQuery(brand: string): string {
  return `
    SELECT DISTINCT TO_CHAR(sale_dt, 'YYYYMM') AS sale_ym
    FROM fnf.chn.dw_sale s
    LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
    WHERE s.brd_cd = '${brand}'
      AND p.prdt_hrrc1_nm = 'ACC'
      AND sale_dt >= '2024-01-01'
    ORDER BY sale_ym DESC
  `;
}

// 스타일 기준 당월수량 조회 쿼리 (당월수량미달 판단용)
// 스타일별로 당월 재고수량을 집계하여 반환
function buildStyleStockQtyQuery(
  brand: string,
  targetMonth: string
): string {
  return `
    SELECT 
      a.prdt_cd AS style,
      SUM(a.stock_qty_expected) AS current_stock_qty
    FROM fnf.chn.dw_stock_m a
    LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
    WHERE a.yymm = '${targetMonth}'
      AND a.brd_cd = '${brand}'
      AND b.prdt_hrrc1_nm = 'ACC'
    GROUP BY a.prdt_cd
  `;
}

// 월의 일수 계산 함수
function getDaysInMonth(yyyymm: string): number {
  if (yyyymm.length !== 6) return 30;
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return new Date(year, month, 0).getDate();
}

// FR 채널 대리상별(account_id) 재고/판매 조회 쿼리 (대리상 단위 분석용)
function buildAccountBreakdownQuery(
  brand: string,
  targetMonth: string,
  dimensionTab: DimensionTab
): string {
  const dimConfig = DIMENSION_KEY_MAP[dimensionTab];
  
  return `
    WITH 
    -- FR 재고 데이터 (account_id + dimension_key 단위)
    fr_stock AS (
      SELECT 
        d.account_id,
        ${dimConfig.stockKey} AS dimension_key,
        SUM(a.stock_tag_amt_expected) AS stock_amt,
        SUM(a.stock_qty_expected) AS stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      LEFT JOIN fnf.chn.dw_shop_wh_detail d ON a.shop_id = d.oa_map_shop_id
      WHERE a.yymm = '${targetMonth}'
        AND a.brd_cd = '${brand}'
        AND b.prdt_hrrc1_nm = 'ACC'
        AND d.fr_or_cls = 'FR'
      GROUP BY d.account_id, ${dimConfig.stockKey}
    ),
    
    -- FR 판매 데이터 (account_id + dimension_key 단위)
    fr_sales AS (
      SELECT 
        d.account_id,
        ${dimConfig.salesKey} AS dimension_key,
        SUM(s.tag_amt) AS sales_amt
      FROM fnf.chn.dw_sale s
      LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
      LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
      WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '${targetMonth}'
        AND s.brd_cd = '${brand}'
        AND p.prdt_hrrc1_nm = 'ACC'
        AND d.fr_or_cls = 'FR'
      GROUP BY d.account_id, ${dimConfig.salesKey}
    )
    
    -- 재고/판매 조인
    SELECT 
      COALESCE(st.account_id, sa.account_id, '(미매핑)') AS account_id,
      COALESCE(st.dimension_key, sa.dimension_key) AS dimension_key,
      COALESCE(st.stock_amt, 0) AS stock_amt,
      COALESCE(st.stock_qty, 0) AS stock_qty,
      COALESCE(sa.sales_amt, 0) AS sales_amt
    FROM fr_stock st
    FULL OUTER JOIN fr_sales sa 
      ON st.account_id = sa.account_id AND st.dimension_key = sa.dimension_key
    WHERE COALESCE(st.stock_amt, 0) > 0
    ORDER BY st.account_id, st.stock_amt DESC
  `;
}

// 정체재고 분석 메인 쿼리 생성 (채널별 데이터 포함)
// 정체/정상 판단은 전체(FR+OR+HQ) 기준으로 수행하고, 채널별 재고/판매 데이터를 별도로 집계
function buildStagnantStockQuery(
  brand: string,
  targetMonth: string,
  dimensionTab: DimensionTab,
  thresholdRatio: number,
  prevMonth: string
): string {
  const dimConfig = DIMENSION_KEY_MAP[dimensionTab];
  
  return `
    WITH 
    -- 전월 재고 수량 집계 (정체재고 판단용)
    prev_month_stock AS (
      SELECT 
        ${dimConfig.stockKey} AS dimension_key,
        SUM(a.stock_qty_expected) AS prev_stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      WHERE a.yymm = '${prevMonth}'
        AND a.brd_cd = '${brand}'
        AND b.prdt_hrrc1_nm = 'ACC'
      GROUP BY ${dimConfig.stockKey}
    ),
    
    -- 채널별 판매 데이터 집계
    sales_by_channel AS (
      SELECT 
        ${dimConfig.salesKey} AS dimension_key,
        d.fr_or_cls AS channel,
        MAX(s.prdt_cd) AS prdt_cd,
        MAX(s.color_cd) AS color_cd,
        MAX(s.size_cd) AS size_cd,
        MAX(p.prdt_nm) AS prdt_nm,
        MAX(SUBSTR(s.prdt_cd, 2, 3)) AS season,
        MAX(CASE
          WHEN p.prdt_hrrc2_nm = 'Shoes' THEN '신발'
          WHEN p.prdt_hrrc2_nm = 'Headwear' THEN '모자'
          WHEN p.prdt_hrrc2_nm = 'Bag' THEN '가방'
          WHEN p.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
          ELSE p.prdt_hrrc2_nm
        END) AS mid_category_kr,
        SUM(s.tag_amt) AS sales_tag_amt,
        SUM(s.qty) AS sales_qty
      FROM fnf.chn.dw_sale s
      LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
      LEFT JOIN fnf.chn.dw_shop_wh_detail d ON s.shop_id = d.oa_map_shop_id
      WHERE TO_CHAR(s.sale_dt, 'YYYYMM') = '${targetMonth}'
        AND s.brd_cd = '${brand}'
        AND p.prdt_hrrc1_nm = 'ACC'
        AND d.fr_or_cls IN ('FR', 'OR', 'HQ')
      GROUP BY ${dimConfig.salesKey}, d.fr_or_cls
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
        ${dimConfig.stockKey} AS dimension_key,
        COALESCE(c.fr_or_cls, 'HQ') AS channel,
        MAX(a.prdt_cd) AS prdt_cd,
        MAX(a.color_cd) AS color_cd,
        MAX(a.size_cd) AS size_cd,
        MAX(b.prdt_nm) AS prdt_nm,
        MAX(a.sesn) AS season,
        MAX(CASE
          WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
          WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
          WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
          WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
          ELSE b.prdt_hrrc2_nm
        END) AS mid_category_kr,
        SUM(a.stock_tag_amt_expected) AS stock_amt,
        SUM(a.stock_qty_expected) AS stock_qty
      FROM fnf.chn.dw_stock_m a
      LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
      LEFT JOIN fnf.chn.dw_shop_wh_detail c ON a.shop_id = c.oa_map_shop_id
      WHERE a.yymm = '${targetMonth}'
        AND a.brd_cd = '${brand}'
        AND b.prdt_hrrc1_nm = 'ACC'
      GROUP BY ${dimConfig.stockKey}, COALESCE(c.fr_or_cls, 'HQ')
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
    
    -- 중분류별 재고 합계 (정체재고 분모) - 전체 기준
    mid_category_totals AS (
      SELECT 
        mid_category_kr,
        SUM(stock_amt) AS stock_amt_total_mid
      FROM stock_agg
      WHERE mid_category_kr IN ('신발', '모자', '가방', '기타')
      GROUP BY mid_category_kr
    ),
    
    -- 전체 기준 판매와 재고 JOIN (정체/정상 판단용) + 전월 재고 수량
    combined_total AS (
      SELECT 
        COALESCE(st.dimension_key, sa.dimension_key) AS dimension_key,
        COALESCE(st.prdt_cd, sa.prdt_cd) AS prdt_cd,
        COALESCE(st.color_cd, sa.color_cd) AS color_cd,
        COALESCE(st.size_cd, sa.size_cd) AS size_cd,
        COALESCE(st.prdt_nm, sa.prdt_nm) AS prdt_nm,
        COALESCE(st.mid_category_kr, sa.mid_category_kr) AS mid_category_kr,
        COALESCE(st.season, sa.season) AS season,
        COALESCE(st.stock_qty, 0) AS stock_qty,
        COALESCE(st.stock_amt, 0) AS stock_amt,
        COALESCE(sa.sales_tag_amt, 0) AS sales_tag_amt,
        mt.stock_amt_total_mid,
        COALESCE(pms.prev_stock_qty, 0) AS prev_stock_qty
      FROM stock_agg st
      FULL OUTER JOIN sales_agg sa ON st.dimension_key = sa.dimension_key
      LEFT JOIN mid_category_totals mt ON COALESCE(st.mid_category_kr, sa.mid_category_kr) = mt.mid_category_kr
      LEFT JOIN prev_month_stock pms ON COALESCE(st.dimension_key, sa.dimension_key) = pms.dimension_key
      WHERE COALESCE(st.stock_amt, 0) > 0
        AND COALESCE(st.mid_category_kr, sa.mid_category_kr) IN ('신발', '모자', '가방', '기타')
    ),
    
    -- 정체/정상 상태 판단 (전체 기준) - 전월 수량 포함
    with_status AS (
      SELECT 
        dimension_key,
        prdt_cd,
        color_cd,
        size_cd,
        prdt_nm,
        mid_category_kr,
        season,
        stock_qty,
        stock_amt,
        sales_tag_amt,
        stock_amt_total_mid,
        prev_stock_qty,
        CASE 
          WHEN stock_amt_total_mid > 0 THEN sales_tag_amt / stock_amt_total_mid
          ELSE 0
        END AS ratio
      FROM combined_total
    ),
    
    -- 채널별 재고/판매 데이터와 정체/정상 상태 조인
    channel_data AS (
      SELECT 
        ws.dimension_key,
        stc.channel,
        COALESCE(stc.stock_amt, 0) AS channel_stock_amt,
        COALESCE(stc.stock_qty, 0) AS channel_stock_qty,
        COALESCE(slc.sales_tag_amt, 0) AS channel_sales_amt
      FROM with_status ws
      LEFT JOIN stock_by_channel stc ON ws.dimension_key = stc.dimension_key
      LEFT JOIN sales_by_channel slc ON ws.dimension_key = slc.dimension_key AND stc.channel = slc.channel
    )
    
    -- 최종 결과: 전체 기준 정체/정상 + 채널별 재고/판매 + 전월 수량
    SELECT 
      ws.dimension_key,
      ws.prdt_cd,
      ws.color_cd,
      ws.size_cd,
      ws.prdt_nm,
      ws.mid_category_kr,
      ws.season,
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
    FROM with_status ws
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
  `;
}

// 카테고리별 집계 함수
function aggregateByCategory(
  items: StagnantStockItem[],
  totalStockAmt: number
): CategorySummary[] {
  const categories: MidCategory[] = ["전체", "신발", "모자", "가방", "기타"];
  
  return categories.map(category => {
    const filtered = category === "전체" 
      ? items 
      : items.filter(item => item.mid_category_kr === category);
    
    const stock_amt = filtered.reduce((sum, item) => sum + item.stock_amt, 0);
    const stock_qty = filtered.reduce((sum, item) => sum + item.stock_qty, 0);
    const sales_tag_amt = filtered.reduce((sum, item) => sum + item.sales_tag_amt, 0);
    const item_count = new Set(filtered.map(item => item.dimensionKey)).size;
    
    return {
      category,
      stock_amt,
      stock_amt_pct: totalStockAmt > 0 ? (stock_amt / totalStockAmt) * 100 : 0,
      stock_qty,
      item_count,
      sales_tag_amt,
    };
  });
}

// 요약 박스 생성 함수
function createSummaryBox(
  title: string,
  items: StagnantStockItem[],
  totalStockAmt: number
): SummaryBoxData {
  const categories = aggregateByCategory(items, totalStockAmt);
  const total = categories.find(c => c.category === "전체")!;
  
  return {
    title,
    categories,
    total,
  };
}

// 상세 테이블 생성 함수
function createDetailTable(
  title: string,
  seasonGroup: SeasonGroup,
  items: StagnantStockItem[]
): DetailTableData {
  const filteredItems = items.filter(item => item.seasonGroup === seasonGroup);
  
  return {
    title,
    seasonGroup,
    items: filteredItems.sort((a, b) => b.stock_amt - a.stock_amt),
    totalRow: {
      stock_qty: filteredItems.reduce((sum, item) => sum + item.stock_qty, 0),
      stock_amt: filteredItems.reduce((sum, item) => sum + item.stock_amt, 0),
      sales_tag_amt: filteredItems.reduce((sum, item) => sum + item.sales_tag_amt, 0),
    },
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StagnantStockResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { 
    brand, 
    targetMonth, 
    dimensionTab, 
    thresholdPct, 
    minQty: minQtyParam, 
    currentMonthMinQty: currentMonthMinQtyParam,
    includeAccountBreakdown: includeAccountBreakdownParam,
    ignoreMinQty: ignoreMinQtyParam,
  } = req.query;

  // 파라미터 검증
  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }
  if (!targetMonth || typeof targetMonth !== "string") {
    return res.status(400).json({ error: "targetMonth parameter is required" });
  }

  const dimTab = (dimensionTab as DimensionTab) || "스타일";
  const threshold = parseFloat(thresholdPct as string) || 0.01;
  const thresholdRatio = threshold / 100; // 0.01% → 0.0001
  const minQty = parseInt(minQtyParam as string, 10) || 10; // 최소 수량 기준 (기본값 10) - 전월말 기준
  const currentMonthMinQty = parseInt(currentMonthMinQtyParam as string, 10) || 10; // 당월수량 기준 (기본값 10)
  const includeAccountBreakdown = includeAccountBreakdownParam === "true"; // 대리상별 FR 데이터 포함 여부
  const ignoreMinQty = ignoreMinQtyParam === "true"; // 전월말 수량 조건 무시 여부 (대리상 단위 분석용)
  const prevMonth = getPrevMonth(targetMonth); // 전월 계산
  const daysInMonth = getDaysInMonth(targetMonth); // 해당 월의 일수

  const { currentYear, nextYear } = getYearConfig();

  try {
    // 1. 사용 가능한 월 목록 조회
    const monthsQuery = buildAvailableMonthsQuery(brand);
    const monthsResult = await runQuery(monthsQuery);
    const availableMonths = monthsResult.map((row: any) => row.SALE_YM);

    // 2. 스타일 기준 당월수량 조회 (당월수량미달 판단용)
    const styleStockQuery = buildStyleStockQtyQuery(brand, targetMonth);
    const styleStockResult = await runQuery(styleStockQuery);
    
    // 스타일별 당월수량 맵 생성 + 당월수량미달 스타일 목록 추출
    const styleStockQtyMap = new Map<string, number>();
    const lowStockStyles = new Set<string>();
    
    styleStockResult.forEach((row: any) => {
      const style = row.STYLE || "";
      const qty = Number(row.CURRENT_STOCK_QTY) || 0;
      styleStockQtyMap.set(style, qty);
      
      // 당월수량 < currentMonthMinQty인 스타일 추출
      if (qty < currentMonthMinQty) {
        lowStockStyles.add(style);
      }
    });

    // 3. 정체재고 분석 데이터 조회 (전월 재고 수량 포함)
    const mainQuery = buildStagnantStockQuery(brand, targetMonth, dimTab, thresholdRatio, prevMonth);
    const mainResult = await runQuery(mainQuery);

    // 4. 결과 변환 (채널별 데이터 포함)
    // 변경: 당월수량미달 먼저 판단 → 나머지에 대해 기존 정체재고 로직
    const items: StagnantStockItem[] = mainResult.map((row: any) => {
      const season = row.SEASON || "";
      const ratio = Number(row.RATIO) || 0;
      const prevStockQty = Number(row.PREV_STOCK_QTY) || 0;
      const prdtCd = row.PRDT_CD || "";
      
      // 1단계: 스타일 기준 당월수량미달 판단 (스타일이 lowStockStyles에 포함되면 당월수량미달)
      const isLowStock = lowStockStyles.has(prdtCd);
      
      // seasonGroup 결정: 당월수량미달 먼저, 아니면 기존 로직
      let seasonGroup: SeasonGroup;
      if (isLowStock) {
        seasonGroup = "당월수량미달";
      } else {
        // 기존 로직: 시즌 구분 먼저, 과시즌인 경우 2단계 판단
        // ignoreMinQty: 대리상 단위 분석에서는 전월말 수량 조건 무시
        seasonGroup = getSeasonGroup(season, ratio, thresholdRatio, currentYear, nextYear, prevStockQty, minQty, ignoreMinQty);
      }
      
      // status는 seasonGroup 기반으로 결정 (정체재고이면 정체재고, 당월수량미달/기타는 정상재고)
      const status: StockStatus = seasonGroup === "정체재고" ? "정체재고" : "정상재고";

      return {
        dimensionKey: row.DIMENSION_KEY || "",
        prdt_cd: prdtCd,
        prdt_nm: row.PRDT_NM || "",
        color_cd: row.COLOR_CD,
        size_cd: row.SIZE_CD,
        mid_category_kr: row.MID_CATEGORY_KR || "기타",
        season,
        // 전체 기준 데이터
        stock_qty: Number(row.STOCK_QTY) || 0,
        stock_amt: Number(row.STOCK_AMT) || 0,
        sales_tag_amt: Number(row.SALES_TAG_AMT) || 0,
        ratio: Number(row.RATIO) || 0,
        prev_stock_qty: prevStockQty,
        status,
        seasonGroup,
        // 채널별 데이터 (FR)
        fr_stock_amt: Number(row.FR_STOCK_AMT) || 0,
        fr_stock_qty: Number(row.FR_STOCK_QTY) || 0,
        fr_sales_amt: Number(row.FR_SALES_AMT) || 0,
        // 채널별 데이터 (OR + HQ)
        or_stock_amt: Number(row.OR_STOCK_AMT) || 0,
        or_stock_qty: Number(row.OR_STOCK_QTY) || 0,
        or_sales_amt: Number(row.OR_SALES_AMT) || 0,
      };
    });

    // 5. 전체 재고금액 계산 (요약 박스의 % 계산용)
    const totalStockAmt = items.reduce((sum, item) => sum + item.stock_amt, 0);

    // 6. 정체/정상/당월수량미달 재고 분리
    const stagnantItems = items.filter(item => item.seasonGroup === "정체재고");
    const lowStockItems = items.filter(item => item.seasonGroup === "당월수량미달");
    // 정상재고: 당시즌 + 차기시즌 + 과시즌 (정체재고와 당월수량미달 제외)
    const normalItems = items.filter(item => 
      item.seasonGroup !== "정체재고" && item.seasonGroup !== "당월수량미달"
    );

    // 7. 대리상별 FR 데이터 조회 (includeAccountBreakdown=true인 경우)
    let accountBreakdown: AccountBreakdownItem[] | undefined;
    if (includeAccountBreakdown) {
      const accountQuery = buildAccountBreakdownQuery(brand, targetMonth, dimTab);
      const accountResult = await runQuery(accountQuery);
      
      accountBreakdown = accountResult.map((row: any) => ({
        account_id: row.ACCOUNT_ID || "(미매핑)",
        dimensionKey: row.DIMENSION_KEY || "",
        stock_amt: Number(row.STOCK_AMT) || 0,
        stock_qty: Number(row.STOCK_QTY) || 0,
        sales_amt: Number(row.SALES_AMT) || 0,
      }));
    }

    // 8. 응답 생성
    const response: StagnantStockResponse = {
      availableMonths,
      
      totalSummary: createSummaryBox("전체 재고", items, totalStockAmt),
      stagnantSummary: createSummaryBox("정체재고", stagnantItems, totalStockAmt),
      normalSummary: createSummaryBox("정상재고", normalItems, totalStockAmt),
      lowStockSummary: createSummaryBox("당월수량미달", lowStockItems, totalStockAmt),
      
      stagnantDetail: createDetailTable("정체재고 - 전체", "정체재고", items),
      currentSeasonDetail: createDetailTable("당시즌 정상재고", "당시즌", items),
      nextSeasonDetail: createDetailTable("차기시즌 정상재고", "차기시즌", items),
      pastSeasonDetail: createDetailTable("과시즌 정상재고", "과시즌", items),
      lowStockDetail: createDetailTable("당월수량미달 재고", "당월수량미달", items),
      
      // 당월수량미달 스타일 목록 (다른 분석단위에서 참조용)
      excludedStyles: Array.from(lowStockStyles),
      
      // 대리상별 FR 데이터 (대리상 단위 분석용)
      accountBreakdown,
      
      meta: {
        targetMonth,
        brand,
        dimensionTab: dimTab,
        thresholdPct: threshold,
        currentYear,
        nextYear,
        currentMonthMinQty,
        daysInMonth,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Stagnant stock query error:", error);
    res.status(500).json({ error: String(error) });
  }
}

