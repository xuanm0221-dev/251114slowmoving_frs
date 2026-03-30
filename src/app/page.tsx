"use client";

import Link from "next/link";
import Navigation from "@/components/Navigation";
import { BRANDS } from "@/types/sales";
import { PRODUCT_TYPE_RULES, CHANNEL_RULES, DATA_INFO, REMARK_PERIODS } from "@/constants/businessRules";
import { useReferenceMonth } from "@/contexts/ReferenceMonthContext";

/**
 * 시작월부터 종료월까지의 개월 수를 계산
 */
function calculateMonths(startMonth: string, endMonth: string): number {
  const [startYear, startM] = startMonth.split(".").map(Number);
  const [endYear, endM] = endMonth.split(".").map(Number);
  return (endYear - startYear) * 12 + (endM - startM) + 1;
}

export default function Home() {
  const { referenceMonth } = useReferenceMonth();
  const startMonth = DATA_INFO.startMonth;
  const totalMonths = calculateMonths(startMonth, referenceMonth);
  return (
    <>
      <Navigation />
      <main className="max-w-[1800px] mx-auto px-6 py-12 mt-14">
        {/* 히어로 섹션 */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            브랜드별 재고주수 대시보드
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            브랜드별 악세사리 재고주수 월별 현황을 한눈에 확인하세요.
            <br />
            {startMonth} ~ {referenceMonth} (총 {totalMonths}개월) 데이터 분석
          </p>
        </div>

        {/* 브랜드 카드 */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {/* MLB - 네이비 */}
          <Link
            href="/mlb-sales"
            className="group relative overflow-hidden rounded-2xl p-8 transition-all duration-300 hover:shadow-xl"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative">
              <h2 className="text-2xl font-bold text-white mb-3">
                MLB
              </h2>
              <p className="text-blue-200 mb-4">
                MLB 브랜드 악세사리 재고주수
              </p>
              <div className="flex items-center text-blue-300 text-sm font-medium">
                <span>상세보기</span>
                <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* MLB KIDS - 환한 노랑 */}
          <Link
            href="/mlb-kids-sales"
            className="group relative overflow-hidden rounded-2xl p-8 transition-all duration-300 hover:shadow-xl"
            style={{ backgroundColor: '#FDE047' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-200/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative">
              <h2 className="text-2xl font-bold text-gray-900 mb-3">
                MLB KIDS
              </h2>
              <p className="text-gray-800 mb-4">
                MLB KIDS 브랜드 악세사리 재고주수
              </p>
              <div className="flex items-center text-gray-900 text-sm font-medium">
                <span>상세보기</span>
                <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* DISCOVERY - 맑은 초록 */}
          <Link
            href="/discovery-sales"
            className="group relative overflow-hidden rounded-2xl p-8 transition-all duration-300 hover:shadow-xl"
            style={{ backgroundColor: '#14B8A6' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-teal-300/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative">
              <h2 className="text-2xl font-bold text-gray-800 mb-3">
                DISCOVERY
              </h2>
              <p className="text-gray-700 mb-4">
                DISCOVERY 브랜드 악세사리 재고주수
              </p>
              <div className="flex items-center text-gray-800 text-sm font-medium">
                <span>상세보기</span>
                <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        </div>

        {/* 정보 섹션 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">📊 데이터 범위</h3>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li>• 분석 기간: {startMonth} ~ {referenceMonth}</li>
              <li>• 브랜드: MLB, MLB KIDS, DISCOVERY</li>
              <li>• 카테고리: 악세사리</li>
              <li>• 아이템: Shoes, Headwear, Bag, Acc_etc</li>
            </ul>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">📈 집계 기준</h3>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li>• {CHANNEL_RULES.total.label}: {CHANNEL_RULES.total.description}</li>
              <li>• {PRODUCT_TYPE_RULES.core.label}: {PRODUCT_TYPE_RULES.core.simpleDescription}</li>
              <li>• {PRODUCT_TYPE_RULES.outlet.label}: {PRODUCT_TYPE_RULES.outlet.simpleDescription}</li>
              <li>• 단위: 吊牌金额</li>
            </ul>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">🔵 데이터 소스</h3>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li className="font-semibold text-blue-300">하이브리드 로딩:</li>
              <li className="ml-2">• 판매/재고: 마감월까지 JSON, 이후 Snowflake API</li>
              <li className="font-semibold text-blue-300 mt-2">실시간 API:</li>
              <li className="ml-2">• 실제 입고, 정체재고, 재고시즌, 품목상세</li>
            </ul>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">📁 기타 데이터</h3>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li>• 대리상 마스터: 로컬 CSV</li>
              <li>• 입고예정: 대시보드에서 직접 관리</li>
            </ul>
          </div>
        </div>

        {/* 2분할: 운영기준 구간(좌) + 데이터 전처리 안내(우) */}
        <div className="mt-6 grid lg:grid-cols-2 gap-6">

          {/* 좌: 운영기준(remark) 구간 안내 */}
          <div className="p-6 bg-gray-900 border border-gray-600 rounded-xl">
            <h3 className="text-base font-bold text-white mb-4 text-center tracking-wide">
              📋 운영기준 (operate_standard) 적용 구간
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="text-left py-2 px-4 text-gray-100 font-semibold text-xs">구간</th>
                    <th className="text-left py-2 px-4 text-gray-100 font-semibold text-xs">적용 기준</th>
                    <th className="text-left py-2 px-4 text-gray-100 font-semibold text-xs">소스 테이블</th>
                  </tr>
                </thead>
                <tbody>
                  {REMARK_PERIODS.map((p, i) => {
                    const isPREP = p.source.startsWith('PREP');
                    return (
                      <tr key={i} className={`border-t border-gray-700 ${isPREP ? 'bg-violet-950' : 'bg-gray-800'}`}>
                        <td className="py-2 px-4 text-gray-100 font-mono text-xs whitespace-nowrap">{p.range}</td>
                        <td className="py-2 px-4 text-xs">
                          <span className={`inline-block px-2 py-0.5 rounded font-semibold ${isPREP ? 'bg-violet-700 text-white' : 'bg-blue-700 text-white'}`}>
                            {p.remark}
                          </span>
                        </td>
                        <td className={`py-2 px-4 text-xs font-medium ${isPREP ? 'text-violet-300' : 'text-gray-300'}`}>{p.source}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-3 justify-center">
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
                <span className="w-3 h-3 rounded bg-blue-700 inline-block"></span> MST (remark1~8)
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
                <span className="w-3 h-3 rounded bg-violet-700 inline-block"></span> PREP (operate_standard)
              </span>
            </div>
          </div>

          {/* 우: 데이터 전처리 안내 */}
          <div className="p-6 bg-gray-900 border border-gray-600 rounded-xl">
            <h3 className="text-base font-bold text-white mb-4 text-center tracking-wide">
              💡 데이터 전처리 안내
            </h3>

            <div className="space-y-4">
              {/* Snowflake 배치 전처리 */}
              <div className="p-3 bg-blue-950 border border-blue-700 rounded-lg">
                <h4 className="text-xs font-bold text-blue-300 mb-2 uppercase tracking-wider">
                  🔵 Snowflake 데이터 전처리 (필수)
                </h4>
                <div className="space-y-2">
                  <div>
                    <code className="block px-3 py-1.5 bg-gray-950 rounded text-cyan-300 font-mono text-xs">
                      python scripts/preprocess_sales.py
                    </code>
                    <span className="text-xs text-gray-400 ml-1">→ 판매매출 전처리 (증분 처리)</span>
                  </div>
                  <div>
                    <code className="block px-3 py-1.5 bg-gray-950 rounded text-cyan-300 font-mono text-xs">
                      python scripts/preprocess_inventory.py
                    </code>
                    <span className="text-xs text-gray-400 ml-1">→ 재고자산 전처리 (증분 처리)</span>
                  </div>
                  <p className="text-xs text-blue-200 mt-1">
                    ※ ANALYSIS_MONTHS에 새 월 추가 시 해당 월만 자동 처리
                  </p>
                </div>
              </div>

              {/* 입고예정 */}
              <div className="p-3 bg-purple-950 border border-purple-700 rounded-lg">
                <h4 className="text-xs font-bold text-purple-300 mb-2 uppercase tracking-wider">
                  💾 입고예정 재고자산 관리
                </h4>
                <ul className="text-xs text-gray-200 space-y-1">
                  <li>• 각 브랜드 페이지에서 직접 수정 및 저장</li>
                  <li>• 기준월 이후 데이터만 수정 가능 (과거 보호)</li>
                  <li>• 로컬 환경: 자동 Git commit &amp; push → Vercel 배포</li>
                </ul>
              </div>

              {/* 마감 & 스냅샷 */}
              <div className="p-3 bg-orange-950 border border-orange-700 rounded-lg">
                <h4 className="text-xs font-bold text-orange-300 mb-2 uppercase tracking-wider">
                  📸 월 마감 및 스냅샷 저장
                </h4>
                <ul className="text-xs text-gray-200 space-y-1">
                  <li>• <span className="text-white font-semibold">월 마감:</span> 해당 월 데이터 JSON 고정 저장</li>
                  <li>• <span className="text-white font-semibold">스냅샷:</span> 판매/재고 스냅샷 별도 저장</li>
                  <li>• 마감월은 JSON 조회로 빠른 로딩</li>
                </ul>
              </div>

              {/* 하이브리드 & UI 수정 */}
              <div className="p-3 bg-green-950 border border-green-700 rounded-lg">
                <h4 className="text-xs font-bold text-green-300 mb-2 uppercase tracking-wider">
                  ✅ 하이브리드 로딩 &amp; 직접 수정
                </h4>
                <ul className="text-xs text-gray-200 space-y-1">
                  <li>• <span className="text-white font-semibold">판매/재고:</span> 마감월 → JSON, 미마감월 → Snowflake</li>
                  <li>• <span className="text-white font-semibold">실시간:</span> 입고·정체재고·시즌차트·품목상세</li>
                  <li>• <span className="text-white font-semibold">입고예정 수정:</span> 브랜드 페이지 → 숫자 수정 → 업데이트 클릭</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      </main>
    </>
  );
}

