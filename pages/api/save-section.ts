import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import {
  buildSalesAggregationQuery,
  buildInventoryAggregationQuery,
  generateMonths,
  getDaysInMonth,
} from "../../lib/snowflakeQueries";
import type { SalesBrandData, InventoryBrandData, ItemTab } from "../../src/types/sales";
import * as fs from "fs";
import * as path from "path";
import { fetchStagnantStockData } from "./stagnant-stock";
import { fetchShopStagnantStockData } from "./shop-stagnant-stock";
import type { ShopStagnantStockResponse } from "./shop-stagnant-stock";
import { fetchInventorySeasonChartData } from "./inventory-season-chart";
import type { DimensionTab, StagnantStockResponse } from "../../src/types/stagnantStock";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const BRAND_NAMES = ["MLB", "MLB KIDS", "DISCOVERY"] as const;
const BRAND_NAME_TO_CODE: Record<string, string> = { MLB: "M", "MLB KIDS": "I", DISCOVERY: "X" };
const BRAND_CODE_TO_NAME: Record<string, string> = { M: "MLB", I: "MLB KIDS", X: "DISCOVERY" };
const DIMENSION_TABS: DimensionTab[] = ["스타일", "컬러", "사이즈", "컬러&사이즈"];
const ITEM_TABS: ItemTab[] = ["전체", "Shoes", "Headwear", "Bag", "Acc_etc"];

// ── 유틸 ────────────────────────────────────────────────────────────────────

function readJsonSafe<T>(filename: string): T | null {
  try {
    const fp = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filename: string, data: unknown): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
}

// CSV에서 한글 대리상 이름 로드
function loadDealerKoreanNames(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const lines = fs.readFileSync(path.join(process.cwd(), "fr_master.csv"), "utf-8").split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(",");
      if (parts.length >= 3) map.set(parts[0].trim(), parts[2].trim());
    }
  } catch {}
  return map;
}

// ── 대리상 주력/아울렛 ────────────────────────────────────────────────────────

function calcStockWeeks(stock: number, sales: number, days: number): number | null {
  if (sales <= 0) return null;
  const weekSales = (sales / days) * 7;
  return weekSales <= 0 ? null : stock / weekSales;
}

