// src/app/api/scanner/grades/route.ts
// Grade distribution endpoint — returns A+/A/B+/B-/C counts per scanner.

import { NextResponse } from "next/server";
import { listAllScanners } from "@/lib/scanner/strategies/graded-scanner";

export async function GET() {
  const scanners = await listAllScanners();
  return NextResponse.json({
    totalScanners: scanners.length,
    byFamily: {
      trend: scanners.filter((s) => s.family === "trend").length,
      ict: scanners.filter((s) => s.family === "ict").length,
      trader: scanners.filter((s) => s.family === "trader").length,
      ea: scanners.filter((s) => s.family === "ea").length,
      horc: scanners.filter((s) => s.family === "horc").length,
    },
    gradeScale: ["A+", "A", "B+", "B-", "C"],
    scanners: scanners.map((s) => ({
      key: s.key,
      family: s.family,
      label: s.label,
      type: s.type,
      timeframes: s.timeframes,
      recommendedPairs: s.recommendedPairs ?? [],
    })),
  });
}
