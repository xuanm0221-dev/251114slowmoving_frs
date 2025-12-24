import Link from "next/link";
import Navigation from "@/components/Navigation";
import { BRANDS } from "@/types/sales";
import { PRODUCT_TYPE_RULES, CHANNEL_RULES } from "@/constants/businessRules";

export default function Home() {
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
            2024.01 ~ 2025.11 (총 23개월) 데이터 분석
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
              <li>• 분석 기간: 2024.01 ~ 2025.11</li>
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
            <h3 className="text-lg font-semibold text-white mb-4">🔵 Snowflake</h3>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li className="font-semibold text-blue-300">배치 전처리:</li>
              <li className="ml-2">• 판매/재고 데이터</li>
              <li className="font-semibold text-blue-300 mt-2">실시간 API:</li>
              <li className="ml-2">• 실제 입고</li>
              <li className="ml-2">• 정체재고 분석</li>
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

        {/* 데이터 전처리 안내 */}
        <div className="mt-6 p-6 bg-blue-900/20 border border-blue-700/30 rounded-xl">
          <h3 className="text-lg font-semibold text-white mb-4 text-center">
            💡 데이터 전처리 안내
          </h3>
          
          <div className="space-y-6">
            {/* Snowflake 배치 전처리 */}
            <div>
              <h4 className="text-sm font-semibold text-blue-300 mb-3">
                🔵 Snowflake 데이터 가져오기 (필수)
              </h4>
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <code className="px-4 py-2 bg-gray-900 rounded-lg text-gray-300 font-mono text-sm">
                    python scripts/preprocess_sales.py
                  </code>
                  <span className="text-xs text-gray-500 ml-1">
                    → CHN.DW_SALE에서 판매매출 데이터 가져오기
                  </span>
                </div>
                
                <div className="flex flex-col gap-1">
                  <code className="px-4 py-2 bg-gray-900 rounded-lg text-gray-300 font-mono text-sm">
                    python scripts/preprocess_inventory.py
                  </code>
                  <span className="text-xs text-gray-500 ml-1">
                    → CHN.DW_STOCK_M에서 재고자산 데이터 가져오기
                  </span>
                </div>
              </div>
            </div>

            {/* 입고예정 재고자산 관리 */}
            <div>
              <h4 className="text-sm font-semibold text-purple-300 mb-3">
                💾 입고예정 재고자산 관리 (대시보드)
              </h4>
              <ul className="text-xs text-gray-400 space-y-1.5 ml-4">
                <li>• 각 브랜드 페이지에서 직접 수정 및 저장</li>
                <li>• 저장 시 JSON 파일에 영구 저장</li>
                <li>• 로컬 환경: 자동 Git commit & push → Vercel 배포</li>
                <li>• 마지막 업데이트 날짜 자동 기록</li>
              </ul>
            </div>

            {/* 자동 조회 안내 */}
            <div className="pt-4 border-t border-gray-700">
              <h4 className="text-sm font-semibold text-green-300 mb-2">
                ✅ 자동 조회되는 데이터 (전처리 불필요)
              </h4>
              <ul className="text-xs text-gray-400 space-y-1 ml-4">
                <li>• 실제 입고 데이터 (Snowflake 실시간 API)</li>
                <li>• 정체재고 분석 (Snowflake 실시간 API)</li>
                <li>• 재고 시즌 차트 (Snowflake 실시간 API)</li>
                <li>• 품목 상세 정보 (Snowflake 실시간 API)</li>
                <li>• 대리상 마스터 (로컬 CSV 자동 로드)</li>
              </ul>
            </div>

            {/* UI 입력 안내 */}
            <div className="pt-2">
              <h4 className="text-sm font-semibold text-yellow-300 mb-2">
                ✏️ 대시보드에서 직접 수정 (입고예정)
              </h4>
              <ul className="text-xs text-gray-400 space-y-1 ml-4">
                <li>• 각 브랜드 페이지 → 입고예정 재고자산 섹션</li>
                <li>• 숫자 수정 → [YY.MM.DD 업데이트] 버튼 클릭</li>
                <li>• JSON 파일 저장 + 자동 Git push (로컬)</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

