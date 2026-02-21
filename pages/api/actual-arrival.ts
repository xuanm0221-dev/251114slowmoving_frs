import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import type { ActualArrivalData } from "@/types/sales";
import { readBatchJsonFile } from "../../src/lib/batchDataLoader";

// 브랜드 코드 매핑
const BRAND_CODE_MAP: Record<string, string> = {
  MLB: "M",
  "MLB KIDS": "I",
  DISCOVERY: "X",
};

// 기준월까지의 월 목록 생성 (2025.01부터 기준월까지)
function generateMonths(startMonth: string, endMonth: string): { months: string[]; yyyymmList: number[]; monthKeys: string[] } {
  const [startYear, startMonthNum] = startMonth.split(".").map(Number);
  const [endYear, endMonthNum] = endMonth.split(".").map(Number);
  
  const months: string[] = [];
  const yyyymmList: number[] = [];
  const monthKeys: string[] = [];
  
  let currentYear = startYear;
  let currentMonth = startMonthNum;
  
  while (
    currentYear < endYear || 
    (currentYear === endYear && currentMonth <= endMonthNum)
  ) {
    const monthStr = `${currentYear}.${String(currentMonth).padStart(2, '0')}`;
    const yyyymm = currentYear * 100 + currentMonth;
    const monthKey = `${String(currentYear).slice(2)}.${String(currentMonth).padStart(2, '0')}`;
    
    months.push(monthStr);
    yyyymmList.push(yyyymm);
    monthKeys.push(monthKey);
    
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  
  return { months, yyyymmList, monthKeys };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActualArrivalData | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, referenceMonth } = req.query;

  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }

  // 기준월이 없으면 기본값 사용 (2025.11)
  const endMonth = (referenceMonth as string) || "2025.11";
  const startMonth = "2024.01";

  // 기준월 검증
  if (!endMonth.match(/^\d{4}\.\d{2}$/)) {
    return res.status(400).json({ error: "Invalid referenceMonth format. Expected YYYY.MM" });
  }

  const brdCd = BRAND_CODE_MAP[brand] || brand;
  if (!["M", "I", "X"].includes(brdCd)) {
    return res.status(400).json({ error: "Invalid brand. Must be MLB, MLB KIDS, or DISCOVERY" });
  }

  // 기준월까지의 월 목록 생성
  const { months, yyyymmList, monthKeys } = generateMonths(startMonth, endMonth);
  
  // 시작월과 종료월을 YYYYMM 형식으로 변환
  const startYyyymm = parseInt(startMonth.replace(".", ""));
  const endYyyymm = parseInt(endMonth.replace(".", ""));

  // 기준월의 전월 계산
  const [endYear, endMonthNum] = endMonth.split(".").map(Number);
  let prevYear = endYear;
  let prevMonthNum = endMonthNum - 1;
  if (prevMonthNum < 1) {
    prevMonthNum = 12;
    prevYear--;
  }
  const prevMonth = `${prevYear}.${String(prevMonthNum).padStart(2, '0')}`;

  console.log(`[actual-arrival] 하이브리드 모드: 기준월(${endMonth})만 실시간 조회, 이전 월(${prevMonth}까지)은 JSON에서 읽기`);

  try {
    // 1. JSON 파일에서 데이터 읽기
    const jsonResult: ActualArrivalData = {};
    let currentMonthInJson = false;

    try {
      interface ActualArrivalSummaryData {
        brands: {
          [brand: string]: ActualArrivalData;
        };
      }
      
      const jsonData = readBatchJsonFile<ActualArrivalSummaryData>("accessory_actual_arrival_summary.json");
      const jsonBrandData = jsonData.brands[brand] || {};
      
      // 기준월이 JSON에 있는지 확인 (저장완료 여부)
      currentMonthInJson = !!(jsonBrandData[endMonth] && Object.keys(jsonBrandData[endMonth]).length > 0);
      
      // 기준월이 JSON에 있으면 전체 월 JSON에서 읽기, 없으면 이전 월만
      months.forEach(month => {
        if (jsonBrandData[month] && (month < endMonth || currentMonthInJson)) {
          jsonResult[month] = jsonBrandData[month];
        }
      });
      
      console.log(`[actual-arrival] JSON에서 ${Object.keys(jsonResult).length}개 월 데이터를 읽었습니다. 기준월저장: ${currentMonthInJson}`);
    } catch (jsonError) {
      console.warn(`[actual-arrival] JSON 파일 읽기 실패 (기준월만 조회):`, jsonError);
    }

    // 기준월이 JSON에 이미 저장된 경우 Snowflake 조회 불필요
    if (currentMonthInJson) {
      months.forEach(month => {
        if (!jsonResult[month]) jsonResult[month] = {};
      });
      return res.status(200).json(jsonResult);
    }

    // 2. 기준월만 Snowflake에서 실시간 조회 (저장전 상태)
    console.log(`[actual-arrival] 기준월(${endMonth})만 Snowflake에서 실시간 조회`);
    
    const refYyyymm = parseInt(endMonth.replace(".", ""));
    
    // 기준월만 조회하므로 PIVOT 컬럼은 하나
    const pivotColumns = refYyyymm.toString();
    const monthKey = `${String(endYear).slice(2)}.${String(endMonthNum).padStart(2, '0')}`;
    const selectColumns = `NVL("${refYyyymm}",0) AS "${monthKey}"`;

    // Snowflake SQL 동적 생성 (기준월만)
    const sql = `
WITH acc_item_map AS (
    SELECT DISTINCT ITEM, PRDT_KIND_NM_ENG
    FROM FNF.PRCS.DB_PRDT
    WHERE PARENT_PRDT_KIND_NM_ENG = 'ACC'
      AND PRDT_KIND_NM_ENG IN ('Shoes','Headwear','Bag','Acc_etc')
),
base AS (
    SELECT
          a.yyyymm
        , CASE
            WHEN db.PRDT_KIND_NM_ENG = 'Shoes'    THEN '신발'
            WHEN db.PRDT_KIND_NM_ENG = 'Headwear' THEN '모자'
            WHEN db.PRDT_KIND_NM_ENG = 'Bag'      THEN '가방'
            WHEN db.PRDT_KIND_NM_ENG = 'Acc_etc'  THEN '기타악세'
          END AS item
        , a.stor_amt AS in_stock_amt
    FROM sap_fnf.dw_cn_ivtr_prdt_m a
    JOIN acc_item_map db ON SUBSTR(a.prdt_cd, 7, 2) = db.ITEM
    WHERE a.brd_cd = '${brdCd}'
      AND a.yyyymm = ${refYyyymm}
),
agg AS (
    SELECT
          CASE WHEN GROUPING(item)=1 THEN '합계' ELSE item END AS item
        , yyyymm
        , SUM(in_stock_amt) AS in_stock_amt
    FROM base
    GROUP BY GROUPING SETS ((item, yyyymm), (yyyymm))
),
pv AS (
    SELECT *
    FROM agg
    PIVOT (
        SUM(in_stock_amt) FOR yyyymm IN (${pivotColumns})
    )
)
SELECT
      item
    , ${selectColumns}
FROM pv
ORDER BY
    CASE item
        WHEN '합계'     THEN 0
        WHEN '신발'     THEN 1
        WHEN '모자'     THEN 2
        WHEN '가방'     THEN 3
        WHEN '기타악세' THEN 4
        ELSE 99
    END
    `;

    console.log(`[actual-arrival] Executing SQL with brd_cd = '${brdCd}', yyyymm = ${refYyyymm}`);

    const rows = await runQuery(sql) as any[];

    console.log(`[actual-arrival] Snowflake에서 ${rows.length} rows 조회 (기준월만)`);

    // 3. Snowflake 결과를 ActualArrivalData 형식으로 변환 (기준월만)
    const snowflakeResult: ActualArrivalData = {};
    snowflakeResult[endMonth] = {};

    // 각 행(합계, 신발, 모자, 가방, 기타악세) 처리
    rows.forEach(row => {
      const item = (row as any).item ?? (row as any).ITEM;
      
      // 합계 행은 건너뛰기 (아이템별 합계는 클라이언트에서 계산)
      if (item === "합계") {
        return;
      }

      // 아이템명을 키로 변환
      const itemKey = item === "신발" ? "Shoes" :
                     item === "모자" ? "Headwear" :
                     item === "가방" ? "Bag" :
                     item === "기타악세" ? "Acc_etc" : null;

      if (!itemKey) return;

      // 기준월 데이터 추출
      const value = row[monthKey];
      const numValue = value != null ? Number(value) : 0;
      
      if (snowflakeResult[endMonth] && itemKey) {
        (snowflakeResult[endMonth] as any)[itemKey] = numValue;
      }
    });

    // 4. JSON 데이터와 Snowflake 데이터 병합 (JSON을 먼저, Snowflake로 덮어쓰기)
    const mergedResult: ActualArrivalData = {
      ...jsonResult,
      ...snowflakeResult
    };

    // 모든 월에 대해 초기화 (없는 월은 빈 객체)
    months.forEach(month => {
      if (!mergedResult[month]) {
        mergedResult[month] = {};
      }
    });

    res.status(200).json(mergedResult);
  } catch (error) {
    console.error("Actual arrival API error:", error);
    res.status(500).json({ error: String(error) });
  }
}



