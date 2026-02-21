"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRANDS } from "@/types/sales";
import { cn } from "@/lib/utils";
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";
import MonthYearPicker from "./MonthYearPicker";
import { formatUpdateDateTime } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";

// 섹션 정의
const SECTIONS = [
  { key: "dealer",   label: "대리상 주력/아울렛" },
  { key: "sales",    label: "판매/재고" },
  { key: "stagnant", label: "정체재고" },
  { key: "arrival",  label: "실제입고" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

interface SnapshotStatus {
  dealer: boolean;
  sales: boolean;
  stagnant: boolean;
  arrival: boolean;
}

function SaveButton({
  sectionKey,
  label,
  saved,
  saving,
  recalcDropdownOpen,
  onSave,
  onRecalc,
  onToggleDropdown,
  dropdownRef,
}: {
  sectionKey: SectionKey;
  label: string;
  saved: boolean;
  saving: boolean;
  recalcDropdownOpen: boolean;
  onSave: () => void;
  onRecalc: (type: "current" | "full") => void;
  onToggleDropdown: () => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (saved) {
    return (
      <div className="flex items-center gap-1">
        {/* 저장완료 배지 */}
        <div className="px-2 py-1 bg-green-50 border border-green-200 rounded-l-lg flex items-center gap-1">
          <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-xs text-green-800 font-medium whitespace-nowrap">{label}</span>
        </div>
        {/* 재계산 드롭다운 버튼 */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={onToggleDropdown}
            disabled={saving}
            className="px-2 py-1 bg-green-50 border border-l-0 border-green-200 rounded-r-lg hover:bg-green-100 disabled:opacity-50 flex items-center transition-colors"
            title="재계산"
          >
            <svg className="w-3 h-3 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <svg className="w-2.5 h-2.5 text-green-700 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {recalcDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <button
                onClick={() => onRecalc("current")}
                disabled={saving}
                className="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-gray-50 rounded-t-lg disabled:opacity-50"
              >
                {saving ? "처리 중..." : "기준월 재계산"}
              </button>
              <button
                onClick={() => onRecalc("full")}
                disabled={saving}
                className="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-gray-50 rounded-b-lg border-t border-gray-100 disabled:opacity-50"
              >
                {saving ? "처리 중..." : "전체기간 재계산"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onSave}
      disabled={saving}
      className="px-2 py-1 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
    >
      <svg className="w-3 h-3 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
      </svg>
      <span className="text-xs text-orange-800 font-medium whitespace-nowrap">
        {saving ? "저장 중..." : `${label} 저장`}
      </span>
    </button>
  );
}

export default function Navigation() {
  const pathname = usePathname();
  const { referenceMonth, setReferenceMonth, closedMonths, lastUpdatedDate } = useReferenceMonth();

  // 현재 경로에서 브랜드 파악
  const currentBrand = BRANDS.find((brand) => brand.path === pathname)?.key;
  const currentLastUpdatedDate = currentBrand ? lastUpdatedDate[currentBrand] : null;

  // 스냅샷 상태
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  // 각 섹션 저장 중 여부
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);

  // 재계산 드롭다운 열림 여부
  const [openDropdown, setOpenDropdown] = useState<SectionKey | null>(null);
  const dropdownRefs = useRef<Partial<Record<SectionKey, HTMLDivElement | null>>>({});

  // 스냅샷 상태 로드
  const fetchSnapshotStatus = async (month: string, brand: string) => {
    if (!brand || !month) return;
    setIsLoadingStatus(true);
    try {
      const response = await fetch(
        `/api/snapshot-status?referenceMonth=${encodeURIComponent(month)}&brand=${encodeURIComponent(brand)}`
      );
      if (response.ok) {
        const data = await response.json();
        setSnapshotStatus(data);
      }
    } catch (error) {
      console.error("스냅샷 상태 로드 실패:", error);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  // 기준월 또는 브랜드 변경 시 상태 갱신
  useEffect(() => {
    if (currentBrand && referenceMonth) {
      fetchSnapshotStatus(referenceMonth, currentBrand);
    }
  }, [referenceMonth, currentBrand]);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openDropdown) {
        const ref = dropdownRefs.current[openDropdown];
        if (ref && !ref.contains(e.target as Node)) {
          setOpenDropdown(null);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdown]);

  // 저장 핸들러
  const handleSave = async (sectionKey: SectionKey) => {
    setSavingSection(sectionKey);
    setOpenDropdown(null);
    try {
      const response = await fetch("/api/save-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionKey, referenceMonth, recalcType: "current" }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error((data as any).error || "저장에 실패했습니다.");

      alert((data as any).message || "저장이 완료되었습니다.");
      if (currentBrand) await fetchSnapshotStatus(referenceMonth, currentBrand);
      
      // 저장 성공 후 페이지 새로고침하여 저장된 데이터 표시
      window.location.reload();
    } catch (error) {
      alert(`저장에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      setSavingSection(null);
    }
  };

  // 재계산 핸들러
  const handleRecalc = async (sectionKey: SectionKey, recalcType: "current" | "full") => {
    const label = recalcType === "current" ? "기준월 재계산" : "전체기간 재계산";
    if (!confirm(`${label}을 실행하시겠습니까? 기존 데이터가 덮어쓰여집니다.`)) return;

    setSavingSection(sectionKey);
    setOpenDropdown(null);
    try {
      const response = await fetch("/api/save-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionKey, referenceMonth, recalcType }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error((data as any).error || "재계산에 실패했습니다.");

      alert((data as any).message || "재계산이 완료되었습니다.");
      if (currentBrand) await fetchSnapshotStatus(referenceMonth, currentBrand);
      
      // 재계산 성공 후 페이지 새로고침하여 재계산된 데이터 표시
      window.location.reload();
    } catch (error) {
      alert(`재계산에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      setSavingSection(null);
    }
  };

  return (
    <nav className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50 shadow-sm">
      <div className="max-w-[1800px] mx-auto px-6">
        <div className="flex items-center h-14 gap-2 flex-wrap">
          {/* 네비게이션 링크 */}
          <div className="flex items-center gap-1">
            {BRANDS.map((brand) => (
              <Link
                key={brand.key}
                href={brand.path}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-medium transition-all duration-200 text-sm",
                  pathname === brand.path
                    ? `${brand.activeColor} ${brand.activeTextColor}`
                    : `${brand.textColor} ${brand.hoverColor} hover:text-gray-900`
                )}
              >
                {brand.name}
              </Link>
            ))}

            {/* Home 버튼 */}
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg font-medium transition-all duration-200 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center gap-1"
            >
              <span>🏠</span>
              Home
            </Link>
          </div>

          {/* 기준월 선택기 */}
          <div className="ml-1">
            <MonthYearPicker
              value={referenceMonth}
              onChange={setReferenceMonth}
              availableMonths={closedMonths}
            />
          </div>

          {/* 입고예정 자산 업데이트 날짜 */}
          {currentLastUpdatedDate && (
            <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg">
              <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs text-blue-800 font-medium whitespace-nowrap">
                입고예정: {formatUpdateDateTime(currentLastUpdatedDate)}
              </span>
            </div>
          )}

          {/* 섹션별 저장 상태 버튼 (브랜드 페이지에서만 표시) */}
          {currentBrand && !isLoadingStatus && snapshotStatus && (
            <div className="flex items-center gap-1.5 ml-1">
              {SECTIONS.map((section) => (
                <SaveButton
                  key={section.key}
                  sectionKey={section.key}
                  label={section.label}
                  saved={snapshotStatus[section.key]}
                  saving={savingSection === section.key}
                  recalcDropdownOpen={openDropdown === section.key}
                  onSave={() => handleSave(section.key)}
                  onRecalc={(type) => handleRecalc(section.key, type)}
                  onToggleDropdown={() =>
                    setOpenDropdown(openDropdown === section.key ? null : section.key)
                  }
                  dropdownRef={{ current: dropdownRefs.current[section.key] ?? null } as React.RefObject<HTMLDivElement | null>}
                />
              ))}
            </div>
          )}

          {/* 로딩 중 표시 */}
          {currentBrand && isLoadingStatus && (
            <div className="ml-1 flex items-center gap-1 text-xs text-gray-400">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              상태 확인 중...
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
