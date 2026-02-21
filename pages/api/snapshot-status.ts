import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");

// 브랜드 코드 매핑 (이름 → 코드)
const BRAND_NAME_TO_CODE: Record<string, string> = {
  MLB: "M",
  "MLB KIDS": "I",
  DISCOVERY: "X",
};

interface SnapshotStatusResponse {
  dealer: boolean;
  sales: boolean;
  stagnant: boolean;
  arrival: boolean;
}

function fileExists(filename: string): boolean {
  return fs.existsSync(path.join(DATA_DIR, filename));
}

function readJsonSafe<T>(filename: string): T | null {
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<SnapshotStatusResponse | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { referenceMonth, brand } = req.query;

  if (!referenceMonth || typeof referenceMonth !== "string") {
    return res.status(400).json({ error: "referenceMonth is required (YYYY.MM format)" });
  }
  if (!brand || typeof brand !== "string") {
    return res.status(400).json({ error: "brand is required" });
  }

  // referenceMonth: YYYY.MM → YYYYMM
  const yyyymm = referenceMonth.replace(".", "");
  const brandCode = BRAND_NAME_TO_CODE[brand] || brand;

  // (1) dealer: dealer_core_outlet_summary.json → brands[brand][YYYYMM]
  let dealerSaved = false;
  const dealerData = readJsonSafe<{ brands: Record<string, Record<string, any>> }>(
    "dealer_core_outlet_summary.json"
  );
  if (dealerData?.brands?.[brand]?.[yyyymm]) {
    dealerSaved = true;
  }

  // (2) sales: accessory_sales_summary.json → brands[brand]["전체"][YYYY.MM]
  let salesSaved = false;
  const salesData = readJsonSafe<{ brands: Record<string, Record<string, Record<string, any>>> }>(
    "accessory_sales_summary.json"
  );
  if (salesData?.brands?.[brand]?.["전체"]?.[referenceMonth]) {
    salesSaved = true;
  }

  // (3) stagnant: stagnant_stock_summary.json → brands[brandCode][YYYYMM]["컬러&사이즈"]
  let stagnantSaved = false;
  const stagnantData = readJsonSafe<{ brands: Record<string, Record<string, Record<string, any>>> }>(
    "stagnant_stock_summary.json"
  );
  if (stagnantData?.brands?.[brandCode]?.[yyyymm]?.["컬러&사이즈"]) {
    stagnantSaved = true;
  }

  // (4) arrival: accessory_actual_arrival_summary.json → brands[brand][YYYY.MM]
  let arrivalSaved = false;
  const arrivalData = readJsonSafe<{ brands: Record<string, Record<string, any>> }>(
    "accessory_actual_arrival_summary.json"
  );
  if (arrivalData?.brands?.[brand]?.[referenceMonth]) {
    arrivalSaved = true;
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.status(200).json({
    dealer: dealerSaved,
    sales: salesSaved,
    stagnant: stagnantSaved,
    arrival: arrivalSaved,
  });
}
