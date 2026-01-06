import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import type { ActualArrivalData } from "@/types/sales";

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

  console.log(`[actual-arrival] brand=${brand}, brdCd=${brdCd}, referenceMonth=${endMonth}, months=${months.length}`);

  try {
    // PIVOT 컬럼 동적 생성
    const pivotColumns = yyyymmList.map(yyyymm => yyyymm.toString()).join(",");
    
    // SELECT 컬럼 동적 생성
    const selectColumns = yyyymmList.map((yyyymm, idx) => {
      const monthKey = monthKeys[idx];
      return `NVL("${yyyymm}",0) AS "${monthKey}"`;
    }).join(",\n    ");

    // Snowflake SQL 동적 생성
    const sql = `
WITH base AS (
    SELECT
          a.yyyymm
        , CASE
            WHEN p.prdt_hrrc2_nm = 'Shoes'    THEN '신발'
            WHEN p.prdt_hrrc2_nm = 'Headwear' THEN '모자'
            WHEN p.prdt_hrrc2_nm = 'Bag'      THEN '가방'
            WHEN p.prdt_hrrc2_nm = 'Acc_etc'  THEN '기타악세'
          END AS item
        , a.stor_amt AS in_stock_amt
    FROM sap_fnf.dw_cn_ivtr_prdt_m a
    JOIN sap_fnf.mst_prdt p
      ON a.prdt_cd = p.prdt_cd
    WHERE a.brd_cd = '${brdCd}'
      AND a.yyyymm BETWEEN ${startYyyymm} AND ${endYyyymm}
      AND p.prdt_hrrc1_nm = 'ACC'
      AND p.prdt_hrrc2_nm IN ('Shoes','Headwear','Bag','Acc_etc')
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

    console.log(`[actual-arrival] Executing SQL with brd_cd = '${brdCd}', range = ${startYyyymm}~${endYyyymm}`);

    const rows = await runQuery(sql) as any[];

    console.log("actual-arrival rows.length", rows.length);

    // Snowflake 결과를 ActualArrivalData 형식으로 변환
    const result: ActualArrivalData = {};

    // 각 월별로 데이터 초기화
    months.forEach(month => {
      result[month] = {};
    });

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

      // 각 월별 데이터 추출 및 변환
      monthKeys.forEach((monthKey, idx) => {
        const month = months[idx];
        const value = row[monthKey];
        const numValue = value != null ? Number(value) : 0;
        
        if (result[month] && itemKey) {
          (result[month] as any)[itemKey] = numValue;
        }
      });
    });

    res.status(200).json(result);
  } catch (error) {
    console.error("Actual arrival API error:", error);
    res.status(500).json({ error: String(error) });
  }
}



