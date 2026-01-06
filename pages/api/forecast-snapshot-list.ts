import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ snapshots: string[] } | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const snapshotsDir = path.join(process.cwd(), "public", "data", "snapshots");
    
    if (!fs.existsSync(snapshotsDir)) {
      return res.status(200).json({ snapshots: [] });
    }

    const files = fs.readdirSync(snapshotsDir);
    const snapshotMonths = files
      .filter((file) => file.match(/accessory_forecast_inventory_summary_(\d{6})\.json/))
      .map((file) => {
        const match = file.match(/_(\d{6})\.json/);
        if (match) {
          const yyyymm = match[1];
          return `${yyyymm.slice(0, 4)}.${yyyymm.slice(4)}`;
        }
        return null;
      })
      .filter((month): month is string => month !== null);

    // 중복 제거 및 정렬
    const uniqueMonths = Array.from(new Set(snapshotMonths)).sort((a, b) => {
      const [yearA, monthA] = a.split(".").map(Number);
      const [yearB, monthB] = b.split(".").map(Number);
      if (yearA !== yearB) return yearA - yearB;
      return monthA - monthB;
    });

    res.status(200).json({ snapshots: uniqueMonths });
  } catch (error) {
    console.error("[forecast-snapshot-list] Error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list forecast snapshots",
    });
  }
}

