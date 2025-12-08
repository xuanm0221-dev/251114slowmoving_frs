import Link from "next/link";
import Navigation from "@/components/Navigation";
import { BRANDS } from "@/types/sales";

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
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">📊 데이터 범위</h3>
            <ul className="space-y-2 text-gray-400">
              <li>• 분석 기간: 2024.01 ~ 2025.11 (23개월)</li>
              <li>• 대상 브랜드: MLB, MLB KIDS, DISCOVERY</li>
              <li>• 대상 카테고리: 饰品 (악세사리)</li>
              <li>• 아이템: Shoes, Headwear, Bag, Acc_etc</li>
            </ul>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">📈 집계 기준</h3>
            <ul className="space-y-2 text-gray-400">
              <li>• 전체판매: FRS(대리상) + OR(직영) 합계</li>
              <li>• 주력상품: INTRO/FOCUS 또는 24FW~26SS 시즌</li>
              <li>• 아울렛상품: OUTLET/CARE/DONE 또는 기타</li>
              <li>• 금액 단위: M (백만 위안, 吊牌金额 기준)</li>
            </ul>
          </div>
        </div>

        {/* 안내 메시지 */}
        <div className="mt-12 p-6 bg-blue-900/20 border border-blue-700/30 rounded-xl text-center">
          <p className="text-gray-900 mb-4">
            💡 데이터가 표시되지 않는 경우, 전처리 스크립트를 먼저 실행해주세요:
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <code className="px-4 py-2 bg-gray-900 rounded-lg text-gray-300 font-mono text-sm">
                python scripts/preprocess_sales.py
              </code>
              <span className="text-xs text-gray-500">판매매출 및 재고자산 데이터 전처리</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <code className="px-4 py-2 bg-gray-900 rounded-lg text-gray-300 font-mono text-sm">
                python scripts/preprocess_inventory.py
              </code>
              <span className="text-xs text-gray-500">재고자산 데이터 전처리</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <code className="px-4 py-2 bg-gray-900 rounded-lg text-gray-300 font-mono text-sm">
                python scripts/preprocess_forecast_inventory.py
              </code>
              <span className="text-xs text-gray-500">입고예정 재고자산 데이터 전처리</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <code className="px-4 py-2 bg-gray-900 rounded-lg text-gray-300 font-mono text-sm">
                python scripts/preprocess_actual_arrival.py
              </code>
              <span className="text-xs text-gray-500">실제 입고 재고자산 데이터 전처리</span>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

