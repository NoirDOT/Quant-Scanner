// POST /api/scanner/forge/walk-forward
// Walk-forward validation — splits data into rolling windows, optimizes on
// IS portion, tests on OOS portion. Reports decay (OOS/IS Sharpe ratio).
//
// Body:
//   { strategy: Strategy, symbol: string, timeframe?: "1d"|"4h", windows?: number }
//
// Auth: requires API_SECRET or CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCandles } from "@/lib/scanner/data";
import { candlesToBars, getCosts } from "@/lib/scanner/forge/market";
import { walkForward } from "@/lib/scanner/forge/search";
import type { Strategy } from "@/lib/scanner/forge/types";
import { INSTRUMENTS } from "@/lib/scanner/instruments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return true;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

const BodySchema = z.object({
  strategy: z.any(),
  symbol: z.string(),
  timeframe: z.enum(["1d", "4h", "1h"]).default("1d"),
  windows: z.number().int().min(2).max(10).default(4),
});

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { strategy, symbol, timeframe, windows } = parsed.data;

  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const assetClass = inst?.assetClass ?? "forex";
  const costs = getCosts(symbol, assetClass);

  try {
    const candles = await getCandles(symbol, timeframe as any, 1000);
    if (candles.length < 200) {
      return NextResponse.json(
        { ok: false, error: `Not enough data: only ${candles.length} bars (need 200+)` },
        { status: 400 },
      );
    }

    const bars = candlesToBars(candles);
    const wf = walkForward({
      bars,
      strategy: strategy as Strategy,
      costs,
      from: 80,
      to: bars.length - 1,
      windows,
    });

    const avgDecay = wf.length > 0 ? wf.reduce((s, w) => s + w.decay, 0) / wf.length : 0;
    const robust = avgDecay > 0.5;

    return NextResponse.json({
      ok: true,
      symbol,
      timeframe,
      windows: wf,
      avgDecay,
      robust,
    });
  } catch (err) {
    console.error("[forge/walk-forward] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
