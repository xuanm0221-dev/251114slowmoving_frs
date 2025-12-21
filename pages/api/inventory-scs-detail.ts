import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import { SHOP_MAPPING_CTES_3WAY } from "../../lib/snowflakeQueries";
import type { InventoryScsDetailResponse } from "../../src/types/sales";

interface ErrorResponse {
  error: string;
  details?: string;
  stack?: string;
  params?: {
    brand?: string;
    month?: string;
    itemTab?: string;
    scope?: string;
    segment?: string;
    stockWeek?: number;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InventoryScsDetailResponse | ErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, month, itemTab, scope, segment, stockWeek } = req.query;

  if (!brand || !month || !itemTab || !scope || !segment) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const brandCode = String(brand);
  const monthYYYYMM = String(month);
  const itemCategory = String(itemTab);
  const scopeType = String(scope) as 'total' | 'frs' | 'hqor' | 'warehouse' | 'retail';
  const segmentType = String(segment) as 'core' | 'outlet';
  const stockWeekNum = Number(stockWeek) || 25;

  console.log('[inventory-scs-detail] Request params:', {
    brand: brandCode,
    month: monthYYYYMM,
    itemTab: itemCategory,
    scope: scopeType,
    segment: segmentType,
    stockWeek: stockWeekNum
  });