async function fetchDealerData(
  brandCode: string,
  baseMonth: string,
  priorMonth: string,
  daysInMonth: number,
  dealerNames: Map<string, string>,
  referenceMonth?: string  // 기준월 (YYYYMM). 없으면 baseMonth 사용
) {
  // 기준월: 이 월은 MST 실시간, 25.12~기준월 미만은 PREP 익월
  const ref = referenceMonth || baseMonth;

  const productTypeSQL = `
    CASE
      WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN op_std IS NOT NULL AND TRY_TO_NUMBER(LEFT(op_std, 2)) IS NOT NULL
        AND TRY_TO_NUMBER(LEFT(op_std, 2)) >= TRY_TO_NUMBER(yy) THEN 'core'
      WHEN op_std IS NULL AND sesn IS NOT NULL
        AND TRY_TO_NUMBER(LEFT(sesn, 2)) IS NOT NULL
        AND TRY_TO_NUMBER(LEFT(sesn, 2)) >= TRY_TO_NUMBER(yy) THEN 'core'
      ELSE 'outlet'
    END`;

  // operate_standard 선택 CASE:
  //   yymm = ref → MST 실시간 (mst_operate_standard)
  //   25.12 <= yymm < ref → PREP 익월 (prep_operate_standard)
  //   24.01~25.11 → remark1~8
  const opStdCaseSQL = (ym: string) => `
    CASE
      WHEN '${ym}' = '${ref}' THEN mst_operate_standard
      WHEN '${ym}' >= '202512' AND '${ym}' < '${ref}' THEN prep_operate_standard
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=1 THEN remark1
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=2 THEN remark2
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=3 THEN remark3
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=4 THEN remark4
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=5 THEN remark5
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=6 THEN remark6
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=7 THEN remark7
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=8 THEN remark8
      ELSE NULL
    END`;

  const query = `
WITH
acc_item_map AS (
  SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG FROM FNF.PRCS.DB_PRDT
  WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
),
dealer_master AS (
  SELECT account_id, account_nm_en FROM CHN.MST_ACCOUNT
  WHERE account_id IS NOT NULL
),
shop_dealer_map AS (
  SELECT TO_VARCHAR(shop_id) AS shop_id, account_id
  FROM FNF.CHN.MST_SHOP_ALL
  WHERE fr_or_cls = 'FR' AND account_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER(PARTITION BY shop_id ORDER BY open_dt DESC NULLS LAST) = 1
),
stock_raw AS (
  SELECT s.yymm, TO_VARCHAR(s.shop_id) AS shop_id, s.prdt_scs_cd,
    COALESCE(s.stock_tag_amt_insp,0)+COALESCE(s.stock_tag_amt_frozen,0)+COALESCE(s.stock_tag_amt_expected,0) AS stock_amt,
    p.remark1,p.remark2,p.remark3,p.remark4,p.remark5,
    p.remark6,p.remark7,p.remark8,
    p.operate_standard AS mst_operate_standard,
    prep.operate_standard AS prep_operate_standard,
    p.sesn, m.prdt_nm
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN fnf.sap_fnf.mst_prdt m ON p.prdt_cd = m.prdt_cd
  LEFT JOIN CHN.PREP_MST_PRDT_SCS prep
    ON s.prdt_scs_cd = prep.prdt_scs_cd
    AND prep.yyyymm = CASE
      WHEN s.yymm >= '202512' AND s.yymm < '${ref}'
        THEN TO_VARCHAR(ADD_MONTHS(TO_DATE(s.yymm||'01','YYYYMMDD'),1),'YYYYMM')
      ELSE NULL
    END
  WHERE s.yymm IN ('${baseMonth}','${priorMonth}') AND s.brd_cd = '${brandCode}'
    AND db.PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
stock_with_segment AS (
  SELECT sr.yymm, sdm.account_id, sr.prdt_scs_cd, sr.prdt_nm, sr.stock_amt,
    CASE sr.yymm
      WHEN '${baseMonth}' THEN ${opStdCaseSQL(baseMonth)}
      WHEN '${priorMonth}' THEN ${opStdCaseSQL(priorMonth)}
      ELSE NULL
    END AS op_std,
    sr.sesn, SUBSTRING(sr.yymm, 3, 2) AS yy
  FROM stock_raw sr INNER JOIN shop_dealer_map sdm ON sr.shop_id = sdm.shop_id
),
stock_classified AS (
  SELECT yymm, account_id, prdt_scs_cd, prdt_nm, stock_amt,
    ${productTypeSQL} AS segment FROM stock_with_segment
),
sales_raw AS (
  SELECT TO_CHAR(s.sale_dt,'YYYYMM') AS yymm, TO_VARCHAR(s.shop_id) AS shop_id,
    s.prdt_scs_cd, s.tag_amt,
    p.remark1,p.remark2,p.remark3,p.remark4,p.remark5,
    p.remark6,p.remark7,p.remark8,
    p.operate_standard AS mst_operate_standard,
    prep.operate_standard AS prep_operate_standard,
    p.sesn
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN CHN.PREP_MST_PRDT_SCS prep
    ON s.prdt_scs_cd = prep.prdt_scs_cd
    AND prep.yyyymm = CASE
      WHEN TO_CHAR(s.sale_dt,'YYYYMM') >= '202512'
        AND TO_CHAR(s.sale_dt,'YYYYMM') < '${ref}'
        THEN TO_VARCHAR(ADD_MONTHS(TO_DATE(TO_CHAR(s.sale_dt,'YYYYMM')||'01','YYYYMMDD'),1),'YYYYMM')
      ELSE NULL
    END
  WHERE TO_CHAR(s.sale_dt,'YYYYMM') IN ('${baseMonth}','${priorMonth}') AND s.brd_cd = '${brandCode}'
    AND db.PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
sales_with_segment AS (
  SELECT sr.yymm, sdm.account_id, sr.prdt_scs_cd, sr.tag_amt,
    CASE sr.yymm
      WHEN '${baseMonth}' THEN ${opStdCaseSQL(baseMonth)}
      WHEN '${priorMonth}' THEN ${opStdCaseSQL(priorMonth)}
      ELSE NULL
    END AS op_std,
    sr.sesn, SUBSTRING(sr.yymm, 3, 2) AS yy
  FROM sales_raw sr INNER JOIN shop_dealer_map sdm ON sr.shop_id = sdm.shop_id
),
sales_classified AS (
  SELECT yymm, account_id, prdt_scs_cd, tag_amt,
    ${productTypeSQL} AS segment FROM sales_with_segment
),
stock_by_dealer AS (
  SELECT account_id,
    SUM(CASE WHEN yymm='${baseMonth}' THEN stock_amt ELSE 0 END) AS current_stock_total,
    SUM(CASE WHEN yymm='${baseMonth}' AND segment='core' THEN stock_amt ELSE 0 END) AS current_stock_core,
    SUM(CASE WHEN yymm='${baseMonth}' AND segment='outlet' THEN stock_amt ELSE 0 END) AS current_stock_outlet,
    SUM(CASE WHEN yymm='${priorMonth}' THEN stock_amt ELSE 0 END) AS prior_stock_total,
    SUM(CASE WHEN yymm='${priorMonth}' AND segment='core' THEN stock_amt ELSE 0 END) AS prior_stock_core,
    SUM(CASE WHEN yymm='${priorMonth}' AND segment='outlet' THEN stock_amt ELSE 0 END) AS prior_stock_outlet
  FROM stock_classified GROUP BY account_id
),
sales_by_dealer AS (
  SELECT account_id,
    SUM(CASE WHEN yymm='${baseMonth}' THEN tag_amt ELSE 0 END) AS current_sales_total,
    SUM(CASE WHEN yymm='${baseMonth}' AND segment='core' THEN tag_amt ELSE 0 END) AS current_sales_core,
    SUM(CASE WHEN yymm='${baseMonth}' AND segment='outlet' THEN tag_amt ELSE 0 END) AS current_sales_outlet,
    SUM(CASE WHEN yymm='${priorMonth}' THEN tag_amt ELSE 0 END) AS prior_sales_total,
    SUM(CASE WHEN yymm='${priorMonth}' AND segment='core' THEN tag_amt ELSE 0 END) AS prior_sales_core,
    SUM(CASE WHEN yymm='${priorMonth}' AND segment='outlet' THEN tag_amt ELSE 0 END) AS prior_sales_outlet
  FROM sales_classified GROUP BY account_id
),
dealer_agg AS (
  SELECT dm.account_id, dm.account_nm_en,
    COALESCE(st.current_stock_total,0) AS current_stock_total,
    COALESCE(sal.current_sales_total,0) AS current_sales_total,
    COALESCE(st.current_stock_core,0) AS current_stock_core,
    COALESCE(sal.current_sales_core,0) AS current_sales_core,
    COALESCE(st.current_stock_outlet,0) AS current_stock_outlet,
    COALESCE(sal.current_sales_outlet,0) AS current_sales_outlet,
    COALESCE(st.prior_stock_total,0) AS prior_stock_total,
    COALESCE(sal.prior_sales_total,0) AS prior_sales_total,
    COALESCE(st.prior_stock_core,0) AS prior_stock_core,
    COALESCE(sal.prior_sales_core,0) AS prior_sales_core,
    COALESCE(st.prior_stock_outlet,0) AS prior_stock_outlet,
    COALESCE(sal.prior_sales_outlet,0) AS prior_sales_outlet
  FROM dealer_master dm
  LEFT JOIN stock_by_dealer st ON dm.account_id = st.account_id
  LEFT JOIN sales_by_dealer sal ON dm.account_id = sal.account_id
  WHERE st.account_id IS NOT NULL OR sal.account_id IS NOT NULL
),
stock_by_product AS (
  SELECT account_id, prdt_scs_cd, MAX(prdt_nm) AS prdt_nm, segment,
    SUM(CASE WHEN yymm='${baseMonth}' THEN stock_amt ELSE 0 END) AS current_stock_amt,
    SUM(CASE WHEN yymm='${priorMonth}' THEN stock_amt ELSE 0 END) AS prior_stock_amt
  FROM stock_classified GROUP BY account_id, prdt_scs_cd, segment
),
sales_by_product AS (
  SELECT account_id, prdt_scs_cd, segment,
    SUM(CASE WHEN yymm='${baseMonth}' THEN tag_amt ELSE 0 END) AS current_sales_amt,
    SUM(CASE WHEN yymm='${priorMonth}' THEN tag_amt ELSE 0 END) AS prior_sales_amt
  FROM sales_classified GROUP BY account_id, prdt_scs_cd, segment
),
product_agg AS (
  SELECT dm.account_id, dm.account_nm_en,
    st.prdt_scs_cd, st.prdt_nm, st.segment,
    COALESCE(st.current_stock_amt,0) AS current_stock_amt,
    COALESCE(sal.current_sales_amt,0) AS current_sales_amt,
    COALESCE(st.prior_stock_amt,0) AS prior_stock_amt,
    COALESCE(sal.prior_sales_amt,0) AS prior_sales_amt
  FROM dealer_master dm
  INNER JOIN stock_by_product st ON dm.account_id = st.account_id
  LEFT JOIN sales_by_product sal
    ON st.account_id = sal.account_id
    AND st.prdt_scs_cd = sal.prdt_scs_cd
    AND st.segment = sal.segment
  WHERE st.current_stock_amt > 0 OR st.prior_stock_amt > 0
)
SELECT 'dealer' AS record_type, account_id, account_nm_en,
  current_stock_total, current_sales_total,
  current_stock_core, current_sales_core,
  current_stock_outlet, current_sales_outlet,
  prior_stock_total, prior_sales_total,
  prior_stock_core, prior_sales_core,
  prior_stock_outlet, prior_sales_outlet,
  NULL AS prdt_scs_cd, NULL AS prdt_nm, NULL AS segment,
  NULL AS current_stock_amt, NULL AS current_sales_amt,
  NULL AS prior_stock_amt, NULL AS prior_sales_amt
FROM dealer_agg
UNION ALL
SELECT 'product' AS record_type, account_id, account_nm_en,
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
  prdt_scs_cd, prdt_nm, segment,
  current_stock_amt, current_sales_amt,
  prior_stock_amt, prior_sales_amt
FROM product_agg
ORDER BY record_type, account_id, prdt_scs_cd
  `;

  const rows = await runQuery(query) as any[];

  const dealers: any[] = [];
  const products: any[] = [];
  rows.forEach((r: any) => {
    if ((r.RECORD_TYPE || r.record_type) === "dealer") {
      dealers.push({
        account_id: r.ACCOUNT_ID || r.account_id,
        account_nm_en: r.ACCOUNT_NM_EN || r.account_nm_en,
        account_nm_kr: dealerNames.get(r.ACCOUNT_ID || r.account_id) || "",
        current: {
          total: { stock_amt: r.CURRENT_STOCK_TOTAL || 0, sales_amt: r.CURRENT_SALES_TOTAL || 0, stock_weeks: calcStockWeeks(r.CURRENT_STOCK_TOTAL || 0, r.CURRENT_SALES_TOTAL || 0, daysInMonth) },
          core:  { stock_amt: r.CURRENT_STOCK_CORE  || 0, sales_amt: r.CURRENT_SALES_CORE  || 0, stock_weeks: calcStockWeeks(r.CURRENT_STOCK_CORE  || 0, r.CURRENT_SALES_CORE  || 0, daysInMonth) },
          outlet:{ stock_amt: r.CURRENT_STOCK_OUTLET|| 0, sales_amt: r.CURRENT_SALES_OUTLET|| 0, stock_weeks: calcStockWeeks(r.CURRENT_STOCK_OUTLET|| 0, r.CURRENT_SALES_OUTLET|| 0, daysInMonth) },
        },
        prior: {
          total: { stock_amt: r.PRIOR_STOCK_TOTAL || 0, sales_amt: r.PRIOR_SALES_TOTAL || 0, stock_weeks: calcStockWeeks(r.PRIOR_STOCK_TOTAL || 0, r.PRIOR_SALES_TOTAL || 0, daysInMonth) },
          core:  { stock_amt: r.PRIOR_STOCK_CORE  || 0, sales_amt: r.PRIOR_SALES_CORE  || 0, stock_weeks: calcStockWeeks(r.PRIOR_STOCK_CORE  || 0, r.PRIOR_SALES_CORE  || 0, daysInMonth) },
          outlet:{ stock_amt: r.PRIOR_STOCK_OUTLET || 0, sales_amt: r.PRIOR_SALES_OUTLET || 0, stock_weeks: calcStockWeeks(r.PRIOR_STOCK_OUTLET || 0, r.PRIOR_SALES_OUTLET || 0, daysInMonth) },
        },
      });
    } else {
      products.push({
        account_id: r.ACCOUNT_ID || r.account_id,
        account_nm_en: r.ACCOUNT_NM_EN || r.account_nm_en,
        account_nm_kr: dealerNames.get(r.ACCOUNT_ID || r.account_id) || "",
        prdt_scs_cd: r.PRDT_SCS_CD || r.prdt_scs_cd,
        prdt_nm: r.PRDT_NM || r.prdt_nm,
        segment: r.SEGMENT || r.segment,
        current: { stock_amt: r.CURRENT_STOCK_AMT || 0, sales_amt: r.CURRENT_SALES_AMT || 0, stock_weeks: calcStockWeeks(r.CURRENT_STOCK_AMT || 0, r.CURRENT_SALES_AMT || 0, daysInMonth) },
        prior:   { stock_amt: r.PRIOR_STOCK_AMT   || 0, sales_amt: r.PRIOR_SALES_AMT   || 0, stock_weeks: calcStockWeeks(r.PRIOR_STOCK_AMT   || 0, r.PRIOR_SALES_AMT   || 0, daysInMonth) },
      });
    }
  });

  return { dealers, products, meta: { baseMonth, priorMonth, daysInMonth } };
}

