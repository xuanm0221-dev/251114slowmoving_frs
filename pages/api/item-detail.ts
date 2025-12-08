import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";

// 품번별 월별 상세 데이터
interface ItemMonthlyData {
  month: string;
  stock_qty: number;
  stock_amt: number;
  sales_amt: number;
}

interface ItemDetailResponse {
  item: {
    prdt_cd: string;
    prdt_nm: string;
    mid_category_kr: string;
    season: string;
    dimensionKey: string;
  };
  currentYear: ItemMonthlyData[];
  previousYear: ItemMonthlyData[];
  meta: {
    brand: string;
    dimensionTab: string;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ItemDetailResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, prdt_cd, color_cd, size_cd, dimensionTab } = req.query;

  if (!brand || !prdt_cd || !dimensionTab) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // dimensionTab에 따라 동적으로 쿼리 구성 (stagnant-stock.ts와 동일한 방식)
    // dimension_key를 사용해서 JOIN (컬럼 직접 비교 대신 연결 키 사용)
    
    // dimension_key 구성 (stagnant-stock.ts와 동일)
    let stockDimKey = "a.prdt_cd";
    let salesDimKey = "s.prdt_cd";
    let stockWhereCondition = `a.prdt_cd = '${prdt_cd}'`;
    let salesWhereCondition = `s.prdt_cd = '${prdt_cd}'`;
    
    if (dimensionTab === "컬러") {
      stockDimKey = "a.prdt_cd || '_' || a.color_cd";
      salesDimKey = "s.prdt_cd || '_' || s.color_cd";
      if (color_cd) {
        stockWhereCondition += ` AND a.color_cd = '${color_cd}'`;
        salesWhereCondition += ` AND s.color_cd = '${color_cd}'`;
      }
    } else if (dimensionTab === "사이즈") {
      stockDimKey = "a.prdt_cd || '_' || a.size_cd";
      salesDimKey = "s.prdt_cd || '_' || s.size_cd";
      if (size_cd) {
        stockWhereCondition += ` AND a.size_cd = '${size_cd}'`;
        salesWhereCondition += ` AND s.size_cd = '${size_cd}'`;
      }
    } else if (dimensionTab === "컬러&사이즈") {
      stockDimKey = "a.prdt_scs_cd";
      salesDimKey = "s.prdt_scs_cd";
      if (color_cd && size_cd) {
        // WHERE는 개별 컬럼으로 비교 (prdt_scs_cd 형식이 테이블마다 다를 수 있음)
        stockWhereCondition = `a.prdt_cd = '${prdt_cd}' AND a.color_cd = '${color_cd}' AND a.size_cd = '${size_cd}'`;
        salesWhereCondition = `s.prdt_cd = '${prdt_cd}' AND s.color_cd = '${color_cd}' AND s.size_cd = '${size_cd}'`;
      }
    }
    // 스타일 탭은 prdt_cd만 사용 (기본값)

    // 품번 기본 정보 + 월별 데이터 조회
    const query = `
      WITH stock_data AS (
        SELECT 
          ${stockDimKey} AS dimension_key,
          a.yymm,
          MAX(a.prdt_cd) AS prdt_cd,
          MAX(b.prdt_nm) AS prdt_nm,
          MAX(CASE
            WHEN b.prdt_hrrc2_nm = 'Shoes' THEN '신발'
            WHEN b.prdt_hrrc2_nm = 'Headwear' THEN '모자'
            WHEN b.prdt_hrrc2_nm = 'Bag' THEN '가방'
            WHEN b.prdt_hrrc2_nm = 'Acc_etc' THEN '기타'
            ELSE b.prdt_hrrc2_nm
          END) AS mid_category_kr,
          MAX(SUBSTR(a.prdt_cd, 2, 3)) AS season,
          SUM(a.stock_tag_amt_expected) AS stock_amt,
          SUM(a.stock_qty_expected) AS stock_qty
        FROM fnf.chn.dw_stock_m a
        LEFT JOIN fnf.sap_fnf.mst_prdt b ON a.prdt_cd = b.prdt_cd
        WHERE a.brd_cd = '${brand}'
          AND ${stockWhereCondition}
          AND a.yymm >= '202401'
          AND a.yymm <= '202511'
        GROUP BY ${stockDimKey}, a.yymm
      ),
      sales_data AS (
        SELECT 
          ${salesDimKey} AS dimension_key,
          TO_CHAR(s.sale_dt, 'YYYYMM') AS yymm,
          SUM(s.tag_amt) AS sales_amt
        FROM fnf.chn.dw_sale s
        WHERE s.brd_cd = '${brand}'
          AND ${salesWhereCondition}
          AND s.sale_dt >= '2024-01-01'
          AND s.sale_dt < '2025-12-01'
        GROUP BY ${salesDimKey}, TO_CHAR(s.sale_dt, 'YYYYMM')
      )
      SELECT 
        st.prdt_cd,
        st.prdt_nm,
        st.mid_category_kr,
        st.season,
        st.yymm,
        st.stock_qty,
        st.stock_amt,
        COALESCE(sa.sales_amt, 0) AS sales_amt
      FROM stock_data st
      LEFT JOIN sales_data sa ON st.dimension_key = sa.dimension_key AND st.yymm = sa.yymm
      ORDER BY st.yymm;
    `;

    const rows = await runQuery(query);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    // dimensionKey 생성
    let dimensionKey = prdt_cd as string;
    if (dimensionTab === "컬러" && color_cd) {
      dimensionKey = `${prdt_cd}_${color_cd}`;
    } else if (dimensionTab === "사이즈" && size_cd) {
      dimensionKey = `${prdt_cd}_${size_cd}`;
    } else if (dimensionTab === "컬러&사이즈" && color_cd && size_cd) {
      dimensionKey = `${prdt_cd}_${color_cd}_${size_cd}`;
    }

    // 기본 정보 (첫 행에서)
    const firstRow = rows[0];
    const item = {
      prdt_cd: firstRow.PRDT_CD,
      prdt_nm: firstRow.PRDT_NM,
      mid_category_kr: firstRow.MID_CATEGORY_KR,
      season: firstRow.SEASON,
      dimensionKey,
    };

    // 2024년, 2025년 데이터 분리
    const currentYear: ItemMonthlyData[] = [];
    const previousYear: ItemMonthlyData[] = [];

    rows.forEach((row) => {
      const month = row.YYMM;
      const data: ItemMonthlyData = {
        month,
        stock_qty: row.STOCK_QTY,
        stock_amt: row.STOCK_AMT,
        sales_amt: row.SALES_AMT,
      };

      if (month.startsWith("2025")) {
        currentYear.push(data);
      } else if (month.startsWith("2024")) {
        previousYear.push(data);
      }
    });

    res.status(200).json({
      item,
      currentYear,
      previousYear,
      meta: {
        brand: brand as string,
        dimensionTab: dimensionTab as string,
      },
    });
  } catch (error) {
    console.error("Error fetching item detail:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
