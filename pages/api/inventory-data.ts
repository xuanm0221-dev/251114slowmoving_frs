import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import {
  buildInventoryAggregationQuery,
  BRAND_CODE_MAP,
  BRAND_NAME_TO_CODE,
  ITEM_CATEGORY_MAP,
  generateMonths,
  getDaysInMonth
} from "../../lib/snowflakeQueries";

interface InventoryMonthData {
  전체_core: number;
  전체_outlet: number;
  FRS_core: number;
  FRS_outlet: number;
  HQ_OR_core: number;
  HQ_OR_outlet: number;
  OR_sales_core?: number;
  OR_sales_outlet?: number;
}

interface InventoryItemTabData {
  [month: string]: InventoryMonthData;
}

interface InventoryBrandData {
  전체: InventoryItemTabData;
  신발: InventoryItemTabData;
  모자: InventoryItemTabData;
  가방: InventoryItemTabData;
  기타악세: InventoryItemTabData;
}

interface InventoryAPIResponse {
  brands: {
    [brandName: string]: InventoryBrandData;
  };
  months: string[];
  daysInMonth: { [month: string]: number };
  unexpectedCategories?: string[];
  meta: {
    brand: string;
    startMonth: string;
    endMonth: string;
    queryTimestamp: string;
    totalRecords: number;
    unmappedRecords: number;
    unmappedAmount: number;
  };
}

interface SnowflakeRow {
  YYMM: string;
  BRD_CD: string;
  ITEM_CATEGORY: string;
  CHANNEL: string;
  PRODUCT_TYPE: string;
  TOTAL_AMT: number;
  TOTAL_QTY: number;
  RECORD_COUNT: number;
  OR_SALES_AMT_CORE: number;
  OR_SALES_AMT_OUTLET: number;
  UNMAPPED_RECORDS: number;
  UNMAPPED_AMOUNT: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InventoryAPIResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand } = req.query;

  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }

  const brandCode = BRAND_NAME_TO_CODE[brand];
  if (!brandCode) {
    return res.status(400).json({ 
      error: `Invalid brand. Must be one of: ${Object.keys(BRAND_NAME_TO_CODE).join(', ')}` 
    });
  }

  const startMonth = '202401';
  const endMonth = '202511';

  try {
    console.log(`[inventory-data] Querying Snowflake for brand=${brand} (${brandCode})`);
    
    const query = buildInventoryAggregationQuery(brandCode, startMonth, endMonth);
    const rows = await runQuery(query) as SnowflakeRow[];

    console.log(`[inventory-data] Retrieved ${rows.length} rows`);

    // 결과 변환
    const response = transformInventoryData(rows, brand, startMonth, endMonth);
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[inventory-data] Error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch inventory data' 
    });
  }
}