  try {
    // 일수 계산
    const year = parseInt(monthYYYYMM.substring(0, 4));
    const monthNum = parseInt(monthYYYYMM.substring(4, 6));
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    // 아이템 필터 조건
    const itemFilter = itemCategory === 'ALL'
      ? "p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')"
      : `p.prdt_kind_nm_en = '${itemCategory}'`;

    let query = '';

    if (scopeType === 'retail') {
      // 직영 판매예정분 (DW_SALE 사용)
      query = `
WITH 
${SHOP_MAPPING_CTES_3WAY},

or_sales_raw AS (
  SELECT 
    s.prdt_scs_cd,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.tag_amt
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.sale_ym = '${monthYYYYMM}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

or_sales_mapped AS (
  SELECT 
    osr.*,
    sm.fr_or_cls
  FROM or_sales_raw osr
  LEFT JOIN map_norm sm ON osr.shop_id = sm.norm_key
  WHERE sm.fr_or_cls = 'OR'
),

-- product_type 계산 (remark 기반)
remark_map AS (
  SELECT 
    p.prdt_scs_cd,
    CASE
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 1 AND 3 THEN p.remark1
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 4 AND 6 THEN p.remark2
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 7 AND 9 THEN p.remark3
      ELSE p.remark4
    END AS op_std,
    p.sesn
  FROM FNF.CHN.MST_PRDT_SCS p
  WHERE p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

product_type_calc AS (
  SELECT
    prdt_scs_cd,
    CASE
      WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN NULLIF(COALESCE(op_std, sesn), '') IS NOT NULL 
        AND TRY_CAST(SUBSTRING(NULLIF(COALESCE(op_std, sesn), ''), 1, 2) AS INT) >= SUBSTRING('${monthYYYYMM}', 3, 2)::INT
      THEN 'core'
      ELSE 'outlet'
    END AS product_type
  FROM remark_map
)

SELECT 
  s.prdt_scs_cd,
  p.prdt_nm_cn,
  ROUND((SUM(s.tag_amt) / ${daysInMonth}) * 7 * ${stockWeekNum}) AS stock_amt,
  0 AS stock_qty
FROM or_sales_mapped s
INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
INNER JOIN product_type_calc pt ON s.prdt_scs_cd = pt.prdt_scs_cd
WHERE pt.product_type = '${segmentType}'
GROUP BY s.prdt_scs_cd, p.prdt_nm_cn
HAVING stock_amt > 0
ORDER BY stock_amt DESC
LIMIT 100
      `;
    } else if (scopeType === 'warehouse') {
      // 창고재고 = 본사재고 - 직영판매예정분
      if (segmentType === 'core') {
        query = `
WITH 
${SHOP_MAPPING_CTES_3WAY},

-- 본사재고 (HQ + OR)
stock_raw AS (
  SELECT 
    s.prdt_scs_cd,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.stock_tag_amt_expected
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.yymm = '${monthYYYYMM}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

stock_mapped AS (
  SELECT 
    sr.*,
    COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) AS fr_or_cls
  FROM stock_raw sr
  LEFT JOIN map_norm mn ON sr.shop_id = mn.norm_key
  LEFT JOIN map_cn mc ON sr.shop_id = mc.cn_key
  LEFT JOIN map_internal mi ON sr.shop_id = mi.internal_key
  WHERE COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) IN ('OR', 'HQ')
),

-- product_type 계산
remark_map AS (
  SELECT 
    p.prdt_scs_cd,
    CASE
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 1 AND 3 THEN p.remark1
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 4 AND 6 THEN p.remark2
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 7 AND 9 THEN p.remark3
      ELSE p.remark4
    END AS op_std,
    p.sesn
  FROM FNF.CHN.MST_PRDT_SCS p
  WHERE p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

product_type_calc AS (
  SELECT
    prdt_scs_cd,
    CASE
      WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN NULLIF(COALESCE(op_std, sesn), '') IS NOT NULL 
        AND TRY_CAST(SUBSTRING(NULLIF(COALESCE(op_std, sesn), ''), 1, 2) AS INT) >= SUBSTRING('${monthYYYYMM}', 3, 2)::INT
      THEN 'core'
      ELSE 'outlet'
    END AS product_type
  FROM remark_map
),

hqor_stock AS (
  SELECT 
    s.prdt_scs_cd,
    p.prdt_nm_cn,
    SUM(s.stock_tag_amt_expected) AS stock_amt
  FROM stock_mapped s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN product_type_calc pt ON s.prdt_scs_cd = pt.prdt_scs_cd
  WHERE pt.product_type = 'core'
  GROUP BY s.prdt_scs_cd, p.prdt_nm_cn
),

-- OR 판매 (주력)
or_sales_raw AS (
  SELECT 
    s.prdt_scs_cd,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.tag_amt
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.sale_ym = '${monthYYYYMM}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

or_sales_mapped AS (
  SELECT 
    osr.*,
    sm.fr_or_cls
  FROM or_sales_raw osr
  LEFT JOIN map_norm sm ON osr.shop_id = sm.norm_key
  WHERE sm.fr_or_cls = 'OR'
),

or_sales AS (
  SELECT 
    s.prdt_scs_cd,
    SUM(s.tag_amt) AS sales_amt
  FROM or_sales_mapped s
  INNER JOIN product_type_calc pt ON s.prdt_scs_cd = pt.prdt_scs_cd
  WHERE pt.product_type = 'core'
  GROUP BY s.prdt_scs_cd
)

SELECT 
  prdt_scs_cd,
  prdt_nm_cn,
  stock_amt,
  stock_qty
FROM (
  SELECT 
    h.prdt_scs_cd,
    h.prdt_nm_cn,
    GREATEST(0, h.stock_amt - COALESCE((s.sales_amt / ${daysInMonth}) * 7 * ${stockWeekNum}, 0)) AS stock_amt,
    0 AS stock_qty
  FROM hqor_stock h
  LEFT JOIN or_sales s ON h.prdt_scs_cd = s.prdt_scs_cd
) sub
WHERE sub.stock_amt > 0
ORDER BY sub.stock_amt DESC
LIMIT 100
        `;
      } else {
        // 창고 아울렛 = 본사 아울렛 전체
        query = `
WITH 
${SHOP_MAPPING_CTES_3WAY},

stock_raw AS (
  SELECT 
    s.prdt_scs_cd,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.stock_tag_amt_expected,
    s.stock_qty_expected
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.yymm = '${monthYYYYMM}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

stock_mapped AS (
  SELECT 
    sr.*,
    COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) AS fr_or_cls
  FROM stock_raw sr
  LEFT JOIN map_norm mn ON sr.shop_id = mn.norm_key
  LEFT JOIN map_cn mc ON sr.shop_id = mc.cn_key
  LEFT JOIN map_internal mi ON sr.shop_id = mi.internal_key
  WHERE COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) IN ('OR', 'HQ')
),

remark_map AS (
  SELECT 
    p.prdt_scs_cd,
    CASE
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 1 AND 3 THEN p.remark1
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 4 AND 6 THEN p.remark2
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 7 AND 9 THEN p.remark3
      ELSE p.remark4
    END AS op_std,
    p.sesn
  FROM FNF.CHN.MST_PRDT_SCS p
  WHERE p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

product_type_calc AS (
  SELECT
    prdt_scs_cd,
    CASE
      WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN NULLIF(COALESCE(op_std, sesn), '') IS NOT NULL 
        AND TRY_CAST(SUBSTRING(NULLIF(COALESCE(op_std, sesn), ''), 1, 2) AS INT) >= SUBSTRING('${monthYYYYMM}', 3, 2)::INT
      THEN 'core'
      ELSE 'outlet'
    END AS product_type
  FROM remark_map
)

SELECT 
  s.prdt_scs_cd,
  p.prdt_nm_cn,
  SUM(s.stock_tag_amt_expected) AS stock_amt,
  SUM(s.stock_qty_expected) AS stock_qty
FROM stock_mapped s
INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
INNER JOIN product_type_calc pt ON s.prdt_scs_cd = pt.prdt_scs_cd
WHERE pt.product_type = 'outlet'
GROUP BY s.prdt_scs_cd, p.prdt_nm_cn
ORDER BY stock_amt DESC
LIMIT 100
        `;
      }
    } else {
      // total, frs, hqor
      let frOrClsFilter = '';
      if (scopeType === 'total') {
        frOrClsFilter = "IN ('FR', 'OR', 'HQ')";
      } else if (scopeType === 'frs') {
        frOrClsFilter = "= 'FR'";
      } else if (scopeType === 'hqor') {
        frOrClsFilter = "IN ('OR', 'HQ')";
      }

      query = `
WITH 
${SHOP_MAPPING_CTES_3WAY},

stock_raw AS (
  SELECT 
    s.prdt_scs_cd,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.stock_tag_amt_expected,
    s.stock_qty_expected
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.yymm = '${monthYYYYMM}'
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

stock_mapped AS (
  SELECT 
    sr.*,
    COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) AS fr_or_cls
  FROM stock_raw sr
  LEFT JOIN map_norm mn ON sr.shop_id = mn.norm_key
  LEFT JOIN map_cn mc ON sr.shop_id = mc.cn_key
  LEFT JOIN map_internal mi ON sr.shop_id = mi.internal_key
  WHERE COALESCE(mn.fr_or_cls, mc.fr_or_cls, mi.fr_or_cls) ${frOrClsFilter}
),

remark_map AS (
  SELECT 
    p.prdt_scs_cd,
    CASE
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 1 AND 3 THEN p.remark1
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 4 AND 6 THEN p.remark2
      WHEN SUBSTRING('${monthYYYYMM}', 5, 2)::INT BETWEEN 7 AND 9 THEN p.remark3
      ELSE p.remark4
    END AS op_std,
    p.sesn
  FROM FNF.CHN.MST_PRDT_SCS p
  WHERE p.parent_prdt_kind_cd = 'A'
    AND ${itemFilter}
),

product_type_calc AS (
  SELECT
    prdt_scs_cd,
    CASE
      WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN NULLIF(COALESCE(op_std, sesn), '') IS NOT NULL 
        AND TRY_CAST(SUBSTRING(NULLIF(COALESCE(op_std, sesn), ''), 1, 2) AS INT) >= SUBSTRING('${monthYYYYMM}', 3, 2)::INT
      THEN 'core'
      ELSE 'outlet'
    END AS product_type
  FROM remark_map
)

SELECT 
  s.prdt_scs_cd,
  p.prdt_nm_cn,
  SUM(s.stock_tag_amt_expected) AS stock_amt,
  SUM(s.stock_qty_expected) AS stock_qty
FROM stock_mapped s
INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
INNER JOIN product_type_calc pt ON s.prdt_scs_cd = pt.prdt_scs_cd
WHERE pt.product_type = '${segmentType}'
GROUP BY s.prdt_scs_cd, p.prdt_nm_cn
ORDER BY stock_amt DESC
LIMIT 100
      `;
    }

    console.log(`[inventory-scs-detail] Executing query for scope=${scopeType}, segment=${segmentType}`);
    
    const rows = await runQuery(query) as {
      PRDT_SCS_CD: string;
      PRDT_NM_CN?: string;
      STOCK_AMT: number;
      STOCK_QTY: number;
    }[];

    console.log(`[inventory-scs-detail] Query returned ${rows.length} rows`);

    const items = rows.map(row => ({
      prdt_scs_cd: row.PRDT_SCS_CD,
      prdt_nm_cn: row.PRDT_NM_CN,
      stock_amt: Math.round(row.STOCK_AMT),
      stock_qty: Math.round(row.STOCK_QTY),
    }));

    const totalAmt = items.reduce((sum, item) => sum + item.stock_amt, 0);
    const totalQty = items.reduce((sum, item) => sum + item.stock_qty, 0);

    console.log(`[inventory-scs-detail] Result: totalAmt=${totalAmt}, totalQty=${totalQty}, recordCount=${items.length}`);

    res.status(200).json({
      items,
      meta: {
        totalAmt,
        totalQty,
        recordCount: items.length,
      },
    });
  } catch (error) {
    console.error("[inventory-scs-detail] Error details:", {
      error,
      params: {
        brand: brandCode,
        month: monthYYYYMM,
        itemTab: itemCategory,
        scope: scopeType,
        segment: segmentType,
        stockWeek: stockWeekNum
      }
    });
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    res.status(500).json({ 
      error: "데이터를 불러오는데 실패했습니다.",
      details: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      params: { 
        brand: brandCode, 
        month: monthYYYYMM, 
        itemTab: itemCategory, 
        scope: scopeType, 
        segment: segmentType,
        stockWeek: stockWeekNum
      }
    });
  }
}

