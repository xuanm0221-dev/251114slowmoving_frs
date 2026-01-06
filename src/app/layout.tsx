import type { Metadata } from "next";
import "./globals.css";
import { ReferenceMonthProvider } from "@/contexts/ReferenceMonthContext";

export const metadata: Metadata = {
  title: "악세사리 판매매출 요약",
  description: "브랜드별 악세사리 판매매출 월별 요약 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body>
        <ReferenceMonthProvider>
          <div className="min-h-screen bg-gray-50">
            {children}
          </div>
        </ReferenceMonthProvider>
      </body>
    </html>
  );
}
