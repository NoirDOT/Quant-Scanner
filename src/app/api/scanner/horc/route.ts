// src/app/api/scanner/horc/route.ts
// HORC scanner API endpoint — runs the HORC orchestrator on a symbol+timeframe.
//
// POST /api/scanner/horc
//   body: { symbol, display?, assetClass?, timeframe?, scanAll?: boolean }
//   returns: { count, signals: ScanSignal[], meta }

import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";
import { HORC_SCANNERS, HORC_SCANNERS_INFO } from "@/lib/scanner/strategies/horc";
import { applyGrade } from "@/lib/scanner/grading";
import type { ScanSignal } from "@/lib/scanner/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    symbol,
    display,
    assetClass,
    timeframe = "4h",
    scanAll = true,
    strategies,
  } = body;

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const tf = (timeframe as Timeframe) || "4h";
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) ||
    { symbol, display: display ?? symbol, assetClass: assetClass ?? "forex" };

  const candles = await getCandles(inst.symbol, tf);
  if (candles.length < 100) {
    return NextResponse.json({
      error: `Insufficient data (${candles.length} bars — need at least 100 for HORC)`,
    }, { status: 400 });
  }

  // Run HORC scanners
  const scannersToRun = strategies && strategies.length > 0
    ? Object.entries(HORC_SCANNERS).filter(([k]) => strategies.includes(k))
    : (scanAll ? Object.entries(HORC_SCANNERS) : [Object.entries(HORC_SCANNERS)[0]]);

  const signals: ScanSignal[] = [];
  for (const [key, fn] of scannersToRun) {
    try {
      const signal = await fn({
        symbol: inst.symbol,
        display: inst.display,
        assetClass: inst.assetClass,
        timeframe: tf,
        candles,
      });
      if (signal) {
        applyGrade(signal);
        signals.push(signal);
      }
    } catch (err) {
      console.error(`[horc] scanner ${key} failed:`, err);
    }
  }

  signals.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    count: signals.length,
    signals,
    meta: {
      symbol: inst.symbol,
      timeframe: tf,
      candleCount: candles.length,
      scannersRun: scannersToRun.length,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    family: "horc",
    strategies: HORC_SCANNERS_INFO,
    chapters: [
      "Ch 1-2: Origin + permanent/relative structure",
      "Ch 3  : Opening-range cycle (ORH/ORL/ORT/flip)",
      "Ch 4  : Coordinates (M/W/D participant signs)",
      "Ch 5  : Opposition rule + gap exception",
      "Ch 6-7: Liquidity tiers (internal/external, premium/discount)",
      "Ch 8-9: Zones (supply/demand, mitigation)",
      "Ch 10 : Areas of interest (source/path/destination)",
      "Ch 11 : Intraday liquidity (elapsed-time calculation)",
      "Ch 12 : Chart walkthrough (composite orchestrator)",
    ],
  });
}