// ── 판매/재고 처리 ───────────────────────────────────────────────────────────

function emptySalesMonthData() {
  return { 전체_core: 0, 전체_outlet: 0, FRS_core: 0, FRS_outlet: 0, OR_core: 0, OR_outlet: 0 };
}

function processSalesRows(rows: any[]): {
  byBrand: Record<string, SalesBrandData>;
  months: string[];
  daysInMonth: Record<string, number>;
} {
  const byBrand: Record<string, SalesBrandData> = {};
  const monthsSet = new Set<string>();
  const daysInMonthMap: Record<string, number> = {};

  for (const brandName of BRAND_NAMES) {
    byBrand[brandName] = { 전체: {}, Shoes: {}, Headwear: {}, Bag: {}, Acc_etc: {} };
  }

  for (const row of rows) {
    const saleYm: string = row.SALE_YM ?? row.sale_ym;
    const itemCat: string = row.ITEM_CATEGORY ?? row.item_category;
    const channel: string = row.CHANNEL ?? row.channel;
    const productType: string = row.PRODUCT_TYPE ?? row.product_type;
    const totalAmt = Number(row.TOTAL_AMT ?? row.total_amt) || 0;
    const brdCd: string = row.BRD_CD ?? row.brd_cd;
    const brandName = BRAND_CODE_TO_NAME[brdCd];
    if (!brandName) continue;

    monthsSet.add(saleYm);
    const yyyymm = saleYm.replace(".", "");
    if (!daysInMonthMap[saleYm]) daysInMonthMap[saleYm] = getDaysInMonth(yyyymm);

    const bd = byBrand[brandName];
    if (!bd["전체"][saleYm]) bd["전체"][saleYm] = emptySalesMonthData();
    if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat)) {
      const cat = itemCat as ItemTab;
      if (!bd[cat][saleYm]) bd[cat][saleYm] = emptySalesMonthData();
    }

    const isCore = productType === "core";
    const totalKey = isCore ? "전체_core" : "전체_outlet";
    const frKey   = isCore ? "FRS_core"   : "FRS_outlet";
    const orKey   = isCore ? "OR_core"    : "OR_outlet";

    (bd["전체"][saleYm] as any)[totalKey] += totalAmt;
    if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat)) {
      (bd[itemCat as ItemTab][saleYm] as any)[totalKey] += totalAmt;
    }
    if (channel === "FR") {
      (bd["전체"][saleYm] as any)[frKey] += totalAmt;
      if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat))
        (bd[itemCat as ItemTab][saleYm] as any)[frKey] += totalAmt;
    } else if (channel === "OR") {
      (bd["전체"][saleYm] as any)[orKey] += totalAmt;
      if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat))
        (bd[itemCat as ItemTab][saleYm] as any)[orKey] += totalAmt;
    }
  }

  return { byBrand, months: Array.from(monthsSet).sort(), daysInMonth: daysInMonthMap };
}

