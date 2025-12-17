"use client";

import { useState, ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  icon: string;
  iconColor: string;
  children: ReactNode;
  defaultOpen?: boolean;
  legend?: ReactNode;
  headerAction?: ReactNode; // 헤더 우측에 표시할 액션 요소
  titleExtra?: ReactNode; // 제목 옆에 표시할 추가 요소
}

export default function CollapsibleSection({
  title,
  icon,
  iconColor,
  children,
  defaultOpen = true,
  legend,
  headerAction,
  titleExtra,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="card">
      {/* 헤더 영역: 제목 + 범례 + 토글 */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 text-left group"
          >
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <span className={iconColor}>{icon}</span>
              {title}
            </h2>
            {titleExtra && (
              <div onClick={(e) => e.stopPropagation()} className="ml-3">
                {titleExtra}
              </div>
            )}
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-gray-400">
                {isOpen ? "접기" : "펼치기"}
              </span>
              <svg
                className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </button>
          {headerAction && (
            <div onClick={(e) => e.stopPropagation()}>
              {headerAction}
            </div>
          )}
        </div>
        
        {/* 범례 - 항상 보임 */}
        {legend && (
          <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            {legend}
          </div>
        )}
      </div>
      
      <div
        className={`transition-all duration-300 overflow-hidden ${
          isOpen ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
