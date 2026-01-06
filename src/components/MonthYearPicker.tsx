"use client";

import { useState, useRef, useEffect } from "react";

interface MonthYearPickerProps {
  value: string; // "YYYY.MM" 형식
  onChange: (month: string) => void;
  availableMonths: readonly string[]; // 선택 가능한 마감된 월 목록
}

export default function MonthYearPicker({
  value,
  onChange,
  availableMonths,
}: MonthYearPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const [year] = value.split(".").map(Number);
    return year;
  });
  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    const [, month] = value.split(".").map(Number);
    return month;
  });
  const pickerRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  // value 변경 시 selectedYear, selectedMonth 업데이트
  useEffect(() => {
    const [year, month] = value.split(".").map(Number);
    setSelectedYear(year);
    setSelectedMonth(month);
  }, [value]);

  // 선택 가능한 년도 목록 생성
  const availableYears = Array.from(
    new Set(availableMonths.map((m) => parseInt(m.split(".")[0])))
  ).sort();

  // 선택된 년도의 선택 가능한 월 목록
  const availableMonthsInYear = availableMonths
    .filter((m) => m.startsWith(`${selectedYear}.`))
    .map((m) => parseInt(m.split(".")[1]))
    .sort((a, b) => a - b);

  // 월 선택 가능 여부 확인
  const isMonthAvailable = (year: number, month: number): boolean => {
    const monthStr = `${year}.${month.toString().padStart(2, "0")}`;
    const availableMonthsArray = Array.from(availableMonths);
    return availableMonthsArray.includes(monthStr);
  };

  // 월 선택 핸들러
  const handleMonthSelect = (year: number, month: number) => {
    if (!isMonthAvailable(year, month)) return;

    const monthStr = `${year}.${month.toString().padStart(2, "0")}`;
    onChange(monthStr);
    setIsOpen(false);
  };

  // 이번 달 (가장 최근 마감 월) 선택
  const handleThisMonth = () => {
    if (availableMonths.length === 0) return;
    
    const sorted = [...availableMonths].sort((a, b) => {
      const [yearA, monthA] = a.split(".").map(Number);
      const [yearB, monthB] = b.split(".").map(Number);
      if (yearA !== yearB) return yearA - yearB;
      return monthA - monthB;
    });
    
    const latest = sorted[sorted.length - 1];
    onChange(latest);
    setIsOpen(false);
  };

  // 삭제 (기본값으로 리셋)
  const handleDelete = () => {
    if (availableMonths.length === 0) return;
    
    const sorted = [...availableMonths].sort((a, b) => {
      const [yearA, monthA] = a.split(".").map(Number);
      const [yearB, monthB] = b.split(".").map(Number);
      if (yearA !== yearB) return yearA - yearB;
      return monthA - monthB;
    });
    
    const latest = sorted[sorted.length - 1];
    onChange(latest);
    setIsOpen(false);
  };

  // 표시 형식: "YYYY년 MM월"
  const displayValue = (() => {
    const [year, month] = value.split(".").map(Number);
    return `${year}년 ${month.toString().padStart(2, "0")}월`;
  })();

  return (
    <div className="relative" ref={pickerRef}>
      {/* 입력 필드 */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
          기준월
        </label>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
        >
          <span className="text-sm text-gray-900">{displayValue}</span>
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>
      </div>

      {/* 드롭다운 */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[400px]">
          <div className="flex">
            {/* 년도 리스트 (왼쪽) */}
            <div className="w-24 border-r border-gray-200 overflow-y-auto max-h-[300px]">
              {availableYears.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => setSelectedYear(year)}
                  className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-100 transition-colors ${
                    selectedYear === year
                      ? "bg-blue-50 text-blue-600 font-medium"
                      : "text-gray-700"
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>

            {/* 월 그리드 (오른쪽) */}
            <div className="flex-1 p-4">
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => {
                  const isAvailable = isMonthAvailable(selectedYear, month);
                  const isSelected =
                    selectedYear === parseInt(value.split(".")[0]) &&
                    selectedMonth === month;

                  return (
                    <button
                      key={month}
                      type="button"
                      onClick={() => handleMonthSelect(selectedYear, month)}
                      disabled={!isAvailable}
                      className={`
                        px-3 py-2 text-sm rounded-lg transition-colors
                        ${
                          isSelected
                            ? "bg-blue-600 text-white font-medium border-2 border-blue-800"
                            : isAvailable
                            ? "bg-gray-50 text-gray-900 hover:bg-gray-100 border border-gray-200"
                            : "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                        }
                      `}
                    >
                      {month}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <button
              type="button"
              onClick={handleDelete}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              삭제
            </button>
            <button
              type="button"
              onClick={handleThisMonth}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              이번 달
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

