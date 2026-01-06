import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; message: string } | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { month } = req.body; // "2025.12" 형식

    if (!month || typeof month !== "string") {
      return res.status(400).json({ error: "Month is required" });
    }

    // "2025.12" -> "202512"
    const yyyymm = month.replace(".", "");

    const dataDir = path.join(process.cwd(), "public", "data");
    const snapshotsDir = path.join(dataDir, "snapshots");

    // snapshots 디렉토리 생성
    if (!fs.existsSync(snapshotsDir)) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
    }

    // 입고예정자산 데이터 복사
    const forecastSource = path.join(dataDir, "accessory_forecast_inventory_summary.json");
    const forecastSnapshot = path.join(snapshotsDir, `accessory_forecast_inventory_summary_${yyyymm}.json`);

    if (!fs.existsSync(forecastSource)) {
      return res.status(400).json({ error: "입고예정자산 데이터 파일이 없습니다." });
    }
    fs.copyFileSync(forecastSource, forecastSnapshot);

    res.status(200).json({
      success: true,
      message: `${month} 입고예정자산 스냅샷이 저장되었습니다.`,
    });
  } catch (error) {
    console.error("[save-forecast-snapshot] Error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to save forecast snapshot",
    });
  }
}

