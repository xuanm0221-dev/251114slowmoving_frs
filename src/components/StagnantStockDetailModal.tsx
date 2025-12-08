"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { StagnantStockItem } from "@/types/stagnantStock";

interface ItemMonthlyData {
  month: string;
  stock_qty: number;
  stock_amt: number;
  sales_amt: number;
}

interface ItemDetailData {
  item: {
    prdt_cd: string;
    prdt_nm: string;
    mid_category_kr: string;
    season: string;
    dimensionKey: string;
  };
  currentYear: ItemMonthlyData[];
  previousYear: ItemMonthlyData[];
  meta: {
    brand: string;
    dimensionTab: string;
  };
}

interface StagnantStockDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StagnantStockItem;
  brand: string;
  dimensionTab: string;
}

// 숫자 포맷팅
function formatNumber(num: number): string {
  return Math.round(num).toLocaleString("ko-KR");
}

function formatAmountK(num: number): string {
  return Math.round(num / 1_000).toLocaleString("ko-KR") + "K";
}

// 재고주수 계산
function calcStockWeeks(stockAmt: number, salesAmt: number, daysInMonth: number = 30): string {
  if (salesAmt <= 0) return "-";
  const weekSales = (salesAmt / daysInMonth) * 7;
  if (weekSales <= 0) return "-";
  const weeks = stockAmt / weekSales;
  return weeks.toFixed(1) + "주";
}

// 월의 일수
function getDaysInMonth(yyyymm: string): number {
  if (yyyymm.length !== 6) return 30;
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return new Date(year, month, 0).getDate();
}

