import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import {
  buildSalesAggregationQuery,
  BRAND_CODE_MAP,
  BRAND_NAME_TO_CODE,
  generateMonths,
  getDaysInMonth
} from "../../lib/snowflakeQueries";
import type { ItemTab, SalesBrandData } from "../../src/types/sales";

interface SalesMonthData {
  전체_core: number;
  전체_outlet: number;
  FRS_core: number;
  FRS_outlet: number;
  OR_core: number;
  OR_outlet: number;
}

interface SalesItemTabData {
  [month: string]: SalesMonthData;
}

// SalesBrandData는 src/types/sales.ts에서 import

interface SalesAPIResponse {
  brands: {
    [brandName: string]: SalesBrandData;
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
  SALE_YM: string;
  BRD_CD: string;
  ITEM_CATEGORY: string;
  CHANNEL: string;
  PRODUCT_TYPE: string;
  TOTAL_AMT: number;
  RECORD_COUNT: number;
  UNMAPPED_RECORDS: number;
  UNMAPPED_AMOUNT: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SalesAPIResponse | { error: string }>
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
    console.log(`[sales-data] Querying Snowflake for brand=${brand} (${brandCode})`);
    
    const query = buildSalesAggregationQuery(brandCode, startMonth, endMonth);
    const rows = await runQuery(query) as SnowflakeRow[];

    console.log(`[sales-data] Retrieved ${rows.length} rows`);

    // 결과 변환
    const response = transformSalesData(rows, brand, startMonth, endMonth);
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[sales-data] Error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch sales data' 
    });
  }
}

function transformSalesData(
  rows: SnowflakeRow[], 
  brandName: string, 
  startMonth: string, 
  endMonth: string
): SalesAPIResponse {
  const brandData: SalesBrandData = {
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
        OR_core: 0,
        OR_outlet: 0
      };
    });
  });

  // Meta 정보 (첫 번째 row에서 가져옴)
  let totalRecords = 0;
  let unmappedRecords = 0;
  let unmappedAmount = 0;

  // Snowflake 결과를 JSON 구조로 변환
  rows.forEach(row => {
    const month = row.SALE_YM;
    const itemCategoryEn = row.ITEM_CATEGORY;
    const itemTab = itemCategoryEn as ItemTab;  // 영문 키 그대로: 'Shoes' | 'Headwear' | 'Bag' | 'Acc_etc'
    const channel = row.CHANNEL === 'FR' ? 'FRS' : row.CHANNEL;  // FR → FRS 매핑
    const productType = row.PRODUCT_TYPE;  // 'core' or 'outlet'
    const amount = Math.round(row.TOTAL_AMT);

    totalRecords += row.RECORD_COUNT;
    unmappedRecords = row.UNMAPPED_RECORDS;  // 모든 row에 동일값
    unmappedAmount = Math.round(row.UNMAPPED_AMOUNT);

    if (!brandData[itemTab][month]) {
      brandData[itemTab][month] = {
        전체_core: 0,
        전체_outlet: 0,
        FRS_core: 0,
        FRS_outlet: 0,
        OR_core: 0,
        OR_outlet: 0
      };
    }

    // 채널별 집계
    const channelKey = `${channel}_${productType}` as keyof SalesMonthData;
    brandData[itemTab][month][channelKey] = amount;

    // 전체 집계
    const totalKey = `전체_${productType}` as keyof SalesMonthData;
    brandData[itemTab][month][totalKey] += amount;

    // '전체' 탭에도 누적
    if (itemTab !== '전체') {
      if (!brandData['전체'][month]) {
        brandData['전체'][month] = {
          전체_core: 0,
          전체_outlet: 0,
          FRS_core: 0,
          FRS_outlet: 0,
          OR_core: 0,
          OR_outlet: 0
        };
      }
      brandData['전체'][month][channelKey] = 
        (brandData['전체'][month][channelKey] || 0) + amount;
      brandData['전체'][month][totalKey] = 
        (brandData['전체'][month][totalKey] || 0) + amount;
    }
  });

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
      unmappedAmount
    }
  };
}

