import fs from "fs";
import path from "path";

/**
 * 마감된 월 목록 파일 경로
 */
const CLOSED_MONTHS_FILE = path.join(
  process.cwd(),
  "public",
  "data",
  "closed_months.json"
);

/**
 * 마감된 월 목록을 읽어옵니다.
 * @returns 마감된 월 목록 배열 (예: ["2024.01", "2024.02", ...])
 */
export function getClosedMonths(): string[] {
  try {
    if (!fs.existsSync(CLOSED_MONTHS_FILE)) {
      console.warn(`[batchDataLoader] closed_months.json 파일이 없습니다. 기본값을 반환합니다.`);
      return [];
    }
    
    const fileContent = fs.readFileSync(CLOSED_MONTHS_FILE, "utf-8");
    const closedMonths = JSON.parse(fileContent) as string[];
    return closedMonths;
  } catch (error) {
    console.error("[batchDataLoader] 마감된 월 목록 읽기 실패:", error);
    return [];
  }
}

/**
 * 기준월이 마감된 월인지 확인합니다.
 * @param referenceMonth 기준월 (예: "2025.12")
 * @returns 마감된 월이면 true
 */
export function isClosedMonth(referenceMonth: string): boolean {
  const closedMonths = getClosedMonths();
  return closedMonths.includes(referenceMonth);
}

/**
 * 기준월까지의 모든 월이 마감되었는지 확인합니다.
 * 예: 기준월이 2026.01이고 2025.12까지 마감되었으면 true
 * @param referenceMonth 기준월 (예: "2026.01")
 * @returns 기준월 이전의 모든 월이 마감되었으면 true
 */
export function isAllPreviousMonthsClosed(referenceMonth: string): boolean {
  const closedMonths = getClosedMonths();
  const closedMonthsSet = new Set(closedMonths);
  
  // 기준월 이전의 모든 월이 마감 목록에 포함되어 있는지 확인
  const [refYear, refMonth] = referenceMonth.split(".").map(Number);
  
  for (let year = 2024; year <= refYear; year++) {
    const startMonth = year === 2024 ? 1 : 1;
    const endMonth = year === refYear ? refMonth - 1 : 12;
    
    for (let month = startMonth; month <= endMonth; month++) {
      const monthStr = `${year}.${String(month).padStart(2, "0")}`;
      if (!closedMonthsSet.has(monthStr)) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * 배치 JSON 파일을 읽어옵니다.
 * @param filename JSON 파일명 (예: "accessory_sales_summary.json")
 * @returns JSON 데이터
 */
export function readBatchJsonFile<T = any>(filename: string): T {
  const filePath = path.join(process.cwd(), "public", "data", filename);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`배치 JSON 파일이 없습니다: ${filename}`);
  }
  
  const fileContent = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(fileContent) as T;
}

/**
 * 가장 최근 마감된 월을 찾습니다.
 * @param referenceMonth 기준월 (예: "2026.01")
 * @returns 기준월 이전의 가장 최근 마감된 월 (예: "2025.12"), 없으면 null
 */
export function getLastClosedMonth(referenceMonth: string): string | null {
  const closedMonths = getClosedMonths();
  if (closedMonths.length === 0) {
    return null;
  }
  
  // 기준월보다 이전의 마감된 월만 필터링
  const [refYear, refMonth] = referenceMonth.split(".").map(Number);
  const refYyyymm = refYear * 100 + refMonth;
  
  const previousClosedMonths = closedMonths
    .map(month => {
      const [year, monthNum] = month.split(".").map(Number);
      return { month, yyyymm: year * 100 + monthNum };
    })
    .filter(({ yyyymm }) => yyyymm < refYyyymm)
    .sort((a, b) => b.yyyymm - a.yyyymm); // 내림차순 정렬
  
  return previousClosedMonths.length > 0 ? previousClosedMonths[0].month : null;
}

/**
 * 스냅샷 파일에서 데이터를 읽어옵니다.
 * @param filename 스냅샷 파일명 (예: "accessory_sales_summary_202511.json")
 * @returns JSON 데이터, 파일이 없으면 null
 */
export function readSnapshotFile<T = any>(filename: string): T | null {
  const filePath = path.join(
    process.cwd(),
    "public",
    "data",
    "snapshots",
    filename
  );
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(fileContent) as T;
  } catch (error) {
    console.error(`[batchDataLoader] 스냅샷 파일 읽기 실패 (${filename}):`, error);
    return null;
  }
}

