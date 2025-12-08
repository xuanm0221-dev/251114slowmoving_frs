import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";

// 품번 상세 응답 타입
interface StagnantStockDetailResponse {
  // 기본 정보
  dimensionKey: string;
  prdt_cd: string;
  prdt_nm: string;
  season: string;
  mid_category_kr: string;
  status: string;
  
  // 당년 데이터
  curr_stock_amt: number;
  curr_stock_qty: number;
  curr_sales_amt: number;
  curr_stock_weeks: number;
  
  // 전년 데이터
  prev_stock_amt: number;
  prev_stock_qty: number;
  prev_sales_amt: number;
  prev_stock_weeks: number;
  
  // YOY
  stock_yoy: number | null;
  sales_yoy: number | null;
  
  // 월별 추이 (최근 12개월)
  monthlyData: {
    month: string;
    stock_amt: number;
    sales_amt: number;
  }[];
}

// 품번별 월별 데이터 조회 쿼리
function buildMonthlyDetailQuery(
  brand: string,
  prdt_cd: string,
  targetMonth: string
): string {
  // targetMonth에서 년도 추출
  const targetYear = parseInt(targetMonth.slice(0, 4));
  const targetMonthNum = parseInt(targetMonth.slice(4, 6));
  
  // 12개월 전 계산
  const startDate = new Date(targetYear, targetMonthNum - 12, 1);
  const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}`;
  
  return `
    WITH 
    -- 월별 판매 데이터
    monthly_sales AS (
      SELECT 
        TO_CHAR(sale_dt, 'YYYYMM') AS sale_ym,
        SUM(tag_amt) AS sales_amt
      FROM fnf.chn.dw_sale s
      LEFT JOIN fnf.sap_fnf.mst_prdt p ON s.prdt_cd = p.prdt_cd
      WHERE s.prdt_cd = '${prdt_cd}'
        AND s.brd_cd = '${brand}'
        AND TO_CHAR(sale_dt, 'YYYYMM') >= '${startMonth}'
        AND TO_CHAR(sale_dt, 'YYYYMM') <= '${targetMonth}'
      GROUP BY TO_CHAR(sale_dt, 'YYYYMM')
    ),
    
    -- 월별 재고 데이터
    monthly_stock AS (
      SELECT 
        yymm,
        SUM(stock_tag_amt_expected) AS stock_amt
      FROM fnf.chn.dw_stock_m
      WHERE prdt_cd = '${prdt_cd}'
        AND brd_cd = '${brand}'
        AND yymm >= '${startMonth}'
        AND yymm <= '${targetMonth}'
      GROUP BY yymm
    ),
    
    -- 월 목록 생성
    all_months AS (
      SELECT DISTINCT yymm AS month
      FROM fnf.chn.dw_stock_m
      WHERE yymm >= '${startMonth}' AND yymm <= '${targetMonth}'
    )
    
    SELECT 
      m.month,
      COALESCE(st.stock_amt, 0) AS stock_amt,
      COALESCE(sl.sales_amt, 0) AS sales_amt
    FROM all_months m
    LEFT JOIN monthly_stock st ON m.month = st.yymm
    LEFT JOIN monthly_sales sl ON m.month = sl.sale_ym
    ORDER BY m.month
  `;
}

// 당년/전년 비교 데이터 쿼리
function buildYoyCompareQuery(
  brand: string,
  prdt_cd: string,
  targetMonth: string
): string {
  // 전년 동월 계산
  const targetYear = parseInt(targetMonth.slice(0, 4));
  const targetMonthNum = targetMonth.slice(4, 6);
  const prevMonth = `${targetYear - 1}${targetMonthNum}`;
  
  return `
    WITH 
    -- 당년 데이터
    curr_data AS (
      SELECT 
        COALESCE(st.stock_amt, 0) AS stock_amt,
        COALESCE(st.stock_qty, 0) AS stock_qty,
        COALESCE(sl.sales_amt, 0) AS sales_amt
      FROM (
        SELECT 
          SUM(stock_tag_amt_expected) AS stock_amt,
          SUM(stock_qty_expected) AS stock_qty
        FROM fnf.chn.dw_stock_m
        WHERE prdt_cd = '${prdt_cd}'
          AND brd_cd = '${brand}'
          AND yymm = '${targetMonth}'
      ) st
      CROSS JOIN (
        SELECT SUM(tag_amt) AS sales_amt
        FROM fnf.chn.dw_sale
        WHERE prdt_cd = '${prdt_cd}'
          AND brd_cd = '${brand}'
          AND TO_CHAR(sale_dt, 'YYYYMM') = '${targetMonth}'
      ) sl
    ),
    
    -- 전년 데이터
    prev_data AS (
      SELECT 
        COALESCE(st.stock_amt, 0) AS stock_amt,
        COALESCE(st.stock_qty, 0) AS stock_qty,
        COALESCE(sl.sales_amt, 0) AS sales_amt
      FROM (
        SELECT 
          SUM(stock_tag_amt_expected) AS stock_amt,
          SUM(stock_qty_expected) AS stock_qty
        FROM fnf.chn.dw_stock_m
        WHERE prdt_cd = '${prdt_cd}'
          AND brd_cd = '${brand}'
          AND yymm = '${prevMonth}'
      ) st
      CROSS JOIN (
        SELECT SUM(tag_amt) AS sales_amt
        FROM fnf.chn.dw_sale
        WHERE prdt_cd = '${prdt_cd}'
          AND brd_cd = '${brand}'
          AND TO_CHAR(sale_dt, 'YYYYMM') = '${prevMonth}'
      ) sl
    )
    
    SELECT 
      'curr' AS data_type,
      stock_amt,
      stock_qty,
      sales_amt
    FROM curr_data
    UNION ALL
    SELECT 
      'prev' AS data_type,
      stock_amt,
      stock_qty,
      sales_amt
    FROM prev_data
  `;
}

// 품번 기본 정보 쿼리
function buildProductInfoQuery(brand: string, prdt_cd: string): string {
  return `
    SELECT 
      prdt_cd,
      prdt_nm,
      SUBSTR(prdt_cd, 2, 3) AS season,
      CASE
        WHEN prdt_hrrc2_nm = 'Shoes' THEN '신발'
        WHEN prdt_hrrc2_nm = 'Headwear' THEN '모자'
        WHEN prdt_hrrc2_nm = 'Bag' THEN '가방'
        WHEN prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
        ELSE prdt_hrrc2_nm
      END AS mid_category_kr
    FROM fnf.sap_fnf.mst_prdt
    WHERE prdt_cd = '${prdt_cd}'
    LIMIT 1
  `;
}

// 재고주수 계산 (일 수 기준)
function calcStockWeeks(stockAmt: number, salesAmt: number, daysInMonth: number = 30): number {
  if (salesAmt <= 0) return 0;
  const weekSales = (salesAmt / daysInMonth) * 7;
  if (weekSales <= 0) return 0;
  return stockAmt / weekSales;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StagnantStockDetailResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, prdt_cd, targetMonth, dimensionKey, status } = req.query;

  // 파라미터 검증
  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }
  if (!prdt_cd || typeof prdt_cd !== "string") {
    return res.status(400).json({ error: "prdt_cd parameter is required" });
  }
  if (!targetMonth || typeof targetMonth !== "string") {
    return res.status(400).json({ error: "targetMonth parameter is required" });
  }

  try {
    // 1. 품번 기본 정보 조회
    const productInfoQuery = buildProductInfoQuery(brand, prdt_cd);
    const productInfoResult = await runQuery(productInfoQuery);
    
    if (productInfoResult.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    const productInfo = productInfoResult[0];

    // 2. 당년/전년 비교 데이터 조회
    const yoyQuery = buildYoyCompareQuery(brand, prdt_cd, targetMonth);
    const yoyResult = await runQuery(yoyQuery);
    
    const currData = yoyResult.find((r: any) => r.DATA_TYPE === "curr") || { STOCK_AMT: 0, STOCK_QTY: 0, SALES_AMT: 0 };
    const prevData = yoyResult.find((r: any) => r.DATA_TYPE === "prev") || { STOCK_AMT: 0, STOCK_QTY: 0, SALES_AMT: 0 };
    
    const currStockAmt = Number(currData.STOCK_AMT) || 0;
    const currStockQty = Number(currData.STOCK_QTY) || 0;
    const currSalesAmt = Number(currData.SALES_AMT) || 0;
    const prevStockAmt = Number(prevData.STOCK_AMT) || 0;
    const prevStockQty = Number(prevData.STOCK_QTY) || 0;
    const prevSalesAmt = Number(prevData.SALES_AMT) || 0;

    // 3. 월별 추이 데이터 조회
    const monthlyQuery = buildMonthlyDetailQuery(brand, prdt_cd, targetMonth);
    const monthlyResult = await runQuery(monthlyQuery);
    
    const monthlyData = monthlyResult.map((row: any) => ({
      month: row.MONTH,
      stock_amt: Number(row.STOCK_AMT) || 0,
      sales_amt: Number(row.SALES_AMT) || 0,
    }));

    // 4. 재고주수 계산
    const daysInMonth = new Date(
      parseInt(targetMonth.slice(0, 4)),
      parseInt(targetMonth.slice(4, 6)),
      0
    ).getDate();
    
    const currStockWeeks = calcStockWeeks(currStockAmt, currSalesAmt, daysInMonth);
    const prevStockWeeks = calcStockWeeks(prevStockAmt, prevSalesAmt, daysInMonth);

    // 5. YOY 계산
    const stockYoy = prevStockAmt > 0 ? (currStockAmt / prevStockAmt - 1) * 100 : null;
    const salesYoy = prevSalesAmt > 0 ? (currSalesAmt / prevSalesAmt - 1) * 100 : null;

    // 6. 응답 생성
    const response: StagnantStockDetailResponse = {
      dimensionKey: (dimensionKey as string) || prdt_cd,
      prdt_cd: productInfo.PRDT_CD,
      prdt_nm: productInfo.PRDT_NM || "",
      season: productInfo.SEASON || "",
      mid_category_kr: productInfo.MID_CATEGORY_KR || "기타",
      status: (status as string) || "정상재고",
      
      curr_stock_amt: currStockAmt,
      curr_stock_qty: currStockQty,
      curr_sales_amt: currSalesAmt,
      curr_stock_weeks: currStockWeeks,
      
      prev_stock_amt: prevStockAmt,
      prev_stock_qty: prevStockQty,
      prev_sales_amt: prevSalesAmt,
      prev_stock_weeks: prevStockWeeks,
      
      stock_yoy: stockYoy,
      sales_yoy: salesYoy,
      
      monthlyData,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Stagnant stock detail query error:", error);
    res.status(500).json({ error: String(error) });
  }
}
