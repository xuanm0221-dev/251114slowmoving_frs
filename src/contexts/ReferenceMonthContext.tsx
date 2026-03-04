"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { CLOSED_MONTHS } from "@/constants/businessRules";

interface ReferenceMonthContextType {
  referenceMonth: string;
  setReferenceMonth: (month: string) => void;
  closedMonths: readonly string[];
  getLatestClosedMonth: () => string;
  lastUpdatedDate: { [brand: string]: string | null };
  setLastUpdatedDate: (brand: string, date: string | null) => void;
}

const ReferenceMonthContext = createContext<ReferenceMonthContextType | undefined>(undefined);

const STORAGE_KEY = "referenceMonth";

/**
 * 마감된 월 목록에서 가장 최근 월을 반환
 */
function getLatestClosedMonth(): string {
  // CLOSED_MONTHS는 as const로 선언되어 있어 항상 값이 있음
  // 월을 정렬하여 가장 최근 월 반환
  const sorted = [...CLOSED_MONTHS].sort((a, b) => {
    const [yearA, monthA] = a.split(".").map(Number);
    const [yearB, monthB] = b.split(".").map(Number);
    if (yearA !== yearB) return yearA - yearB;
    return monthA - monthB;
  });
  
  return sorted[sorted.length - 1];
}

export function ReferenceMonthProvider({ children }: { children: ReactNode }) {
  // 서버와 클라이언트 모두 동일한 초기값 사용 (hydration mismatch 방지)
  const [referenceMonth, setReferenceMonthState] = useState<string>(getLatestClosedMonth());
  
  // 클라이언트에서만 localStorage에서 저장된 기준월 가져오기
  // 최신 마감월(26.02 등)이 있으면 그걸 우선 적용 (저장된 값이 더 최신이면 그대로 사용)
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const latest = getLatestClosedMonth();
    const stored = localStorage.getItem(STORAGE_KEY);
    const closedMonthsArray = Array.from(CLOSED_MONTHS) as string[];
    
    if (stored && closedMonthsArray.includes(stored)) {
      // 저장된 월이 최신 마감월 이상이면 유지, 아니면 최신 마감월로 설정
      const useLatest = latest >= stored;
      setReferenceMonthState(useLatest ? latest : stored);
      if (useLatest) {
        localStorage.setItem(STORAGE_KEY, latest);
      }
    } else {
      setReferenceMonthState(latest);
      localStorage.setItem(STORAGE_KEY, latest);
    }
  }, []);

  // 브랜드별 입고예정 자산 업데이트 날짜
  const [lastUpdatedDate, setLastUpdatedDateState] = useState<{ [brand: string]: string | null }>({});

  // 기준월 변경 시 localStorage에 저장
  const setReferenceMonth = (month: string) => {
    // 마감된 월인지 확인
    const closedMonthsArray = Array.from(CLOSED_MONTHS) as string[];
    if (!closedMonthsArray.includes(month)) {
      console.warn(`[ReferenceMonth] 선택한 월(${month})은 마감되지 않은 월입니다. 마감된 월만 선택 가능합니다.`);
      return;
    }
    
    setReferenceMonthState(month);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, month);
    }
  };

  // 브랜드별 입고예정 자산 업데이트 날짜 설정
  const setLastUpdatedDate = (brand: string, date: string | null) => {
    setLastUpdatedDateState((prev) => ({
      ...prev,
      [brand]: date,
    }));
  };

  // 마감된 월 목록이 변경되면 기준월도 업데이트 (마감된 월이 아니면 최신 마감 월로 변경)
  useEffect(() => {
    const closedMonthsArray = Array.from(CLOSED_MONTHS) as string[];
    if (!closedMonthsArray.includes(referenceMonth)) {
      const latest = getLatestClosedMonth();
      setReferenceMonthState(latest);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, latest);
      }
    }
  }, [referenceMonth]);

  return (
    <ReferenceMonthContext.Provider
      value={{
        referenceMonth,
        setReferenceMonth,
        closedMonths: CLOSED_MONTHS,
        getLatestClosedMonth,
        lastUpdatedDate,
        setLastUpdatedDate,
      }}
    >
      {children}
    </ReferenceMonthContext.Provider>
  );
}

export function useReferenceMonth() {
  const context = useContext(ReferenceMonthContext);
  if (context === undefined) {
    throw new Error("useReferenceMonth must be used within a ReferenceMonthProvider");
  }
  return context;
}

