/**
 * 유틸리티 함수
 */

/**
 * 숫자를 천 단위 콤마 포함 M 단위 문자열로 변환
 * @param value M 단위 숫자
 * @returns 포맷된 문자열 (예: "1,234M")
 */
export function formatAmountM(value: number | undefined | null): string {
  if (value === undefined || value === null) {
    return "0M";
  }
  return `${value.toLocaleString("ko-KR")}M`;
}

/**
 * 숫자를 천 단위 콤마 포함 원 단위 문자열로 변환
 * @param value 원 단위 숫자
 * @returns 포맷된 문자열 (예: "1,234,567,890")
 */
export function formatAmountWon(value: number | undefined | null): string {
  if (value === undefined || value === null) {
    return "0";
  }
  return value.toLocaleString("ko-KR");
}

/**
 * 월 문자열을 짧은 형식으로 변환
 * @param month "2024.01" 형식의 문자열
 * @returns "24.01" 형식의 문자열
 */
export function formatMonth(month: string): string {
  const [year, monthNum] = month.split(".");
  return `${year.slice(2)}.${monthNum}`;
}

/**
 * 클래스명 결합 유틸리티
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * ISO 날짜 문자열을 YY.MM.DD 형식으로 변환
 * @param isoString ISO 8601 형식 날짜 문자열 (예: "2025-12-24T10:30:00Z")
 * @returns YY.MM.DD 형식 문자열 (예: "25.12.24")
 */
export function formatUpdateDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const year = date.getFullYear().toString().slice(-2); // 마지막 2자리
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}.${month}.${day}`;
  } catch {
    return "";
  }
}

/**
 * ISO 날짜 문자열을 전체 날짜/시간 형식으로 변환 (툴팁용)
 * @param isoString ISO 8601 형식 날짜 문자열
 * @returns "YYYY년 MM월 DD일 HH:MM 업데이트됨" 형식
 */
export function formatUpdateDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}년 ${month}월 ${day}일 ${hours}:${minutes} 업데이트됨`;
  } catch {
    return "";
  }
}

/**
 * 기준월 기준으로 N개월까지의 월 배열 생성
 * @param referenceMonth 기준월 (예: "2025.12")
 * @param count 개월 수 (예: 6)
 * @returns 기준월 포함하여 count개월까지의 월 배열 (예: ["2025.12", "2026.01", ..., "2026.05"])
 */
export function generateMonthsFromReference(referenceMonth: string, count: number): string[] {
  const result: string[] = [];
  const [year, month] = referenceMonth.split(".").map(Number);
  
  let currentYear = year;
  let currentMonth = month;
  
  for (let i = 0; i < count; i++) {
    const monthStr = `${currentYear}.${currentMonth.toString().padStart(2, "0")}`;
    result.push(monthStr);
    
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  
  return result;
}

/**
 * 기준월 기준으로 1년(12개월)까지의 월 배열 생성
 * @param referenceMonth 기준월 (예: "2025.12")
 * @returns 기준월 포함하여 12개월까지의 월 배열
 */
export function generateOneYearMonths(referenceMonth: string): string[] {
  return generateMonthsFromReference(referenceMonth, 12);
}

/**
 * 기준월 기준으로 과거 N개월 + 기준월 + 미래 M개월의 월 배열 생성
 * @param referenceMonth 기준월 (예: "2025.12")
 * @param pastMonths 과거 개월 수 (예: 12)
 * @param futureMonths 미래 개월 수 (예: 6)
 * @returns 기준월 기준 과거 N개월 + 기준월 + 미래 M개월 배열
 */
export function generateMonthsAroundReference(
  referenceMonth: string,
  pastMonths: number,
  futureMonths: number
): string[] {
  const [refYear, refMonth] = referenceMonth.split(".").map(Number);
  const months: string[] = [];
  
  // 과거 N개월 (기준월 제외)
  for (let i = pastMonths; i >= 1; i--) {
    let year = refYear;
    let month = refMonth - i;
    if (month <= 0) {
      month += 12;
      year -= 1;
    }
    months.push(`${year}.${String(month).padStart(2, "0")}`);
  }
  
  // 기준월 포함
  months.push(referenceMonth);
  
  // 미래 M개월
  for (let i = 1; i <= futureMonths; i++) {
    let year = refYear;
    let month = refMonth + i;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
    months.push(`${year}.${String(month).padStart(2, "0")}`);
  }
  
  return months;
}

/**
 * 기준월이 속한 연도의 1월~12월 + 다음 연도 1월~6월의 월 배열 생성
 * @param referenceMonth 기준월 (예: "2025.12")
 * @returns 기준월 연도 전체(1월~12월) + 다음 연도 6개월(1월~6월) 배열
 */
export function generateMonthsForYearAndNextHalf(referenceMonth: string): string[] {
  const [refYear, refMonth] = referenceMonth.split(".").map(Number);
  const months: string[] = [];
  
  // 기준월이 속한 연도의 1월부터 기준월까지
  for (let month = 1; month <= refMonth; month++) {
    months.push(`${refYear}.${String(month).padStart(2, "0")}`);
  }
  
  // 다음 연도 1월~6월
  const nextYear = refYear + 1;
  for (let month = 1; month <= 6; month++) {
    months.push(`${nextYear}.${String(month).padStart(2, "0")}`);
  }
  
  return months;
}

/**
 * 기준월에서 N개월 후 계산
 * @param referenceMonth 기준월 (예: "2025.12")
 * @param monthsAfter N개월 후 (예: 4)
 * @returns N개월 후의 월 (예: "2026.04")
 */
export function getMonthAfter(referenceMonth: string, monthsAfter: number): string {
  const [year, month] = referenceMonth.split(".").map(Number);
  let targetYear = year;
  let targetMonth = month + monthsAfter;
  
  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }
  
  return `${targetYear}.${String(targetMonth).padStart(2, "0")}`;
}