function emptyInventoryMonthData() {
  return { 전체_core: 0, 전체_outlet: 0, FRS_core: 0, FRS_outlet: 0, HQ_OR_core: 0, HQ_OR_outlet: 0, OR_sales_core: 0, OR_sales_outlet: 0 };
}

function processInventoryRows(rows: any[]): {
  byBrand: Record<string, InventoryBrandData>;
  months: string[];
  daysInMonth: Record<string, number>;
} {
  const byBrand: Record<string, InventoryBrandData> = {};
  const monthsSet = new Set<string>();
  const daysInMonthMap: Record<string, number> = {};

  for (const brandName of BRAND_NAMES) {
    byBrand[brandName] = { 전체: {}, Shoes: {}, Headwear: {}, Bag: {}, Acc_etc: {} };
  }

  for (const row of rows) {
    const yyyymmRaw: string = row.YYMM ?? row.yymm;
    const saleYm = `${yyyymmRaw.slice(0, 4)}.${yyyymmRaw.slice(4, 6)}`;
    const itemCat: string = row.ITEM_CATEGORY ?? row.item_category;
    const channel: string = row.CHANNEL ?? row.channel;
    const productType: string = row.PRODUCT_TYPE ?? row.product_type;
    const totalAmt = Number(row.TOTAL_AMT ?? row.total_amt) || 0;
    const brdCd: string = row.BRD_CD ?? row.brd_cd;
    const brandName = BRAND_CODE_TO_NAME[brdCd];
    if (!brandName) continue;

    monthsSet.add(saleYm);
    if (!daysInMonthMap[saleYm]) daysInMonthMap[saleYm] = getDaysInMonth(yyyymmRaw);

    const bd = byBrand[brandName];
    if (!bd["전체"][saleYm]) bd["전체"][saleYm] = emptyInventoryMonthData();
    if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat)) {
      const cat = itemCat as ItemTab;
      if (!bd[cat][saleYm]) bd[cat][saleYm] = emptyInventoryMonthData();
    }

    const isCore = productType === "core";
    const totalKey = isCore ? "전체_core"   : "전체_outlet";
    const frKey    = isCore ? "FRS_core"    : "FRS_outlet";
    const hqOrKey  = isCore ? "HQ_OR_core"  : "HQ_OR_outlet";

    (bd["전체"][saleYm] as any)[totalKey] += totalAmt;
    if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat))
      (bd[itemCat as ItemTab][saleYm] as any)[totalKey] += totalAmt;

    if (channel === "FR") {
      (bd["전체"][saleYm] as any)[frKey] += totalAmt;
      if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat))
        (bd[itemCat as ItemTab][saleYm] as any)[frKey] += totalAmt;
    } else if (channel === "OR" || channel === "HQ") {
      (bd["전체"][saleYm] as any)[hqOrKey] += totalAmt;
      if (["Shoes", "Headwear", "Bag", "Acc_etc"].includes(itemCat))
        (bd[itemCat as ItemTab][saleYm] as any)[hqOrKey] += totalAmt;
    }
  }

  return { byBrand, months: Array.from(monthsSet).sort(), daysInMonth: daysInMonthMap };
}

