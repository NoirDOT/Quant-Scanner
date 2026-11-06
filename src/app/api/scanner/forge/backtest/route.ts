// POST /api/scanner/forge/backtest
// Run a realistic backtest of a strategy on a specific instrument.
// Fetches real Yahoo Finance data, applies spread/slippage/commission,
// fills at next bar open, and returns metrics + equity curve + trades.
//
// Body:
//   { strategy: Strategy, symbol: string, timeframe?: "1d"|"4h"|"1h" }
//
// Auth: requires API_SECRET or CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCandles } from "@/lib/scanner/data";
import { candlesToBars, getCosts } from "@/lib/scanner/forge/market";
import { runBacktest, monteCarlo } from "@/lib/scanner/forge/engine";
import { splitIndexes } from "@/lib/scanner/forge/types";
import type { Strategy } from "@/lib/scanner/forge/types";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";

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

const StrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  side: z.enum(["long", "short", "both"]),
  entry: z.array(z.object({
    indicator: z.enum(["rsi", "stoch", "zscore", "bb", "donchian", "sma_dist", "ema_dist", "ret", "atr_pct", "close_loc"]),
    period: z.number().int().min(2).max(200),
    op: z.enum(["lt", "gt", "cross_below", "cross_above"]),
    threshold: z.number(),
  })).min(1).max(10),
  stopAtr: z.number().min(0).max(10),
  targetR: z.number().min(0).max(20),
  maxBars: z.number().int().min(0).max(500),
  scaler: z.enum(["off", "trend", "fade"]),
  memory: z.object({
    enabled: z.boolean(),
    lookback: z.number().int().min(1).max(100),
    op: z.enum(["lt", "gt"]),
    threshold: z.number(),
  }),
});

const BodySchema = z.object({
  strategy: StrategySchema,
  symbol: z.string(),
  timeframe: z.enum(["1d", "4h", "1h"]).default("1d"),
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
  const { strategy, symbol, timeframe } = parsed.data;

  // Find the instrument to get assetClass
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const assetClass = inst?.assetClass ?? "forex";
  const costs = getCosts(symbol, assetClass);

  try {
    // Fetch real Yahoo data
    const candles = await getCandles(symbol, timeframe as Timeframe, 1000);
    if (candles.length < 100) {
      return NextResponse.json(
        { ok: false, error: `Not enough data: only ${candles.length} bars (need 100+)` },
        { status: 400 },
      );
    }

    const bars = candlesToBars(candles);
    const splits = splitIndexes(bars.length);

    // Run backtest on the full research range (IS + validation)
    const result = runBacktest(bars, strategy as Strategy, costs, splits.research);

    // Run Monte Carlo on the trades
    const mc = monteCarlo(result.trades, 400);

    // Also run on IS + OOS separately for comparison
    const isResult = runBacktest(bars, strategy as Strategy, costs, splits.is);
    const oosResult = runBacktest(bars, strategy as Strategy, costs, splits.val);

    return NextResponse.json({
      ok: true,
      symbol,
      timeframe,
      costs,
      bars: bars.length,
      splits,
      full: result.metrics,
      inSample: isResult.metrics,
      outOfSample: oosResult.metrics,
      monteCarlo: mc,
      trades: result.trades.slice(-50),  // last 50 trades for the chart
      equity: result.equity.filter((_, i) => i % Math.max(1, Math.floor(result.equity.length / 200)) === 0),  // downsample for chart
    });
  } catch (err) {
    console.error("[forge/backtest] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