function transformInventoryData(
  rows: SnowflakeRow[], 
  brandName: string, 
  startMonth: string, 
  endMonth: string
): InventoryAPIResponse {
  const brandData: InventoryBrandData = {
    전체: {},
    Shoes: {},
    Headwear: {},
    Bag: {},
    Acc_etc: {}
  };

  // 월 목록 및 일수 생성
  const months = generateMonths(startMonth, endMonth);
  const daysInMonth: { [month: string]: number } = {};
  months.forEach(month => {
    const yyyymm = month.replace('.', '');
    daysInMonth[month] = getDaysInMonth(yyyymm);
  });

  // 모든 월에 대해 초기화
  const itemTabs = ['전체', 'Shoes', 'Headwear', 'Bag', 'Acc_etc'] as const;
  months.forEach(month => {
    itemTabs.forEach(tab => {
      brandData[tab][month] = {
        전체_core: 0,
        전체_outlet: 0,
        FRS_core: 0,
        FRS_outlet: 0,
        HQ_OR_core: 0,
        HQ_OR_outlet: 0
      };
    });
  });

  // Meta 정보
  let totalRecords = 0;
  let unmappedRecords = 0;
  let unmappedAmount = 0;

  // SQL 합계 계산 (검증용 - 202511/M)
  let sqlTotalAmt202511 = 0;
  let sqlTotalRows202511 = 0;
  
  rows.forEach(row => {
    if (row.YYMM === '202511' && row.BRD_CD === 'M') {
      sqlTotalAmt202511 += row.TOTAL_AMT;
      sqlTotalRows202511 += row.RECORD_COUNT;
    }
  });
  
  console.log(`[inventory-data] SQL 합계 (202511/M): ${Math.round(sqlTotalAmt202511).toLocaleString()}`);

  // OR 판매 데이터 수집 (월별/아이템별)
  const orSalesByKey: { [key: string]: { core: number; outlet: number } } = {};
  
  rows.forEach(row => {
    const month = row.YYMM.substring(0, 4) + '.' + row.YYMM.substring(4, 6);
    const itemCategoryEn = row.ITEM_CATEGORY;
    const itemTab = itemCategoryEn;  // 'Shoes', 'Headwear', 'Bag', 'Acc_etc' 그대로 사용
    const key = `${month}_${itemTab}`;
    
    if (!orSalesByKey[key]) {
      orSalesByKey[key] = {
        core: Math.round(row.OR_SALES_AMT_CORE || 0),
        outlet: Math.round(row.OR_SALES_AMT_OUTLET || 0)
      };
    }
  });

  // Snowflake 결과를 JSON 구조로 변환
  rows.forEach(row => {
    const month = row.YYMM.substring(0, 4) + '.' + row.YYMM.substring(4, 6);  // 202511 → 2025.11
    const itemCategoryEn = row.ITEM_CATEGORY;
    const itemTab = itemCategoryEn;  // 'Shoes', 'Headwear', 'Bag', 'Acc_etc' 그대로 사용
    const channel = row.CHANNEL;  // 'FR', 'OR', 'HQ'
    const productType = row.PRODUCT_TYPE;  // 'core' or 'outlet'
    const amount = Math.round(row.TOTAL_AMT);

    totalRecords += row.RECORD_COUNT;
    unmappedRecords = row.UNMAPPED_RECORDS;
    unmappedAmount = Math.round(row.UNMAPPED_AMOUNT);

    if (!brandData[itemTab][month]) {
      brandData[itemTab][month] = {
        전체_core: 0,
        전체_outlet: 0,
        FRS_core: 0,
        FRS_outlet: 0,
        HQ_OR_core: 0,
        HQ_OR_outlet: 0
      };
    }

    // 채널별 집계 (누적 +=)
    if (channel === 'FR') {
      const frsKey = `FRS_${productType}` as keyof InventoryMonthData;
      brandData[itemTab][month][frsKey] += amount;  // ✅ 누적
    } else if (channel === 'OR' || channel === 'HQ') {
      // OR + HQ = 본사재고
      const hqOrKey = `HQ_OR_${productType}` as keyof InventoryMonthData;
      brandData[itemTab][month][hqOrKey] += amount;  // ✅ 누적
    }

    // 전체 집계
    const totalKey = `전체_${productType}` as keyof InventoryMonthData;
    brandData[itemTab][month][totalKey] += amount;
    
    // OR_sales 데이터 추가
    const key = `${month}_${itemTab}`;
    if (orSalesByKey[key]) {
      brandData[itemTab][month].OR_sales_core = orSalesByKey[key].core;
      brandData[itemTab][month].OR_sales_outlet = orSalesByKey[key].outlet;
    }

    // '전체' 탭에도 누적
    if (itemTab !== '전체') {
      if (!brandData['전체'][month]) {
        brandData['전체'][month] = {
          전체_core: 0,
          전체_outlet: 0,
          FRS_core: 0,
          FRS_outlet: 0,
          HQ_OR_core: 0,
          HQ_OR_outlet: 0
        };
      }
      
      if (channel === 'FR') {
        const frsKey = `FRS_${productType}` as keyof InventoryMonthData;
        brandData['전체'][month][frsKey] += amount;  // ✅ 누적
      } else if (channel === 'OR' || channel === 'HQ') {
        const hqOrKey = `HQ_OR_${productType}` as keyof InventoryMonthData;
        brandData['전체'][month][hqOrKey] += amount;  // ✅ 누적
      }
      
      brandData['전체'][month][totalKey] += amount;  // ✅ 누적
    }
  });

  // 전체 탭의 OR_sales 집계
  months.forEach(month => {
    let totalCore = 0;
    let totalOutlet = 0;
    
    ['Shoes', 'Headwear', 'Bag', 'Acc_etc'].forEach(tab => {
      totalCore += brandData[tab][month].OR_sales_core || 0;
      totalOutlet += brandData[tab][month].OR_sales_outlet || 0;
    });
    
    brandData['전체'][month].OR_sales_core = totalCore;
    brandData['전체'][month].OR_sales_outlet = totalOutlet;
  });

  // JSON 합계 계산 (검증용 - 2025.11 MLB)
  let jsonTotalAmt202511 = 0;
  if (brandName === 'MLB' && brandData['전체']['2025.11']) {
    jsonTotalAmt202511 = 
      (brandData['전체']['2025.11'].전체_core || 0) +
      (brandData['전체']['2025.11'].전체_outlet || 0);
    
    console.log(`[inventory-data] JSON 합계 (2025.11/MLB 전체재고): ${jsonTotalAmt202511.toLocaleString()}`);
    console.log(`[inventory-data] Delta: ${(jsonTotalAmt202511 - Math.round(sqlTotalAmt202511)).toLocaleString()}`);
  }

  return {
    brands: {
      [brandName]: brandData
    },
    months,
    daysInMonth,
    meta: {
      brand: brandName,
      startMonth,
      endMonth,
      queryTimestamp: new Date().toISOString(),
      totalRecords,
      unmappedRecords,
      unmappedAmount,
      // 검증용 추가 (202511 MLB만)
      verification_202511: brandName === 'MLB' ? {
        sql_total_amt: Math.round(sqlTotalAmt202511),
        json_total_amt: jsonTotalAmt202511,
        delta: jsonTotalAmt202511 - Math.round(sqlTotalAmt202511),
        target: 4170201461
      } : undefined
    }
  };
}

