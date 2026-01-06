"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRANDS, Brand } from "@/types/sales";
import { cn } from "@/lib/utils";
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";
import MonthYearPicker from "./MonthYearPicker";
import { formatUpdateDateTime } from "@/lib/utils";
import { useState, useEffect } from "react";

export default function Navigation() {
  const pathname = usePathname();
  const { referenceMonth, setReferenceMonth, closedMonths, lastUpdatedDate } = useReferenceMonth();
  const [snapshotMonths, setSnapshotMonths] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(true);
  const [forecastSnapshotMonths, setForecastSnapshotMonths] = useState<string[]>([]);
  const [isSavingForecastSnapshot, setIsSavingForecastSnapshot] = useState(false);
  const [isLoadingForecastSnapshots, setIsLoadingForecastSnapshots] = useState(true);
  
  // 현재 경로에서 브랜드 파악
  const currentBrand = BRANDS.find((brand) => brand.path === pathname)?.key;
  const currentLastUpdatedDate = currentBrand ? lastUpdatedDate[currentBrand] : null;

  // 스냅샷 목록 로드 (판매/재고)
  useEffect(() => {
    const fetchSnapshots = async () => {
      try {
        const response = await fetch("/api/snapshot-list");
        if (response.ok) {
          const data = await response.json();
          setSnapshotMonths(data.snapshots || []);
        }
      } catch (error) {
        console.error("스냅샷 목록 로드 실패:", error);
      } finally {
        setIsLoadingSnapshots(false);
      }
    };

    fetchSnapshots();
  }, []);

  // 입고예정자산 스냅샷 목록 로드
  useEffect(() => {
    const fetchForecastSnapshots = async () => {
      try {
        const response = await fetch("/api/forecast-snapshot-list");
        if (response.ok) {
          const data = await response.json();
          setForecastSnapshotMonths(data.snapshots || []);
        }
      } catch (error) {
        console.error("입고예정자산 스냅샷 목록 로드 실패:", error);
      } finally {
        setIsLoadingForecastSnapshots(false);
      }
    };

    fetchForecastSnapshots();
  }, []);

  // 현재 기준월의 스냅샷 저장 여부 확인
  const isSnapshotSaved = snapshotMonths.includes(referenceMonth);

  // 스냅샷 저장 가능 여부 확인
  // 현재 기준월이 closedMonths에 포함되어 있고 아직 저장되지 않았다면 저장 가능
  const canSaveSnapshot = closedMonths.includes(referenceMonth) && !isSnapshotSaved;

  // 스냅샷 저장 핸들러 (판매/재고)
  const handleSaveSnapshot = async () => {
    if (!canSaveSnapshot) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/save-snapshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ month: referenceMonth }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "스냅샷 저장에 실패했습니다.");
      }

      const data = await response.json();
      alert(data.message || "스냅샷이 저장되었습니다.");

      // 스냅샷 목록 새로고침
      const snapshotResponse = await fetch("/api/snapshot-list");
      if (snapshotResponse.ok) {
        const snapshotData = await snapshotResponse.json();
        setSnapshotMonths(snapshotData.snapshots || []);
      }
    } catch (error) {
      console.error("스냅샷 저장 실패:", error);
      alert(`스냅샷 저장에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 입고예정자산 스냅샷 저장 여부 확인
  const isForecastSnapshotSaved = forecastSnapshotMonths.includes(referenceMonth);
  // 현재 기준월이 closedMonths에 포함되어 있고 아직 저장되지 않았다면 저장 가능
  const canSaveForecastSnapshot = closedMonths.includes(referenceMonth) && !isForecastSnapshotSaved;

  // 입고예정자산 스냅샷 저장 핸들러
  const handleSaveForecastSnapshot = async () => {
    if (!canSaveForecastSnapshot) return;

    setIsSavingForecastSnapshot(true);
    try {
      const response = await fetch("/api/save-forecast-snapshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ month: referenceMonth }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "입고예정자산 스냅샷 저장에 실패했습니다.");
      }

      const data = await response.json();
      alert(data.message || "입고예정자산 스냅샷이 저장되었습니다.");

      // 스냅샷 목록 새로고침
      const snapshotResponse = await fetch("/api/forecast-snapshot-list");
      if (snapshotResponse.ok) {
        const snapshotData = await snapshotResponse.json();
        setForecastSnapshotMonths(snapshotData.snapshots || []);
      }
    } catch (error) {
      console.error("입고예정자산 스냅샷 저장 실패:", error);
      alert(`입고예정자산 스냅샷 저장에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally {
      setIsSavingForecastSnapshot(false);
    }
  };

  return (
    <nav className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50 shadow-sm">
      <div className="max-w-[1800px] mx-auto px-6">
        <div className="flex items-center h-14">
          {/* 네비게이션 링크 */}
          <div className="flex items-center gap-2">
            {BRANDS.map((brand) => (
              <Link
                key={brand.key}
                href={brand.path}
                className={cn(
                  "px-4 py-2 rounded-lg font-medium transition-all duration-200",
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
              className="px-4 py-2 rounded-lg font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center gap-1.5"
            >
              <span className="text-lg">🏠</span>
              Home
            </Link>

            {/* 기준월 선택기 */}
            <div className="ml-2">
              <MonthYearPicker
                value={referenceMonth}
                onChange={setReferenceMonth}
                availableMonths={closedMonths}
              />
            </div>

            {/* 입고예정 자산 업데이트 날짜 */}
            {currentLastUpdatedDate && (
              <div className="ml-4 flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs text-blue-800 font-medium whitespace-nowrap">
                    💾 입고예정 자산: {formatUpdateDateTime(currentLastUpdatedDate)}
                  </span>
                </div>

                {/* 입고예정자산 스냅샷 저장 상태/버튼 */}
                {!isLoadingForecastSnapshots && (
                  <>
                    {isForecastSnapshotSaved ? (
                      <div className="px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-xs text-green-800 font-medium whitespace-nowrap">
                          스냅샷 저장완료
                        </span>
                      </div>
                    ) : canSaveForecastSnapshot ? (
                      <button
                        onClick={handleSaveForecastSnapshot}
                        disabled={isSavingForecastSnapshot}
                        className="px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                      >
                        <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                        <span className="text-xs text-orange-800 font-medium whitespace-nowrap">
                          {isSavingForecastSnapshot ? "저장 중..." : "입고예정 스냅샷 저장"}
                        </span>
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}

            {/* 스냅샷 저장 상태/버튼 */}
            {!isLoadingSnapshots && (
              <div className="ml-4">
                {isSnapshotSaved ? (
                  <div className="px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-xs text-green-800 font-medium whitespace-nowrap">
                      스냅샷 저장완료
                    </span>
                  </div>
                ) : canSaveSnapshot ? (
                  <button
                    onClick={handleSaveSnapshot}
                    disabled={isSaving}
                    className="px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    <span className="text-xs text-orange-800 font-medium whitespace-nowrap">
                      {isSaving ? "저장 중..." : "판매/재고 스냅샷 저장"}
                    </span>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
