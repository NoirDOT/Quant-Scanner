// app/api/scanner/strategies/route.ts
import { NextResponse } from "next/server";
import { listAllStrategies } from "@/lib/scanner/strategies/all";

export async function GET() {
  const strategies = await listAllStrategies();
  return NextResponse.json({
    layer: 3,
    description: "Full execution rulebooks — return Signal with entry/stop/target/R:R/grade",
    count: strategies.length,
    byFamily: {
      trend: strategies.filter((s) => s.family === "trend").length,
      ict: strategies.filter((s) => s.family === "ict").length,
      trader: strategies.filter((s) => s.family === "trader").length,
      ea: strategies.filter((s) => s.family === "ea").length,
      horc: strategies.filter((s) => s.family === "horc").length,
      community: strategies.filter((s) => s.family === "community").length,
    },
    strategies: strategies.map((s) => ({
      key: s.key, family: s.family, label: s.label, description: s.description,
      timeframes: s.timeframes, usesDetectors: s.usesDetectors ?? [],
      recommendedPairs: s.recommendedPairs ?? [],
      avoidPairs: s.avoidPairs ?? [],
      backtestStats: s.backtestStats,
    })),
  });
}
