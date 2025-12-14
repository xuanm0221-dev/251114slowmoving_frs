import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

// 대리상 마스터 타입 정의
interface DealerMaster {
  account_id: string;
  account_nm_cn: string;
  account_nm_kr: string;
  account_nm_en: string;
}

interface DealerMasterResponse {
  dealers: DealerMaster[];
}

// CSV 파일 경로 (로컬 및 서버 환경 모두 지원)
const CSV_PATHS = [
  "D:\\dashboard\\slowmoving\\data\\master\\fr_master.csv",
  "/app/data/master/fr_master.csv", // Docker/서버 환경
  path.join(process.cwd(), "data", "master", "fr_master.csv"), // 상대 경로
];

// CSV 파싱 함수
function parseCSV(content: string): DealerMaster[] {
  const lines = content.split("\n").filter(line => line.trim());
  if (lines.length < 2) return [];
  
  // 헤더 파싱
  const headers = lines[0].split(",").map(h => h.trim());
  const accountIdIdx = headers.indexOf("account_id");
  const nmCnIdx = headers.indexOf("account_nm_cn");
  const nmKrIdx = headers.indexOf("account_nm_kr");
  const nmEnIdx = headers.indexOf("account_nm_en");
  
  if (accountIdIdx === -1) {
    console.error("CSV header missing account_id column");
    return [];
  }
  
  const dealers: DealerMaster[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // CSV 파싱: 쉼표로 분리하되 따옴표 안의 쉼표는 무시
    const values = parseCSVLine(line);
    
    if (values.length > accountIdIdx) {
      dealers.push({
        account_id: values[accountIdIdx]?.trim() || "",
        account_nm_cn: nmCnIdx >= 0 ? values[nmCnIdx]?.trim() || "" : "",
        account_nm_kr: nmKrIdx >= 0 ? values[nmKrIdx]?.trim() || "" : "",
        account_nm_en: nmEnIdx >= 0 ? values[nmEnIdx]?.trim() || "" : "",
      });
    }
  }
  
  return dealers;
}

// CSV 라인 파싱 (따옴표 처리)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

// 캐시된 데이터
let cachedDealers: DealerMaster[] | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5분 캐시

// CSV 파일 읽기
async function loadDealerMaster(): Promise<DealerMaster[]> {
  // 캐시 확인
  if (cachedDealers && Date.now() - cacheTime < CACHE_TTL) {
    return cachedDealers;
  }
  
  // 여러 경로 시도
  for (const csvPath of CSV_PATHS) {
    try {
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, "utf-8");
        cachedDealers = parseCSV(content);
        cacheTime = Date.now();
        console.log(`Loaded ${cachedDealers.length} dealers from ${csvPath}`);
        return cachedDealers;
      }
    } catch (err) {
      console.warn(`Failed to read CSV from ${csvPath}:`, err);
    }
  }
  
  console.warn("No dealer master CSV found in any path");
  return [];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DealerMasterResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const dealers = await loadDealerMaster();
    
    res.status(200).json({
      dealers,
    });
  } catch (error) {
    console.error("Dealer master API error:", error);
    res.status(500).json({ error: String(error) });
  }
}

// 다른 API에서 사용할 수 있도록 export
export { loadDealerMaster };

