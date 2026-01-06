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

    // 판매 데이터 복사
    const salesSource = path.join(dataDir, "accessory_sales_summary.json");
    const salesSnapshot = path.join(snapshotsDir, `accessory_sales_summary_${yyyymm}.json`);

    if (!fs.existsSync(salesSource)) {
      return res.status(400).json({ error: "판매 데이터 파일이 없습니다." });
    }
    fs.copyFileSync(salesSource, salesSnapshot);

    // 재고 데이터 복사
    const inventorySource = path.join(dataDir, "accessory_inventory_summary.json");
    const inventorySnapshot = path.join(snapshotsDir, `accessory_inventory_summary_${yyyymm}.json`);

    if (!fs.existsSync(inventorySource)) {
      return res.status(400).json({ error: "재고 데이터 파일이 없습니다." });
    }
    fs.copyFileSync(inventorySource, inventorySnapshot);

    res.status(200).json({
      success: true,
      message: `${month} 스냅샷이 저장되었습니다.`,
    });
  } catch (error) {
    console.error("[save-snapshot] Error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to save snapshot",
    });
  }
}

