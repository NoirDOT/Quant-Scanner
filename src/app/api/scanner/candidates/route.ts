// src/app/api/scanner/candidates/route.ts
// Layer 1 filter endpoint — lightweight boolean checks (no entry/stop/target).
//
//   "Build /api/scanner/candidates (lightweight filter-only endpoint)"
//   Returns ScanCandidate[] (symbol+tf+direction+reasons, no entry/stop/target).
//   Run every 5 min via Discord bot.

import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";
import { detectFVGs } from "@/lib/scanner/ict/fvg";
import { detectOrderBlocks } from "@/lib/scanner/ict/orderBlocks";
import { detectLiquiditySweeps } from "@/lib/scanner/ict/liquidity";
import { premiumDiscount } from "@/lib/scanner/ict/premiumDiscount";

export interface ScanCandidate {
  symbol: string;
  display: string;
  timeframe: Timeframe;
  direction: "long" | "short" | "neutral";
  reasons: string[];
  filterKeys: string[];
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    instruments: requestedInstruments,
    timeframes = ["1h", "4h"],
    filters = ["fvg", "order-block", "liquidity-sweep", "premium-discount"],
  } = body;

  const instruments = requestedInstruments && requestedInstruments.length > 0
    ? requestedInstruments.map((s: string) => INSTRUMENTS.find((i) => i.symbol === s || i.display.replace("/", "") === s)).filter(Boolean)
    : INSTRUMENTS.slice(0, 20);

  const candidates: ScanCandidate[] = [];

  for (const inst of instruments) {
    if (!inst) continue;
    for (const tf of timeframes as Timeframe[]) {
      const candles = await getCandles(inst.symbol, tf);
      if (candles.length < 50) continue;

      const reasons: string[] = [];
      const filterKeys: string[] = [];

      if (filters.includes("fvg")) {
        const fvgs = detectFVGs(candles);
        const recent = fvgs.slice(-3).filter((f) => !f.mitigated);
        if (recent.length > 0) {
          reasons.push(`FVG: ${recent.length} unmitigated fair value gaps`);
          filterKeys.push("fvg");
        }
      }
      if (filters.includes("order-block")) {
        const obs = detectOrderBlocks(candles);
        const recent = obs.slice(-3).filter((o) => !o.mitigated);
        if (recent.length > 0) {
          reasons.push(`OB: ${recent.length} unmitigated order blocks`);
          filterKeys.push("order-block");
        }
      }
      if (filters.includes("liquidity-sweep")) {
        const sweeps = detectLiquiditySweeps(candles);
        const recent = sweeps.slice(-2);
        if (recent.length > 0) {
          reasons.push(`Liquidity sweep: ${(recent[0] as any)?.type} at ${recent[0]?.price.toFixed(5)}`);
          filterKeys.push("liquidity-sweep");
        }
      }
      if (filters.includes("premium-discount")) {
        const pd = premiumDiscount(candles);
        if (pd) {
          reasons.push(`Premium/Discount: ${(pd[0] as any)?.zone} (${(pd[0] as any)?.percent.toFixed(0)}% of range)`);
          filterKeys.push("premium-discount");
        }
      }

      if (filterKeys.length > 0) {
        const lastPrice = candles[candles.length - 1].close;
        const pd = premiumDiscount(candles);
        const direction: "long" | "short" | "neutral" =
          (pd[0] as any)?.zone === "discount" ? "long" : (pd[0] as any)?.zone === "premium" ? "short" : "neutral";
        candidates.push({
          symbol: inst.symbol,
          display: inst.display,
          timeframe: tf,
          direction,
          reasons,
          filterKeys,
        });
      }
    }
  }

  return NextResponse.json({ count: candidates.length, candidates });
}

export async function GET() {
  return NextResponse.json({
    description: "Layer 1 filter endpoint — lightweight boolean checks, no entry/stop/target",
    availableFilters: [
      "fvg", "order-block", "liquidity-sweep", "premium-discount",
      "bos-choch", "ote", "killzone", "ema-stack", "supertrend", "cisd",
      // GMS filters
      "gms-darvas", "gms-vcp", "gms-cup-handle", "gms-pocket-pivot",
      "gms-near-breakout", "gms-rs-new-high", "gms-trend-template", "gms-stage-2",
    ],
  });
}