export default function StagnantStockDetailModal({
  isOpen,
  onClose,
  item,
  brand,
  dimensionTab,
}: StagnantStockDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ItemDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          brand,
          prdt_cd: item.prdt_cd,
          dimensionTab,
        });

        if (item.color_cd) {
          params.append("color_cd", item.color_cd);
        }
        if (item.size_cd) {
          params.append("size_cd", item.size_cd);
        }

        const response = await fetch(`/api/item-detail?${params}`);
        if (!response.ok) {
          throw new Error("데이터를 불러오는데 실패했습니다.");
        }

        const result: ItemDetailData = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, item, brand, dimensionTab]);

  if (!isOpen) return null;

  // 차트 데이터 생성 (K 단위)
  const chartData = data
    ? data.currentYear.map((curr, idx) => {
        const prev = data.previousYear[idx];
        const monthNum = parseInt(curr.month.slice(-2));
        return {
          month: `${monthNum}월`,
          curr_stock: curr.stock_amt / 1_000,
          curr_sales: curr.sales_amt / 1_000,
          prev_stock: prev ? prev.stock_amt / 1_000 : 0,
          prev_sales: prev ? prev.sales_amt / 1_000 : 0,
        };
      })
    : [];

  // 최근 월 데이터 (25년 11월 또는 마지막 월)
  const latestData = data?.currentYear[data.currentYear.length - 1];
  const latestPrevData = data?.previousYear[data.previousYear.length - 1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 배경 오버레이 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* 모달 콘텐츠 */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto m-4">
        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{item.dimensionKey}</h2>
            <p className="text-sm text-gray-600 mt-1">{item.prdt_nm}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">데이터 로딩 중...</span>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {data && latestData && (
            <>
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">시즌</div>
                  <div className="text-lg font-semibold text-gray-800">{data.item.season}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">중분류</div>
                  <div className="text-lg font-semibold text-gray-800">{data.item.mid_category_kr}</div>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">재고주수</div>
                  <div className="text-lg font-semibold text-blue-700">
                    {calcStockWeeks(latestData.stock_amt, latestData.sales_amt, getDaysInMonth(latestData.month))}
                  </div>
                </div>
                <div className={`p-3 rounded-lg ${item.status === "정체재고" ? "bg-red-50" : "bg-green-50"}`}>
                  <div className="text-xs text-gray-600 mb-1">상태</div>
                  <div className={`text-lg font-semibold ${item.status === "정체재고" ? "text-red-700" : "text-green-700"}`}>
                    {item.status}
                  </div>
                </div>
              </div>

              {/* 당년/전년 비교 테이블 */}
              <div className="mb-6">
                <h3 className="text-md font-bold text-gray-800 mb-3">당년/전년 비교</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr className="border-b border-gray-300">
                        <th className="text-left py-2 px-3 font-medium text-gray-600"></th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">당년 (25년)</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">전년 (24년)</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">YOY</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-200">
                        <td className="py-2 px-3 text-gray-700">기말재고</td>
                        <td className="text-right py-2 px-3 font-medium text-gray-900">
                          {formatAmountK(latestData.stock_amt)}
                        </td>
                        <td className="text-right py-2 px-3 text-gray-700">
                          {latestPrevData ? formatAmountK(latestPrevData.stock_amt) : "-"}
                        </td>
                        <td className="text-right py-2 px-3 font-medium text-pink-600">
                          {latestPrevData && latestPrevData.stock_amt > 0
                            ? ((latestData.stock_amt / latestPrevData.stock_amt) * 100).toFixed(1) + "%"
                            : "-"}
                        </td>
                      </tr>
                      <tr className="border-b border-gray-200">
                        <td className="py-2 px-3 text-gray-700">판매액(V+)</td>
                        <td className="text-right py-2 px-3 font-medium text-gray-900">
                          {formatAmountK(latestData.sales_amt)}
                        </td>
                        <td className="text-right py-2 px-3 text-gray-700">
                          {latestPrevData ? formatAmountK(latestPrevData.sales_amt) : "-"}
                        </td>
                        <td className="text-right py-2 px-3 font-medium text-pink-600">
                          {latestPrevData && latestPrevData.sales_amt > 0
                            ? ((latestData.sales_amt / latestPrevData.sales_amt) * 100).toFixed(1) + "%"
                            : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-gray-700">재고주수</td>
                        <td className="text-right py-2 px-3 font-medium text-gray-900">
                          {calcStockWeeks(latestData.stock_amt, latestData.sales_amt, getDaysInMonth(latestData.month))}
                        </td>
                        <td className="text-right py-2 px-3 text-gray-700">
                          {latestPrevData
                            ? calcStockWeeks(latestPrevData.stock_amt, latestPrevData.sales_amt, getDaysInMonth(latestPrevData.month))
                            : "-"}
                        </td>
                        <td className="text-right py-2 px-3 font-medium text-pink-600">
                          {(() => {
                            if (!latestPrevData) return "-";
                            const currWeeks = latestData.sales_amt > 0 
                              ? latestData.stock_amt / ((latestData.sales_amt / getDaysInMonth(latestData.month)) * 7)
                              : 0;
                            const prevWeeks = latestPrevData.sales_amt > 0
                              ? latestPrevData.stock_amt / ((latestPrevData.sales_amt / getDaysInMonth(latestPrevData.month)) * 7)
                              : 0;
                            if (prevWeeks === 0) return "-";
                            const yoy = ((currWeeks / prevWeeks) * 100).toFixed(1);
                            return `+${parseFloat(yoy) >= 0 ? yoy : yoy}주`;
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 월별 추이 차트 */}
              <div>
                <h3 className="text-md font-bold text-gray-800 mb-3">
                  월별 재고/판매 추이 (최근 {chartData.length}개월)
                </h3>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 12, fill: "#6b7280" }}
                        axisLine={{ stroke: "#d1d5db" }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 12, fill: "#6b7280" }}
                        axisLine={{ stroke: "#d1d5db" }}
                        tickFormatter={(value) => `${formatNumber(value)}K`}
                        label={{ value: "재고금액", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 12, fill: "#6b7280" }}
                        axisLine={{ stroke: "#d1d5db" }}
                        tickFormatter={(value) => `${formatNumber(value)}K`}
                        label={{ value: "판매금액", angle: 90, position: "insideRight", style: { fontSize: 12 } }}
                      />
                      <Tooltip
                        formatter={(value: number) => formatAmountK(value * 1_000)}
                        labelStyle={{ color: "#374151" }}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="curr_stock" fill="#3b82f6" name="25년 재고" />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="curr_sales"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ fill: "#f59e0b", r: 4 }}
                        name="25년 판매"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* 재고 YOY / 판매 YOY */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-blue-50 p-3 rounded-lg text-center">
                    <div className="text-xs text-gray-600 mb-1">재고 YOY</div>
                    <div className="text-xl font-bold text-blue-700">
                      {latestPrevData && latestPrevData.stock_amt > 0
                        ? ((latestData.stock_amt / latestPrevData.stock_amt - 1) * 100).toFixed(1) + "%"
                        : "-"}
                    </div>
                  </div>
                  <div className="bg-orange-50 p-3 rounded-lg text-center">
                    <div className="text-xs text-gray-600 mb-1">판매 YOY</div>
                    <div className="text-xl font-bold text-orange-700">
                      {latestPrevData && latestPrevData.sales_amt > 0
                        ? ((latestData.sales_amt / latestPrevData.sales_amt - 1) * 100).toFixed(1) + "%"
                        : "-"}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
