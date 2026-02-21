import type { NextApiRequest, NextApiResponse } from "next";
import type { ItemTab, SalesBrandData } from "../../src/types/sales";
import { readBatchJsonFile } from "../../src/lib/batchDataLoader";

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


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SalesAPIResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, referenceMonth } = req.query;

  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }

  // 브랜드 검증은 JSON 데이터에서 확인

  // 기준월이 없으면 기본값 사용 (가장 최근 마감 월)
  const refMonth = (referenceMonth as string) || "2025.12";

  try {
    // 전처리 JSON에서만 읽기
    console.log(`[sales-data] 전처리 JSON에서 데이터를 읽습니다. brand=${brand}, referenceMonth=${refMonth}`);
    
    let jsonData: any;
    try {
      jsonData = readBatchJsonFile<any>("accessory_sales_summary.json");
    } catch (error) {
      console.error(`[sales-data] JSON 파일 읽기 실패:`, error);
      // JSON 파일이 없으면 빈 데이터 반환
      const emptyData: SalesAPIResponse = {
        brands: {
          [brand]: {
            전체: {},
            Shoes: {},
            Headwear: {},
            Bag: {},
            Acc_etc: {}
          }
        },
        months: [],
        daysInMonth: {},
        unexpectedCategories: [],
        meta: {
          brand: brand,
          startMonth: '202401',
          endMonth: refMonth.replace('.', ''),
          queryTimestamp: new Date().toISOString(),
          totalRecords: 0,
          unmappedRecords: 0,
          unmappedAmount: 0
        }
      };
      res.status(200).json(emptyData);
      return;
    }
    
    // 브랜드 필터링 및 기준월까지 필터링
    const filteredMonths = (jsonData.months || []).filter((m: string) => m <= refMonth);
    const filteredBrandData: SalesBrandData = {
      전체: {},
      Shoes: {},
      Headwear: {},
      Bag: {},
      Acc_etc: {}
    };
    
    if (jsonData.brands && jsonData.brands[brand]) {
      for (const itemTab in jsonData.brands[brand]) {
        filteredBrandData[itemTab as ItemTab] = {};
        for (const month of filteredMonths) {
          if (jsonData.brands[brand][itemTab as ItemTab]?.[month]) {
            filteredBrandData[itemTab as ItemTab][month] = jsonData.brands[brand][itemTab as ItemTab][month];
          }
        }
      }
    }
    
    const filteredData: SalesAPIResponse = {
      brands: {
        [brand]: filteredBrandData
      },
      months: filteredMonths,
      daysInMonth: jsonData.daysInMonth || {},
      unexpectedCategories: jsonData.unexpectedCategories || [],
      meta: {
        brand: brand,
        startMonth: '202401',
        endMonth: refMonth.replace('.', ''),
        queryTimestamp: new Date().toISOString(),
        totalRecords: 0,
        unmappedRecords: 0,
        unmappedAmount: 0
      }
    };
    
    res.status(200).json(filteredData);
  } catch (error) {
    console.error('[sales-data] Error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch sales data' 
    });
  }
}


