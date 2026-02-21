import type { NextApiRequest, NextApiResponse } from "next";
import { BRAND_CODE_MAP } from "../../src/types/stagnantStock";
import * as fs from 'fs';
import * as path from 'path';
import { readBatchJsonFile } from "../../src/lib/batchDataLoader";
import { runQuery } from "../../lib/snowflake";

// 브랜드 코드 → 브랜드 이름 역변환 매핑 (JSON 저장 시 브랜드 이름을 키로 사용하므로)
const BRAND_CODE_TO_NAME: Record<string, string> = {
  "M": "MLB",
  "I": "MLB KIDS",
  "X": "DISCOVERY",
};

interface DealerSegmentData {
  stock_amt: number;
  sales_amt: number;
  stock_weeks: number | null;
}

interface DealerData {
  account_id: string;
  account_nm_en: string;
  account_nm_kr: string;
  current: {
    total: DealerSegmentData;
    core: DealerSegmentData;
    outlet: DealerSegmentData;
  };
  prior: {
    total: DealerSegmentData;
    core: DealerSegmentData;
    outlet: DealerSegmentData;
  };
}

interface ProductData {
  account_id: string;
  account_nm_en: string;
  account_nm_kr: string;
  prdt_scs_cd: string;
  prdt_nm: string;
  segment: 'core' | 'outlet';
  current: DealerSegmentData;
  prior: DealerSegmentData;
}

interface ApiResponse {
  dealers: DealerData[];
  products: ProductData[];
  meta: {
    baseMonth: string;
    priorMonth: string;
    daysInMonth: number;
    dataSource?: 'json' | 'snowflake'; // 조회 소스 정보
  };
}

// 재고주수 계산 함수
function calcStockWeeks(stockAmt: number, salesAmt: number, daysInMonth: number): number | null {
  if (salesAmt <= 0) return null;
  const weekSales = (salesAmt / daysInMonth) * 7;
  if (weekSales <= 0) return null;
  return stockAmt / weekSales;
}

// CSV에서 한글 이름 로드
function loadDealerKoreanNames(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const csvPath = path.join(process.cwd(), 'fr_master.csv');
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvData.split('\n');
    
    // 첫 줄은 헤더이므로 skip
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // CSV 파싱 (쉼표로 구분)
      const parts = line.split(',');
      if (parts.length >= 3) {
        const accountId = parts[0].trim();
        const accountNmKr = parts[2].trim();
        map.set(accountId, accountNmKr);
      }
    }
    console.log(`Loaded ${map.size} dealer Korean names from CSV`);
  } catch (error) {
    console.error('Failed to load fr_master.csv:', error);
  }
  return map;
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, baseMonth, category } = req.query;

  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }

  if (!baseMonth || typeof baseMonth !== "string" || !/^\d{6}$/.test(baseMonth)) {
    return res.status(400).json({ error: "baseMonth must be YYYYMM format" });
  }

  // category 검증
  const validCategories = ['all', 'shoes', 'headwear', 'bag', 'acc_etc'];
  const selectedCategory = category && typeof category === 'string' && validCategories.includes(category) 
    ? category 
    : 'all';

  // 브랜드 파라미터가 코드인지 이름인지 확인하고, 코드면 이름으로 변환
  // save-section.ts는 브랜드 이름을 키로 저장하므로, 조회 시에도 브랜드 이름을 사용해야 함
  const brandCode = BRAND_CODE_MAP[brand as keyof typeof BRAND_CODE_MAP] || brand;
  const brandName = BRAND_CODE_TO_NAME[brand] || brand; // 코드면 이름으로 변환, 아니면 그대로 사용
  
  // CSV에서 한글 이름 로드
  const dealerKoreanNames = loadDealerKoreanNames();
  
  // 전년동월 계산 (YYYYMM - 100)
  const baseYear = parseInt(baseMonth.substring(0, 4));
  const baseMonthNum = baseMonth.substring(4, 6);
  const priorMonth = `${baseYear - 1}${baseMonthNum}`;

  // 당월 일수 계산
  const year = parseInt(baseMonth.substring(0, 4));
  const month = parseInt(baseMonth.substring(4, 6));
  const daysInMonth = new Date(year, month, 0).getDate();

  // 기준월을 "YYYY.MM" 형식으로 변환
  const baseMonthFormatted = `${baseMonth.substring(0, 4)}.${baseMonth.substring(4, 6)}`;

  try {
    // JSON 파일 먼저 확인 (마감 여부와 관계없이)
    interface DealerCoreOutletSummaryData {
      brands: {
        [brand: string]: {
          [baseMonth: string]: ApiResponse;
        };
      };
    }
    
    // JSON 파일이 없을 경우를 대비해 try-catch로 감싸기
    let jsonData: DealerCoreOutletSummaryData | null = null;
    try {
      jsonData = readBatchJsonFile<DealerCoreOutletSummaryData>("dealer_core_outlet_summary.json");
    } catch {
      console.warn(`[dealer-core-outlet] dealer_core_outlet_summary.json 파일 없음 → Snowflake 실시간 조회로 전환`);
      jsonData = null;
    }
    // 브랜드 이름으로 조회 (save-section.ts가 브랜드 이름을 키로 저장)
    const hasJsonData = jsonData?.brands?.[brandName]?.[baseMonth];
    
    // JSON에 데이터가 있으면 JSON에서 읽기
    if (hasJsonData) {
      console.log(`[dealer-core-outlet] 기준월(${baseMonthFormatted}) JSON 파일에서 데이터를 읽습니다. (brand: ${brandName})`);
      let response = jsonData.brands[brandName][baseMonth];
      
      // 카테고리 필터링 (products 배열이 너무 클 수 있으므로)
      if (selectedCategory !== 'all' && response.products) {
        // ITEM 코드 → 카테고리 매핑 (prdt_scs_cd의 7-8번째 문자)
        const categoryMap: Record<string, string> = {
          'shoes': 'Shoes',
          'headwear': 'Headwear',
          'bag': 'Bag',
          'acc_etc': 'Acc_etc',
        };
        
        const targetCategory = categoryMap[selectedCategory];
        if (targetCategory) {
          // prdt_scs_cd의 7-8번째 문자를 추출하여 카테고리 매핑
          // 실제로는 DB_PRDT 테이블을 조회해야 정확하지만, 
          // 여기서는 간단히 필터링만 하고, 정확한 필터링은 전처리 스크립트에서 처리
          // 일단 products 배열을 제한하여 응답 크기 문제를 해결
          const filteredProducts = response.products.slice(0, 50000); // 최대 5만개로 제한
          response = {
            ...response,
            products: filteredProducts,
          };
          console.log(`[dealer-core-outlet] products 배열 크기 제한: ${response.products.length}개`);
        }
      } else if (response.products && response.products.length > 50000) {
        // 'all' 카테고리일 때도 크기 제한
        response = {
          ...response,
          products: response.products.slice(0, 50000),
        };
        console.log(`[dealer-core-outlet] products 배열 크기 제한: ${response.products.length}개`);
      }
      
      // 조회 소스 정보 추가
      response.meta.dataSource = 'json';
      res.status(200).json(response);
      return;
    }

    // JSON에 데이터가 없으면 Snowflake에서 실시간 조회
    console.log(`[dealer-core-outlet] 기준월(${baseMonthFormatted}) JSON에 데이터 없음 → Snowflake 실시간 조회`);
    const dealerNames = loadDealerKoreanNames();
    const liveData = await fetchDealerDataFromSnowflake(brand, baseMonth, priorMonth, daysInMonth, dealerNames);
    liveData.meta.dataSource = 'snowflake';
    res.status(200).json(liveData);
    return;
  } catch (error) {
    console.error("dealer-core-outlet API error:", error);
    res.status(500).json({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) });
  }
}

