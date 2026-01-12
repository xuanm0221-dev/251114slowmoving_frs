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
    const { brand, data, referenceMonth } = req.body;

    if (!brand || !data) {
      return res.status(400).json({ error: "Brand and data are required" });
    }

    // 기준월이 없으면 기본값 사용 (2025.11)
    const endMonth = (referenceMonth as string) || "2025.11";

    // 스냅샷이 저장된 월 목록 가져오기
    const snapshotsDir = path.join(process.cwd(), "public", "data", "snapshots");
    let maxSnapshotMonth: string | null = null;
    
    if (fs.existsSync(snapshotsDir)) {
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
      
      if (snapshotMonths.length > 0) {
        // 가장 최근 스냅샷 월 찾기
        maxSnapshotMonth = snapshotMonths.sort((a, b) => {
          const [yearA, monthA] = a.split(".").map(Number);
          const [yearB, monthB] = b.split(".").map(Number);
          if (yearA !== yearB) return yearB - yearA;
          return monthB - monthA;
        })[0];
      }
    }

    // 보호할 최대 월 결정: 스냅샷이 있으면 스냅샷 월, 없으면 기준월
    // 스냅샷 월이 기준월보다 크면 스냅샷 월을 보호, 아니면 기준월을 보호
    const protectedMonth = maxSnapshotMonth && maxSnapshotMonth > endMonth 
      ? maxSnapshotMonth 
      : endMonth;
    
    // 로깅: 보호되는 월 정보
    if (maxSnapshotMonth) {
      console.log(`[입고예정 저장] 스냅샷 보호: ${maxSnapshotMonth}월 이하 데이터는 변경되지 않습니다.`);
    }
    console.log(`[입고예정 저장] 보호 월: ${protectedMonth}, 기준월: ${endMonth}, 브랜드: ${brand}`);

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

    // 해당 브랜드 데이터 업데이트 (보호된 월 이하는 절대 변경하지 않음)
    const existingBrandData = existingData.brands[brand] || {};
    const mergedData: ForecastInventoryData = {};
    
    // 기존 데이터에서 보호된 월 이하는 유지 (스냅샷 보호)
    Object.keys(existingBrandData).forEach((month) => {
      if (month <= protectedMonth) {
        mergedData[month] = existingBrandData[month];
      }
    });
    
    // 새 데이터에서 보호된 월 이후만 추가
    Object.keys(data).forEach((month) => {
      // 보호된 월 이후만 추가 (보호된 월 이하는 절대 변경하지 않음)
      if (month > protectedMonth) {
        mergedData[month] = data[month];
      }
      // 보호된 월 이하 데이터가 포함되어 있으면 무시 (보안상 안전장치)
    });
    
    existingData.brands[brand] = mergedData;

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

