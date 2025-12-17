import type { NextApiRequest, NextApiResponse } from "next";
import { runQuery } from "../../lib/snowflake";
import type { ActualArrivalData } from "@/types/sales";

// 브랜드 코드 매핑
const BRAND_CODE_MAP: Record<string, string> = {
  MLB: "M",
  "MLB KIDS": "I",
  DISCOVERY: "X",
};

interface SnowflakeRow {
  item: string;
  "25.01": number;
  "25.02": number;
  "25.03": number;
  "25.04": number;
  "25.05": number;
  "25.06": number;
  "25.07": number;
  "25.08": number;
  "25.09": number;
  "25.10": number;
  "25.11": number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActualArrivalData | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand } = req.query;

  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand parameter is required" });
  }

  const brdCd = BRAND_CODE_MAP[brand] || brand;
  if (!["M", "I", "X"].includes(brdCd)) {
    return res.status(400).json({ error: "Invalid brand. Must be MLB, MLB KIDS, or DISCOVERY" });
  }

  // 브랜드 코드 검증 및 로깅
  console.log(`[actual-arrival] brand=${brand}, brdCd=${brdCd}`);

  try {
    // Snowflake SQL (문자열 치환 방식으로 brdCd 직접 삽입)
    // brdCd는 M/I/X 중 하나로만 허용되므로 SQL 인젝션 안전
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
      AND a.yyyymm BETWEEN 202501 AND 202511
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
        SUM(in_stock_amt) FOR yyyymm IN (202501,202502,202503,202504,202505,202506,202507,202508,202509,202510,202511)
    )
)
SELECT
      item
    , NVL("202501",0) AS "25.01"
    , NVL("202502",0) AS "25.02"
    , NVL("202503",0) AS "25.03"
    , NVL("202504",0) AS "25.04"
    , NVL("202505",0) AS "25.05"
    , NVL("202506",0) AS "25.06"
    , NVL("202507",0) AS "25.07"
    , NVL("202508",0) AS "25.08"
    , NVL("202509",0) AS "25.09"
    , NVL("202510",0) AS "25.10"
    , NVL("202511",0) AS "25.11"
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

    // 디버깅: 실행할 SQL 확인 (brdCd 부분만)
    console.log(`[actual-arrival] Executing SQL with brd_cd = '${brdCd}'`);

    const rows: SnowflakeRow[] = await runQuery(sql);

    // 디버깅: 쿼리 결과 확인 (사용자 요청 형식)
    console.log("actual-arrival rows.length", rows.length);
    if (rows.length > 0) {
      console.log("actual-arrival first row", rows[0]);
      // 실제 키 이름 확인
      console.log("actual-arrival first row keys:", Object.keys(rows[0]));
      // 첫 번째 행의 모든 속성 값 확인
      console.log("actual-arrival first row values:", JSON.stringify(rows[0], null, 2));
    } else {
      console.warn(`[actual-arrival] No rows returned from query. brdCd=${brdCd}`);
    }

    // Snowflake 결과를 ActualArrivalData 형식으로 변환
    const result: ActualArrivalData = {};
    const months = ["2025.01", "2025.02", "2025.03", "2025.04", "2025.05", "2025.06", "2025.07", "2025.08", "2025.09", "2025.10", "2025.11"];
    const monthKeys = ["25.01", "25.02", "25.03", "25.04", "25.05", "25.06", "25.07", "25.08", "25.09", "25.10", "25.11"];

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
        
        // 컬럼 키 접근: "25.01" 형식으로 직접 접근
        // Snowflake는 alias를 그대로 키로 사용하므로 "25.01"로 접근
        const value = (row as any)[monthKey];
        
        // 숫자 값 처리 (null/undefined는 0으로)
        const numValue = value != null ? Number(value) : 0;
        
        // 디버깅: 첫 번째 행의 첫 번째 월 값 확인
        if (rows.indexOf(row) === 0 && idx === 0) {
          console.log(`[actual-arrival] Reading value for monthKey="${monthKey}":`, value, "→", numValue);
        }
        
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