// ── Snowflake 실시간 조회 ─────────────────────────────────────────────────────

async function fetchDealerDataFromSnowflake(
  brandCode: string,
  baseMonth: string,
  priorMonth: string,
  daysInMonth: number,
  dealerNames: Map<string, string>
): Promise<ApiResponse> {
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

  const remarkCaseSQL = (ym: string) => `
    CASE
      WHEN '${ym}' >= '202512' THEN operate_standard
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=1 THEN remark1
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=2 THEN remark2
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=3 THEN remark3
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=4 THEN remark4
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=5 THEN remark5
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=6 THEN remark6
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=7 THEN remark7
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=8 THEN remark8
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=9 THEN remark9
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=10 THEN remark10
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=11 THEN remark11
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=12 THEN remark12
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=13 THEN remark13
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=14 THEN remark14
      WHEN (FLOOR(DATEDIFF('month',TO_DATE('202312','YYYYMM'),TO_DATE('${ym}01','YYYYMMDD'))/3)+1)=15 THEN remark15
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
    p.operate_standard,
    p.remark1,p.remark2,p.remark3,p.remark4,p.remark5,
    p.remark6,p.remark7,p.remark8,p.remark9,p.remark10,
    p.remark11,p.remark12,p.remark13,p.remark14,p.remark15,
    p.sesn, m.prdt_nm
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  LEFT JOIN fnf.sap_fnf.mst_prdt m ON p.prdt_cd = m.prdt_cd
  WHERE s.yymm IN ('${baseMonth}','${priorMonth}') AND s.brd_cd = '${brandCode}'
    AND db.PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
stock_with_segment AS (
  SELECT sr.yymm, sdm.account_id, sr.prdt_scs_cd, sr.prdt_nm, sr.stock_amt,
    CASE sr.yymm
      WHEN '${baseMonth}' THEN ${remarkCaseSQL(baseMonth)}
      WHEN '${priorMonth}' THEN ${remarkCaseSQL(priorMonth)}
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
    p.operate_standard,
    p.remark1,p.remark2,p.remark3,p.remark4,p.remark5,
    p.remark6,p.remark7,p.remark8,p.remark9,p.remark10,
    p.remark11,p.remark12,p.remark13,p.remark14,p.remark15,
    p.sesn
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  INNER JOIN acc_item_map db ON SUBSTR(s.prdt_scs_cd, 7, 2) = db.ITEM
  WHERE TO_CHAR(s.sale_dt,'YYYYMM') IN ('${baseMonth}','${priorMonth}') AND s.brd_cd = '${brandCode}'
    AND db.PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
sales_with_segment AS (
  SELECT sr.yymm, sdm.account_id, sr.prdt_scs_cd, sr.tag_amt,
    CASE sr.yymm
      WHEN '${baseMonth}' THEN ${remarkCaseSQL(baseMonth)}
      WHEN '${priorMonth}' THEN ${remarkCaseSQL(priorMonth)}
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

  const dealers: DealerData[] = [];
  const products: ProductData[] = [];

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