/**
 * 마감 목록에 월을 추가합니다.
 * @param month 추가할 월 (예: "2025.12")
 */
export function addClosedMonth(month: string): void {
  const closedMonths = getClosedMonths();
  
  if (!closedMonths.includes(month)) {
    closedMonths.push(month);
    closedMonths.sort(); // 정렬
    
    fs.writeFileSync(
      CLOSED_MONTHS_FILE,
      JSON.stringify(closedMonths, null, 2),
      "utf-8"
    );
  }
}

/**
 * 마감 목록에서 월을 제거합니다.
 * @param month 제거할 월 (예: "2025.12")
 */
export function removeClosedMonth(month: string): void {
  const closedMonths = getClosedMonths();
  const filtered = closedMonths.filter(m => m !== month);
  
  if (filtered.length === closedMonths.length) {
    // 월이 없었으면 아무것도 하지 않음
    return;
  }
  
  fs.writeFileSync(
    CLOSED_MONTHS_FILE,
    JSON.stringify(filtered, null, 2),
    "utf-8"
  );
}

/**
 * 대리상 마감된 월 목록 파일 경로
 */
const DEALER_CLOSED_MONTHS_FILE = path.join(
  process.cwd(),
  "public",
  "data",
  "dealer_closed_months.json"
);

/**
 * 대리상 마감된 월 목록을 읽어옵니다.
 * @returns 대리상 마감된 월 목록 배열 (예: ["2024.01", "2024.02", ...])
 */
export function getDealerClosedMonths(): string[] {
  try {
    if (!fs.existsSync(DEALER_CLOSED_MONTHS_FILE)) {
      console.warn(`[batchDataLoader] dealer_closed_months.json 파일이 없습니다. 기본값을 반환합니다.`);
      return [];
    }
    
    const fileContent = fs.readFileSync(DEALER_CLOSED_MONTHS_FILE, "utf-8");
    const closedMonths = JSON.parse(fileContent) as string[];
    return closedMonths;
  } catch (error) {
    console.error("[batchDataLoader] 대리상 마감된 월 목록 읽기 실패:", error);
    return [];
  }
}

/**
 * 기준월이 대리상 마감된 월인지 확인합니다.
 * @param referenceMonth 기준월 (예: "2025.12")
 * @returns 대리상 마감된 월이면 true
 */
export function isDealerMonthClosed(referenceMonth: string): boolean {
  const closedMonths = getDealerClosedMonths();
  return closedMonths.includes(referenceMonth);
}

/**
 * 대리상 마감 목록에 월을 추가합니다.
 * @param month 추가할 월 (예: "2025.12")
 */
export function addDealerClosedMonth(month: string): void {
  const closedMonths = getDealerClosedMonths();
  
  if (!closedMonths.includes(month)) {
    closedMonths.push(month);
    closedMonths.sort(); // 정렬
    
    fs.writeFileSync(
      DEALER_CLOSED_MONTHS_FILE,
      JSON.stringify(closedMonths, null, 2),
      "utf-8"
    );
  }
}

/**
 * 대리상 마감 목록에서 월을 제거합니다.
 * @param month 제거할 월 (예: "2025.12")
 */
export function removeDealerClosedMonth(month: string): void {
  const closedMonths = getDealerClosedMonths();
  const filtered = closedMonths.filter(m => m !== month);
  
  if (filtered.length === closedMonths.length) {
    // 월이 없었으면 아무것도 하지 않음
    return;
  }
  
  fs.writeFileSync(
    DEALER_CLOSED_MONTHS_FILE,
    JSON.stringify(filtered, null, 2),
    "utf-8"
  );
}
