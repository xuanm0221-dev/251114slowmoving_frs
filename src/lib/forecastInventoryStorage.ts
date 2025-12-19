import { Brand } from "@/types/sales";
import { ForecastInventoryMonthData } from "@/types/sales";

/**
 * 브랜드별 입고예정 재고자산 데이터 타입
 */
export interface ForecastInventoryStorageData {
  [month: string]: ForecastInventoryMonthData;
}

/**
 * localStorage 키 생성
 */
function getStorageKey(brand: Brand): string {
  return `forecast_inventory_${brand}`;
}

/**
 * localStorage에서 브랜드별 입고예정 데이터 로드
 */
export function loadForecastInventoryFromStorage(
  brand: Brand
): ForecastInventoryStorageData | null {
  try {
    const key = getStorageKey(brand);
    const data = localStorage.getItem(key);
    if (!data) return null;
    return JSON.parse(data) as ForecastInventoryStorageData;
  } catch (error) {
    console.error("Failed to load forecast inventory from localStorage:", error);
    return null;
  }
}

/**
 * localStorage에 브랜드별 입고예정 데이터 저장
 */
export function saveForecastInventoryToStorage(
  brand: Brand,
  data: ForecastInventoryStorageData
): boolean {
  try {
    const key = getStorageKey(brand);
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Failed to save forecast inventory to localStorage:", error);
    return false;
  }
}

/**
 * 특정 월/아이템의 값만 업데이트
 */
export function updateForecastInventoryItem(
  brand: Brand,
  month: string,
  item: keyof ForecastInventoryMonthData,
  value: number
): boolean {
  try {
    const existing = loadForecastInventoryFromStorage(brand) || {};
    if (!existing[month]) {
      existing[month] = {};
    }
    existing[month][item] = value;
    return saveForecastInventoryToStorage(brand, existing);
  } catch (error) {
    console.error("Failed to update forecast inventory item:", error);
    return false;
  }
}

/**
 * 기준월 이후 count개월의 월 리스트 생성
 * 예) latestActualYm="2025.11", count=6 → ["2025.12", "2026.01", ..., "2026.05"]
 */
export function buildEditableMonths(latestActualYm: string, count: number = 6): string[] {
  const result: string[] = [];
  const [year, month] = latestActualYm.split(".").map(Number);
  
  let currentYear = year;
  let currentMonth = month;
  
  for (let i = 0; i < count; i++) {
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
    const monthStr = `${currentYear}.${currentMonth.toString().padStart(2, "0")}`;
    result.push(monthStr);
  }
  
  return result;
}

/**
 * localStorage 초기화 (특정 브랜드)
 */
export function clearForecastInventoryStorage(brand: Brand): boolean {
  try {
    const key = getStorageKey(brand);
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error("Failed to clear forecast inventory from localStorage:", error);
    return false;
  }
}

