// POST /api/scanner/forge/discover
// Genetic strategy generation — auto-discovers strategies that work on the
// given instrument. Returns ranked candidates with IS + OOS metrics.
//
// Body:
//   { symbol: string, timeframe?: "1d"|"4h", population?: number, generations?: number }
//
// Auth: requires API_SECRET or CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCandles } from "@/lib/scanner/data";
import { candlesToBars, getCosts } from "@/lib/scanner/forge/market";
import { discover } from "@/lib/scanner/forge/search";
import { splitIndexes } from "@/lib/scanner/forge/types";
import { INSTRUMENTS } from "@/lib/scanner/instruments";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  symbol: z.string(),
  timeframe: z.enum(["1d", "4h", "1h"]).default("1d"),
  population: z.number().int().min(8).max(64).default(16),
  generations: z.number().int().min(1).max(10).default(3),
  seed: z.number().optional(),
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
  const { symbol, timeframe, population, generations, seed } = parsed.data;

  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const assetClass = inst?.assetClass ?? "forex";
  const costs = getCosts(symbol, assetClass);

  try {
    const candles = await getCandles(symbol, timeframe as any, 1000);
    if (candles.length < 100) {
      return NextResponse.json(
        { ok: false, error: `Not enough data: only ${candles.length} bars` },
        { status: 400 },
      );
    }

    const bars = candlesToBars(candles);
    const splits = splitIndexes(bars.length);

    const candidates = discover({
      bars,
      costs,
      is: splits.is,
      val: splits.val,
      population,
      generations,
      seed,
    });

    return NextResponse.json({
      ok: true,
      symbol,
      timeframe,
      candidates: candidates.map((c) => ({
        strategy: c.strategy,
        isMetrics: c.isMetrics,
        valMetrics: c.valMetrics,
        score: c.score,
      })),
    });
  } catch (err) {
    console.error("[forge/discover] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
