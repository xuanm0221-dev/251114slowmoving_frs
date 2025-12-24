import type { NextApiRequest, NextApiResponse } from "next";
import snowflake from "snowflake-sdk";
import { BRAND_CODE_MAP } from "../../src/types/stagnantStock";
import * as fs from 'fs';
import * as path from 'path';

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
  prdt_nm_cn: string;
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

// 주력/아울렛 분류 CASE 문 생성
function getProductTypeCase(opStdColumn: string, sesnColumn: string, yearColumn: string): string {
  return `
    CASE
      WHEN ${opStdColumn} IN ('FOCUS', 'INTRO') THEN 'core'
      WHEN ${opStdColumn} IN ('OUTLET', 'DONE', 'CARE') THEN 'outlet'
      WHEN ${opStdColumn} RLIKE '^[0-9]{2}(SS|FW)$' THEN
        CASE
          WHEN CAST(SUBSTRING(${opStdColumn}, 1, 2) AS INT) >= CAST(${yearColumn} AS INT) THEN 'core'
          ELSE 'outlet'
        END
      ELSE 'outlet'
    END
  `;
}

// 카테고리 필터 조건 생성 함수
function getCategoryFilter(category: string): string {
  if (category === 'all') return "AND p.prdt_kind_nm_en IN ('Shoes', 'Headwear', 'Bag', 'Acc_etc')";
  
  const categoryMap: Record<string, string> = {
    shoes: 'Shoes',
    headwear: 'Headwear',
    bag: 'Bag',
    acc_etc: 'Acc_etc',
  };
  
  return `AND p.prdt_kind_nm_en = '${categoryMap[category]}'`;
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

  const brandCode = BRAND_CODE_MAP[brand as keyof typeof BRAND_CODE_MAP] || brand;
  
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

  try {
    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USER!,
      password: process.env.SNOWFLAKE_PASSWORD!,
      database: process.env.SNOWFLAKE_DATABASE!,
      schema: process.env.SNOWFLAKE_SCHEMA!,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    });

    await new Promise<void>((resolve, reject) => {
      connection.connect((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const query = `
WITH 
-- 대리상 마스터
dealer_master AS (
  SELECT 
    account_id,
    account_nm_en
  FROM CHN.MST_ACCOUNT
  WHERE account_id IS NOT NULL
),

-- 매장 → 대리상 매핑 (FR만)
shop_dealer_map AS (
  SELECT 
    TO_VARCHAR(shop_id) AS shop_id,
    account_id
  FROM FNF.CHN.MST_SHOP_ALL
  WHERE fr_or_cls = 'FR'
    AND account_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER(PARTITION BY shop_id ORDER BY open_dt DESC NULLS LAST) = 1
),

-- 재고 데이터 (당월 + 전년동월)
stock_raw AS (
  SELECT 
    s.yymm,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.prdt_scs_cd,
    s.stock_tag_amt_expected AS stock_amt,
    p.remark1, p.remark2, p.remark3, p.remark4, p.remark5,
    p.remark6, p.remark7, p.remark8, p.remark9, p.remark10,
    p.remark11, p.remark12, p.remark13, p.remark14, p.remark15,
    p.sesn,
    p.prdt_nm_cn
  FROM CHN.DW_STOCK_M s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE s.yymm IN ('${baseMonth}', '${priorMonth}')
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    ${getCategoryFilter(selectedCategory)}
),

-- 재고 + 대리상 매핑 + remark 자동 계산 (23.12 기준, 3개월 단위)
stock_with_segment AS (
  SELECT 
    sr.yymm,
    sdm.account_id,
    sr.prdt_scs_cd,
    sr.prdt_nm_cn,
    sr.stock_amt,
    CASE (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1)
      WHEN 1 THEN sr.remark1
      WHEN 2 THEN sr.remark2
      WHEN 3 THEN sr.remark3
      WHEN 4 THEN sr.remark4
      WHEN 5 THEN sr.remark5
      WHEN 6 THEN sr.remark6
      WHEN 7 THEN sr.remark7
      WHEN 8 THEN sr.remark8
      WHEN 9 THEN sr.remark9
      WHEN 10 THEN sr.remark10
      WHEN 11 THEN sr.remark11
      WHEN 12 THEN sr.remark12
      WHEN 13 THEN sr.remark13
      WHEN 14 THEN sr.remark14
      WHEN 15 THEN sr.remark15
      ELSE NULL
    END AS op_std,
    sr.sesn,
    SUBSTRING(sr.yymm, 3, 2) AS yy
  FROM stock_raw sr
  INNER JOIN shop_dealer_map sdm ON sr.shop_id = sdm.shop_id
),

-- 재고 주력/아울렛 분류
stock_classified AS (
  SELECT 
    yymm,
    account_id,
    prdt_scs_cd,
    prdt_nm_cn,
    stock_amt,
    ${getProductTypeCase('op_std', 'sesn', 'yy')} AS segment
  FROM stock_with_segment
),

-- 판매 데이터 (당월 + 전년동월)
sales_raw AS (
  SELECT 
    TO_CHAR(s.sale_dt, 'YYYYMM') AS yymm,
    TO_VARCHAR(s.shop_id) AS shop_id,
    s.prdt_scs_cd,
    s.tag_amt,
    p.remark1, p.remark2, p.remark3, p.remark4, p.remark5,
    p.remark6, p.remark7, p.remark8, p.remark9, p.remark10,
    p.remark11, p.remark12, p.remark13, p.remark14, p.remark15,
    p.sesn
  FROM CHN.DW_SALE s
  INNER JOIN FNF.CHN.MST_PRDT_SCS p ON s.prdt_scs_cd = p.prdt_scs_cd
  WHERE TO_CHAR(s.sale_dt, 'YYYYMM') IN ('${baseMonth}', '${priorMonth}')
    AND s.brd_cd = '${brandCode}'
    AND p.parent_prdt_kind_cd = 'A'
    ${getCategoryFilter(selectedCategory)}
),

-- 판매 + 대리상 매핑 + remark 자동 계산 (23.12 기준, 3개월 단위)
sales_with_segment AS (
  SELECT 
    sr.yymm,
    sdm.account_id,
    sr.prdt_scs_cd,
    sr.tag_amt,
    CASE (FLOOR(DATEDIFF('month', TO_DATE('202312', 'YYYYMM'), TO_DATE(sr.yymm || '01', 'YYYYMMDD')) / 3) + 1)
      WHEN 1 THEN sr.remark1
      WHEN 2 THEN sr.remark2
      WHEN 3 THEN sr.remark3
      WHEN 4 THEN sr.remark4
      WHEN 5 THEN sr.remark5
      WHEN 6 THEN sr.remark6
      WHEN 7 THEN sr.remark7
      WHEN 8 THEN sr.remark8
      WHEN 9 THEN sr.remark9
      WHEN 10 THEN sr.remark10
      WHEN 11 THEN sr.remark11
      WHEN 12 THEN sr.remark12
      WHEN 13 THEN sr.remark13
      WHEN 14 THEN sr.remark14
      WHEN 15 THEN sr.remark15
      ELSE NULL
    END AS op_std,
    sr.sesn,
    SUBSTRING(sr.yymm, 3, 2) AS yy
  FROM sales_raw sr
  INNER JOIN shop_dealer_map sdm ON sr.shop_id = sdm.shop_id
),

-- 판매 주력/아울렛 분류
sales_classified AS (
  SELECT 
    yymm,
    account_id,
    prdt_scs_cd,
    tag_amt,
    ${getProductTypeCase('op_std', 'sesn', 'yy')} AS segment
  FROM sales_with_segment
),

-- 재고 대리상별 집계 (중복 방지)
stock_by_dealer AS (
  SELECT 
    account_id,
    SUM(CASE WHEN yymm = '${baseMonth}' THEN stock_amt ELSE 0 END) AS current_stock_total,
    SUM(CASE WHEN yymm = '${baseMonth}' AND segment = 'core' THEN stock_amt ELSE 0 END) AS current_stock_core,
    SUM(CASE WHEN yymm = '${baseMonth}' AND segment = 'outlet' THEN stock_amt ELSE 0 END) AS current_stock_outlet,
    SUM(CASE WHEN yymm = '${priorMonth}' THEN stock_amt ELSE 0 END) AS prior_stock_total,
    SUM(CASE WHEN yymm = '${priorMonth}' AND segment = 'core' THEN stock_amt ELSE 0 END) AS prior_stock_core,
    SUM(CASE WHEN yymm = '${priorMonth}' AND segment = 'outlet' THEN stock_amt ELSE 0 END) AS prior_stock_outlet
  FROM stock_classified
  GROUP BY account_id
),

-- 판매 대리상별 집계 (중복 방지)
sales_by_dealer AS (
  SELECT 
    account_id,
    SUM(CASE WHEN yymm = '${baseMonth}' THEN tag_amt ELSE 0 END) AS current_sales_total,
    SUM(CASE WHEN yymm = '${baseMonth}' AND segment = 'core' THEN tag_amt ELSE 0 END) AS current_sales_core,
    SUM(CASE WHEN yymm = '${baseMonth}' AND segment = 'outlet' THEN tag_amt ELSE 0 END) AS current_sales_outlet,
    SUM(CASE WHEN yymm = '${priorMonth}' THEN tag_amt ELSE 0 END) AS prior_sales_total,
    SUM(CASE WHEN yymm = '${priorMonth}' AND segment = 'core' THEN tag_amt ELSE 0 END) AS prior_sales_core,
    SUM(CASE WHEN yymm = '${priorMonth}' AND segment = 'outlet' THEN tag_amt ELSE 0 END) AS prior_sales_outlet
  FROM sales_classified
  GROUP BY account_id
),

-- 대리상별 집계 (재고와 판매 결합)
dealer_agg AS (
  SELECT 
    dm.account_id,
    dm.account_nm_en,
    COALESCE(st.current_stock_total, 0) AS current_stock_total,
    COALESCE(sal.current_sales_total, 0) AS current_sales_total,
    COALESCE(st.current_stock_core, 0) AS current_stock_core,
    COALESCE(sal.current_sales_core, 0) AS current_sales_core,
    COALESCE(st.current_stock_outlet, 0) AS current_stock_outlet,
    COALESCE(sal.current_sales_outlet, 0) AS current_sales_outlet,
    COALESCE(st.prior_stock_total, 0) AS prior_stock_total,
    COALESCE(sal.prior_sales_total, 0) AS prior_sales_total,
    COALESCE(st.prior_stock_core, 0) AS prior_stock_core,
    COALESCE(sal.prior_sales_core, 0) AS prior_sales_core,
    COALESCE(st.prior_stock_outlet, 0) AS prior_stock_outlet,
    COALESCE(sal.prior_sales_outlet, 0) AS prior_sales_outlet
  FROM dealer_master dm
  LEFT JOIN stock_by_dealer st ON dm.account_id = st.account_id
  LEFT JOIN sales_by_dealer sal ON dm.account_id = sal.account_id
  WHERE st.account_id IS NOT NULL OR sal.account_id IS NOT NULL
),

-- 재고 상품별 집계 (중복 방지)
stock_by_product AS (
  SELECT 
    account_id,
    prdt_scs_cd,
    MAX(prdt_nm_cn) AS prdt_nm_cn,
    segment,
    SUM(CASE WHEN yymm = '${baseMonth}' THEN stock_amt ELSE 0 END) AS current_stock_amt,
    SUM(CASE WHEN yymm = '${priorMonth}' THEN stock_amt ELSE 0 END) AS prior_stock_amt
  FROM stock_classified
  GROUP BY account_id, prdt_scs_cd, segment
),

-- 판매 상품별 집계 (중복 방지)
sales_by_product AS (
  SELECT 
    account_id,
    prdt_scs_cd,
    segment,
    SUM(CASE WHEN yymm = '${baseMonth}' THEN tag_amt ELSE 0 END) AS current_sales_amt,
    SUM(CASE WHEN yymm = '${priorMonth}' THEN tag_amt ELSE 0 END) AS prior_sales_amt
  FROM sales_classified
  GROUP BY account_id, prdt_scs_cd, segment
),

-- 상품별 상세 (모달용)
product_agg AS (
  SELECT 
    dm.account_id,
    dm.account_nm_en,
    st.prdt_scs_cd,
    st.prdt_nm_cn,
    st.segment,
    COALESCE(st.current_stock_amt, 0) AS current_stock_amt,
    COALESCE(sal.current_sales_amt, 0) AS current_sales_amt,
    COALESCE(st.prior_stock_amt, 0) AS prior_stock_amt,
    COALESCE(sal.prior_sales_amt, 0) AS prior_sales_amt
  FROM dealer_master dm
  INNER JOIN stock_by_product st ON dm.account_id = st.account_id
  LEFT JOIN sales_by_product sal ON st.account_id = sal.account_id AND st.prdt_scs_cd = sal.prdt_scs_cd AND st.segment = sal.segment
  WHERE st.current_stock_amt > 0 OR st.prior_stock_amt > 0
)

SELECT 
  'dealer' AS record_type,
  account_id,
  account_nm_en,
  current_stock_total,
  current_sales_total,
  current_stock_core,
  current_sales_core,
  current_stock_outlet,
  current_sales_outlet,
  prior_stock_total,
  prior_sales_total,
  prior_stock_core,
  prior_sales_core,
  prior_stock_outlet,
  prior_sales_outlet,
  NULL AS prdt_scs_cd,
  NULL AS prdt_nm_cn,
  NULL AS segment,
  NULL AS current_stock_amt,
  NULL AS current_sales_amt,
  NULL AS prior_stock_amt,
  NULL AS prior_sales_amt
FROM dealer_agg

UNION ALL

SELECT 
  'product' AS record_type,
  account_id,
  account_nm_en,
  NULL AS current_stock_total,
  NULL AS current_sales_total,
  NULL AS current_stock_core,
  NULL AS current_sales_core,
  NULL AS current_stock_outlet,
  NULL AS current_sales_outlet,
  NULL AS prior_stock_total,
  NULL AS prior_sales_total,
  NULL AS prior_stock_core,
  NULL AS prior_sales_core,
  NULL AS prior_stock_outlet,
  NULL AS prior_sales_outlet,
  prdt_scs_cd,
  prdt_nm_cn,
  segment,
  current_stock_amt,
  current_sales_amt,
  prior_stock_amt,
  prior_sales_amt
FROM product_agg

ORDER BY record_type, account_id, prdt_scs_cd
    `;

    console.log('=== DEALER CORE OUTLET SQL QUERY ===');
    console.log(query);
    console.log('=== END SQL QUERY ===');

    const rows: any[] = await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: query,
        complete: (err, stmt, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        },
      });
    });

    await new Promise<void>((resolve) => {
      connection.destroy((err) => {
        if (err) console.error("Connection destroy error:", err);
        resolve();
      });
    });

    // 데이터 가공
    const dealers: DealerData[] = [];
    const products: ProductData[] = [];

    rows.forEach((row: any) => {
      if (row.RECORD_TYPE === 'dealer') {
        dealers.push({
          account_id: row.ACCOUNT_ID,
          account_nm_en: row.ACCOUNT_NM_EN,
          account_nm_kr: dealerKoreanNames.get(row.ACCOUNT_ID) || '',
          current: {
            total: {
              stock_amt: row.CURRENT_STOCK_TOTAL || 0,
              sales_amt: row.CURRENT_SALES_TOTAL || 0,
              stock_weeks: calcStockWeeks(row.CURRENT_STOCK_TOTAL || 0, row.CURRENT_SALES_TOTAL || 0, daysInMonth),
            },
            core: {
              stock_amt: row.CURRENT_STOCK_CORE || 0,
              sales_amt: row.CURRENT_SALES_CORE || 0,
              stock_weeks: calcStockWeeks(row.CURRENT_STOCK_CORE || 0, row.CURRENT_SALES_CORE || 0, daysInMonth),
            },
            outlet: {
              stock_amt: row.CURRENT_STOCK_OUTLET || 0,
              sales_amt: row.CURRENT_SALES_OUTLET || 0,
              stock_weeks: calcStockWeeks(row.CURRENT_STOCK_OUTLET || 0, row.CURRENT_SALES_OUTLET || 0, daysInMonth),
            },
          },
          prior: {
            total: {
              stock_amt: row.PRIOR_STOCK_TOTAL || 0,
              sales_amt: row.PRIOR_SALES_TOTAL || 0,
              stock_weeks: calcStockWeeks(row.PRIOR_STOCK_TOTAL || 0, row.PRIOR_SALES_TOTAL || 0, daysInMonth),
            },
            core: {
              stock_amt: row.PRIOR_STOCK_CORE || 0,
              sales_amt: row.PRIOR_SALES_CORE || 0,
              stock_weeks: calcStockWeeks(row.PRIOR_STOCK_CORE || 0, row.PRIOR_SALES_CORE || 0, daysInMonth),
            },
            outlet: {
              stock_amt: row.PRIOR_STOCK_OUTLET || 0,
              sales_amt: row.PRIOR_SALES_OUTLET || 0,
              stock_weeks: calcStockWeeks(row.PRIOR_STOCK_OUTLET || 0, row.PRIOR_SALES_OUTLET || 0, daysInMonth),
            },
          },
        });
      } else if (row.RECORD_TYPE === 'product') {
        products.push({
          account_id: row.ACCOUNT_ID,
          account_nm_en: row.ACCOUNT_NM_EN,
          account_nm_kr: dealerKoreanNames.get(row.ACCOUNT_ID) || '',
          prdt_scs_cd: row.PRDT_SCS_CD,
          prdt_nm_cn: row.PRDT_NM_CN,
          segment: row.SEGMENT,
          current: {
            stock_amt: row.CURRENT_STOCK_AMT || 0,
            sales_amt: row.CURRENT_SALES_AMT || 0,
            stock_weeks: calcStockWeeks(row.CURRENT_STOCK_AMT || 0, row.CURRENT_SALES_AMT || 0, daysInMonth),
          },
          prior: {
            stock_amt: row.PRIOR_STOCK_AMT || 0,
            sales_amt: row.PRIOR_SALES_AMT || 0,
            stock_weeks: calcStockWeeks(row.PRIOR_STOCK_AMT || 0, row.PRIOR_SALES_AMT || 0, daysInMonth),
          },
        });
      }
    });

    const response: ApiResponse = {
      dealers,
      products,
      meta: {
        baseMonth,
        priorMonth,
        daysInMonth,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("dealer-core-outlet API error:", error);
    res.status(500).json({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) });
  }
}

