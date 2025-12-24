import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface ForecastInventoryMonthData {
  Shoes?: number;
  Headwear?: number;
  Bag?: number;
  Acc_etc?: number;
}

interface ForecastInventoryData {
  [month: string]: ForecastInventoryMonthData;
}

interface ForecastInventorySummaryData {
  brands: {
    [brand: string]: ForecastInventoryData;
  };
  metadata?: {
    [brand: string]: {
      lastUpdated: string;
    };
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { brand, data } = req.body;

    if (!brand || !data) {
      return res.status(400).json({ error: "Brand and data are required" });
    }

    // JSON 파일 경로
    const filePath = path.join(
      process.cwd(),
      "public",
      "data",
      "accessory_forecast_inventory_summary.json"
    );

    // 기존 데이터 읽기
    let existingData: ForecastInventorySummaryData;
    try {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      existingData = JSON.parse(fileContent);
    } catch (error) {
      // 파일이 없으면 기본 구조 생성
      existingData = { brands: {} };
    }

    // 해당 브랜드 데이터 업데이트
    existingData.brands[brand] = data;

    // 메타데이터 업데이트 (마지막 수정 시간)
    if (!existingData.metadata) {
      existingData.metadata = {};
    }
    existingData.metadata[brand] = {
      lastUpdated: new Date().toISOString(),
    };

    // 파일에 쓰기 (포맷팅 적용)
    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), "utf-8");

    // 로컬 개발 환경에서만 자동 Git commit & push
    let gitPushStatus = "skipped (production)";
    if (process.env.NODE_ENV === "development") {
      try {
        const timestamp = new Date().toLocaleString("ko-KR", { 
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit", 
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });
        const commitMessage = `입고예정 재고자산 업데이트 (${brand}) - ${timestamp}`;
        
        // Git 명령 실행
        execSync("git add public/data/accessory_forecast_inventory_summary.json", { 
          cwd: process.cwd(),
          stdio: "pipe" 
        });
        execSync(`git commit -m "${commitMessage}"`, { 
          cwd: process.cwd(),
          stdio: "pipe" 
        });
        execSync("git push", { 
          cwd: process.cwd(),
          stdio: "pipe" 
        });
        
        gitPushStatus = "success";
        console.log(`✅ 자동 Git push 완료: ${commitMessage}`);
      } catch (error) {
        gitPushStatus = "failed";
        console.error("⚠️ 자동 Git push 실패 (수동으로 푸시 필요):", error);
        // 파일 저장은 성공했으므로 에러를 throw하지 않음
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: "Forecast inventory data saved successfully",
      gitPush: gitPushStatus
    });
  } catch (error) {
    console.error("Failed to save forecast inventory:", error);
    return res.status(500).json({ 
      error: "Failed to save data",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