// ── 실제입고 저장 ─────────────────────────────────────────────────────────────

async function saveArrivalData(
  referenceMonth: string,
  startMonth: string,
  brdCd: string,
  brandName: string
): Promise<void> {
  // "2025.12" → 정수 YYYYMM 목록 직접 생성 (generateMonths는 점(.) 형식 반환으로 부적합)
  const [startYear, startMonthNum] = startMonth.split(".").map(Number);
  const [endYear, endMonthNum] = referenceMonth.split(".").map(Number);

  const yyyymmList: number[] = [];
  const monthKeys: string[] = [];

  let y = startYear, mo = startMonthNum;
  while (y < endYear || (y === endYear && mo <= endMonthNum)) {
    yyyymmList.push(y * 100 + mo);                                  // 202512 (정수)
    monthKeys.push(`${y}.${String(mo).padStart(2, "0")}`);          // "2025.12"
    if (++mo > 12) { mo = 1; y++; }
  }

  const pivotColumns = yyyymmList.join(", ");

  const selectCols = yyyymmList
    .map((ym, i) => `NVL("${ym}", 0) AS "${monthKeys[i]}"`)
    .join(", ");

  const sql = `
WITH acc_item_map AS (
  SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG FROM FNF.PRCS.DB_PRDT
  WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC' AND PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
base AS (
  SELECT a.yyyymm,
    CASE WHEN db.PRDT_KIND_NM_ENG='Shoes'   THEN '신발'
         WHEN db.PRDT_KIND_NM_ENG='Headwear' THEN '모자'
         WHEN db.PRDT_KIND_NM_ENG='Bag'      THEN '가방'
         WHEN db.PRDT_KIND_NM_ENG='Acc_etc'  THEN '기타악세'
    END AS item,
    a.stor_amt AS in_stock_amt
  FROM sap_fnf.dw_cn_ivtr_prdt_m a
  JOIN acc_item_map db ON SUBSTR(a.prdt_cd, 7, 2) = db.ITEM
  WHERE a.brd_cd = '${brdCd}' AND a.yyyymm IN (${pivotColumns})
),
agg AS (
  SELECT CASE WHEN GROUPING(item)=1 THEN '합계' ELSE item END AS item,
    yyyymm, SUM(in_stock_amt) AS in_stock_amt
  FROM base GROUP BY GROUPING SETS ((item, yyyymm), (yyyymm))
),
pv AS (SELECT * FROM agg PIVOT (SUM(in_stock_amt) FOR yyyymm IN (${pivotColumns})))
SELECT item, ${selectCols} FROM pv
ORDER BY CASE item WHEN '합계' THEN 0 WHEN '신발' THEN 1 WHEN '모자' THEN 2 WHEN '가방' THEN 3 WHEN '기타악세' THEN 4 ELSE 99 END`;

  const rows = await runQuery(sql) as any[];

  // 한글 item → 영문 key
  const itemKeyMap: Record<string, string> = { 신발: "Shoes", 모자: "Headwear", 가방: "Bag", 기타악세: "Acc_etc" };

  // 기존 JSON 읽기
  const existing = readJsonSafe<{ brands: Record<string, Record<string, Record<string, number>>> }>(
    "accessory_actual_arrival_summary.json"
  ) || { brands: {} };
  if (!existing.brands[brandName]) existing.brands[brandName] = {};

  for (const row of rows) {
    const item = row.ITEM ?? row.item;
    if (item === "합계") continue;
    const itemKey = itemKeyMap[item];
    if (!itemKey) continue;

    for (let i = 0; i < monthKeys.length; i++) {
      const mk = monthKeys[i]; // "2025.11"
      const val = Number(row[mk]) || 0;
      if (!existing.brands[brandName][mk]) existing.brands[brandName][mk] = {};
      existing.brands[brandName][mk][itemKey] = val;
    }
  }

  writeJson("accessory_actual_arrival_summary.json", existing);
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; message: string } | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { section, referenceMonth, recalcType = "current" } = req.body as {
    section: "dealer" | "sales" | "stagnant" | "arrival";
    referenceMonth: string;
    recalcType?: "current" | "full";
  };

  if (!section) return res.status(400).json({ error: "section is required" });
  if (!referenceMonth || !/^\d{4}\.\d{2}$/.test(referenceMonth))
    return res.status(400).json({ error: "referenceMonth must be YYYY.MM format" });

  const yyyymm = referenceMonth.replace(".", "");
  const year = parseInt(yyyymm.slice(0, 4));
  const priorYear = year - 1;
  const priorMonth = `${priorYear}${yyyymm.slice(4, 6)}`;
  const daysInMonthVal = getDaysInMonth(yyyymm);

  console.log(`[save-section] section=${section}, referenceMonth=${referenceMonth}, recalcType=${recalcType}`);

  try {
    // ── (1) DEALER ────────────────────────────────────────────────────────────
    if (section === "dealer") {
      const dealerNames = loadDealerKoreanNames();
      const existing = readJsonSafe<{ brands: Record<string, Record<string, any>> }>(
        "dealer_core_outlet_summary.json"
      ) || { brands: {} };

      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        console.log(`[save-section] dealer: fetching ${brandName} for ${referenceMonth}...`);
        // yyyymm = baseMonth = referenceMonth (save-section은 단월 저장)
        const data = await fetchDealerData(brandCode, yyyymm, priorMonth, daysInMonthVal, dealerNames, yyyymm);
        if (!existing.brands[brandName]) existing.brands[brandName] = {};
        existing.brands[brandName][yyyymm] = data;
      }

      writeJson("dealer_core_outlet_summary.json", existing);
      return res.status(200).json({ success: true, message: `${referenceMonth} 대리상 주력/아울렛 데이터 저장 완료` });
    }

    // ── (2) STAGNANT ──────────────────────────────────────────────────────────
    if (section === "stagnant") {
      // 2a. 정체재고 summary
      const existingStagnant = readJsonSafe<{
        brands: Record<string, Record<string, Record<string, StagnantStockResponse>>>;
      }>("stagnant_stock_summary.json") || { brands: {} };

      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        if (!existingStagnant.brands[brandCode]) existingStagnant.brands[brandCode] = {};
        if (!existingStagnant.brands[brandCode][yyyymm])
          existingStagnant.brands[brandCode][yyyymm] = {} as Record<string, StagnantStockResponse>;

        for (const dimTab of DIMENSION_TABS) {
          console.log(`[save-section] stagnant: ${brandName}/${dimTab}...`);
          try {
            // includeAccountBreakdown: true로 저장하여 대리상단위 정체재고 분석에서 사용 가능하도록 함
            const data = await fetchStagnantStockData(brandCode, yyyymm, dimTab, 0.01, 10, 10, true, false);
            existingStagnant.brands[brandCode][yyyymm][dimTab] = data;
            console.log(`[save-section] stagnant 저장 완료: brandCode="${brandCode}", yyyymm="${yyyymm}", dimTab="${dimTab}", accountBreakdown=${data.accountBreakdown?.length || 0}개`);
          } catch (err) {
            console.error(`[save-section] stagnant error ${brandName}/${dimTab}:`, err);
          }
        }
      }
      writeJson("stagnant_stock_summary.json", existingStagnant);
      console.log(`[save-section] stagnant_stock_summary.json 저장 완료. 저장된 브랜드: [${Object.keys(existingStagnant.brands).join(", ")}]`);

      // 2b. 직영매장 정체재고
      const existingShop = readJsonSafe<{
        brands: Record<string, Record<string, ShopStagnantStockResponse>>;
      }>("shop_stagnant_stock_summary.json") || { brands: {} };

      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        console.log(`[save-section] shop stagnant: ${brandName}...`);
        try {
          const data = await fetchShopStagnantStockData(brandCode, yyyymm, 0.01);
          if (!existingShop.brands[brandCode]) existingShop.brands[brandCode] = {};
          existingShop.brands[brandCode][yyyymm] = data;
        } catch (err) {
          console.error(`shop stagnant error ${brandName}:`, err);
        }
      }
      writeJson("shop_stagnant_stock_summary.json", existingShop);

      // 2c. 재고 시즌 차트
      const existingChart = readJsonSafe<{
        brands: Record<string, Record<string, any>>;
      }>("inventory_season_chart_summary.json") || { brands: {} };

      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        console.log(`[save-section] season chart: ${brandName} (${recalcType})...`);
        try {
          const chartData = await fetchInventorySeasonChartData(
            brandCode, referenceMonth, 0.01, "컬러&사이즈", "ACC합계", 10, 10
          );
          if (!existingChart.brands[brandCode]) existingChart.brands[brandCode] = {};
          const allMonths = [...(chartData.year2024 || []), ...(chartData.year2025 || [])];

          if (recalcType === "full") {
            for (const monthData of allMonths) {
              existingChart.brands[brandCode][monthData.month] = monthData;
            }
          } else {
            const refEntry = allMonths.find((m) => m.month === yyyymm);
            if (refEntry) existingChart.brands[brandCode][yyyymm] = refEntry;
          }
        } catch (err) {
          console.error(`season chart error ${brandName}:`, err);
        }
      }
      writeJson("inventory_season_chart_summary.json", existingChart);

      return res.status(200).json({ success: true, message: `${referenceMonth} 정체재고 데이터 저장 완료` });
    }

    // ── (3) SALES ─────────────────────────────────────────────────────────────
    if (section === "sales") {
      const startMm = recalcType === "full" ? "202401" : yyyymm;

      // 판매
      const existingSales = recalcType === "full"
        ? { brands: {} as Record<string, SalesBrandData>, months: [] as string[], daysInMonth: {} as Record<string, number> }
        : readJsonSafe<{ brands: Record<string, SalesBrandData>; months: string[]; daysInMonth: Record<string, number> }>(
            "accessory_sales_summary.json"
          ) || { brands: {}, months: [], daysInMonth: {} };

      const salesRows: any[] = [];
      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        console.log(`[save-section] sales: ${brandName} ${startMm}~${yyyymm}...`);
        const q = buildSalesAggregationQuery(brandCode, startMm, yyyymm, yyyymm);
        salesRows.push(...(await runQuery(q) as any[]));
      }

      const { byBrand: newSales, months: newMonths, daysInMonth: newDays } = processSalesRows(salesRows);

      for (const brandName of BRAND_NAMES) {
        if (!existingSales.brands[brandName])
          existingSales.brands[brandName] = { 전체: {}, Shoes: {}, Headwear: {}, Bag: {}, Acc_etc: {} };
        for (const tab of ITEM_TABS) {
          if (!existingSales.brands[brandName][tab]) existingSales.brands[brandName][tab] = {};
          Object.assign(existingSales.brands[brandName][tab], newSales[brandName]?.[tab] || {});
        }
      }

      const allMonthsSet = new Set([...existingSales.months, ...newMonths]);
      existingSales.months = Array.from(allMonthsSet).sort();
      Object.assign(existingSales.daysInMonth, newDays);
      writeJson("accessory_sales_summary.json", existingSales);

      // 재고
      const existingInventory = recalcType === "full"
        ? { brands: {} as Record<string, InventoryBrandData>, months: [] as string[], daysInMonth: {} as Record<string, number> }
        : readJsonSafe<{ brands: Record<string, InventoryBrandData>; months: string[]; daysInMonth: Record<string, number> }>(
            "accessory_inventory_summary.json"
          ) || { brands: {}, months: [], daysInMonth: {} };

      const inventoryRows: any[] = [];
      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        console.log(`[save-section] inventory: ${brandName} ${startMm}~${yyyymm}...`);
        const q = buildInventoryAggregationQuery(brandCode, startMm, yyyymm, yyyymm);
        inventoryRows.push(...(await runQuery(q) as any[]));
      }

      const { byBrand: newInv, months: newInvMonths, daysInMonth: newInvDays } = processInventoryRows(inventoryRows);

      for (const brandName of BRAND_NAMES) {
        if (!existingInventory.brands[brandName])
          existingInventory.brands[brandName] = { 전체: {}, Shoes: {}, Headwear: {}, Bag: {}, Acc_etc: {} };
        for (const tab of ITEM_TABS) {
          if (!existingInventory.brands[brandName][tab]) existingInventory.brands[brandName][tab] = {};
          Object.assign(existingInventory.brands[brandName][tab], newInv[brandName]?.[tab] || {});
        }
      }

      const allInvMonthsSet = new Set([...existingInventory.months, ...newInvMonths]);
      existingInventory.months = Array.from(allInvMonthsSet).sort();
      Object.assign(existingInventory.daysInMonth, newInvDays);
      writeJson("accessory_inventory_summary.json", existingInventory);

      return res.status(200).json({ success: true, message: `${referenceMonth} 판매/재고 데이터 저장 완료` });
    }

    // ── (4) ARRIVAL ───────────────────────────────────────────────────────────
    if (section === "arrival") {
      const startMonth = recalcType === "full" ? "2024.01" : referenceMonth;

      for (const brandName of BRAND_NAMES) {
        const brandCode = BRAND_NAME_TO_CODE[brandName];
        console.log(`[save-section] arrival: ${brandName} ${startMonth}~${referenceMonth}...`);
        await saveArrivalData(referenceMonth, startMonth, brandCode, brandName);
      }

      return res.status(200).json({ success: true, message: `${referenceMonth} 실제입고 데이터 저장 완료` });
    }

    return res.status(400).json({ error: `Unknown section: ${section}` });
  } catch (error) {
    console.error("[save-section] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
