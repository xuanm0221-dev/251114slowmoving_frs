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







