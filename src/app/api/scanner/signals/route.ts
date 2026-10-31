// /home/z/my-project/build/hubb-final/HUBB/src/app/api/scanner/signals/route.ts
// Layer 2 strategy endpoint — full execution rule sets with entry/stop/target/R:R/score.
//
// Reconstructed from Untitled.txt:
//   "Build /api/scanner/signals (full strategy execution)"
//   Takes ScanCandidate[] + ScanContext → ExecutionSignal[].

import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";
import { runGradedScan } from "@/lib/scanner/strategies/graded-scanner";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    strategyType = "all",
    strategies,
    instruments: requestedInstruments,
    timeframes = ["1h", "4h"],
    minScore = 50,
    minGrade,
  } = body;

  const instruments = requestedInstruments && requestedInstruments.length > 0
    ? requestedInstruments.map((s: string) => {
        const found = INSTRUMENTS.find((i) => i.symbol === s || i.display.replace("/", "") === s);
        return found ?? { symbol: s, display: s, assetClass: "forex" as const };
      })
    : INSTRUMENTS.slice(0, 18);

  const tfs = timeframes as Timeframe[];

  // Fetch candles
  const candlesBySymbolTf = new Map<string, import("@/lib/scanner/data").Candle[]>();
  for (const inst of instruments) {
    for (const tf of tfs) {
      try {
        const candles = await getCandles(inst.symbol, tf);
        candlesBySymbolTf.set(`${inst.symbol}:${tf}`, candles);
      } catch (err) {
        console.error(`[signals] getCandles(${inst.symbol}, ${tf}) failed:`, err);
      }
    }
  }

  const signals = await runGradedScan(candlesBySymbolTf, {
    strategyType,
    strategies,
    instruments,
    timeframes: tfs,
    minScore,
    minGrade,
  });

  return NextResponse.json({
    count: signals.length,
    signals,
    meta: {
      strategyType,
      strategies: strategies ?? "all",
      instrumentsScanned: instruments.length,
      timeframesScanned: tfs,
      minScore,
      minGrade,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    description: "Layer 2 strategy endpoint — full execution with entry/stop/target/R:R/grade",
  });
}
