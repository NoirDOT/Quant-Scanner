// /api/scanner/backtest — backtest a single scanner strategy
import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";
import { backtestStrategy, type BacktestSummary } from "@/lib/scanner/backtest/engine";
import { listAllStrategies } from "@/lib/scanner/strategies/all";
import { applyGrade } from "@/lib/scanner/grading";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    strategyKey,
    symbol,
    timeframe = "4h",
    startOffset = 250,
    maxBars = 100,
    persist = false,
    sweepAll = false,
  } = body as {
    strategyKey?: string;
    symbol?: string;
    timeframe?: string;
    startOffset?: number;
    maxBars?: number;
    persist?: boolean;
    sweepAll?: boolean;
  };

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) ??
    { symbol, display: symbol, assetClass: "stock" as const };
  const tf = (timeframe as Timeframe) || "4h";

  // Sweep all trend strategies × all timeframes
  if (sweepAll) {
    const strategies = await listAllStrategies();
    const candlesByTf: Record<string, any[]> = {} as any;
    for (const t of ["1h", "2h", "4h", "1d", "1w"] as Timeframe[]) {
      try { candlesByTf[t] = await getCandles(symbol, t); } catch { /* skip */ }
    }
    const results: Array<{ strategyKey: string; timeframe: string; summary: BacktestSummary }> = [];
    for (const s of strategies) {
      if (!s.strategyFn) continue;
      for (const t of Object.keys(candlesByTf)) {
        const candles = candlesByTf[t];
        if (!candles || candles.length < 300) continue;
        try {
          const summary = await backtestStrategy(
            s.strategyFn as any,
            candles,
            { symbol: inst.symbol, display: inst.display, assetClass: inst.assetClass, timeframe: t as Timeframe },
            { startOffset, maxBars }
          );
          results.push({ strategyKey: s.key, timeframe: t, summary });
        } catch { /* skip */ }
      }
    }
    return NextResponse.json({ results });
  }

  if (!strategyKey) {
    return NextResponse.json({ error: "strategyKey required" }, { status: 400 });
  }
  const candles = await getCandles(symbol, tf);
  if (candles.length < 300) {
    return NextResponse.json({ error: `Insufficient data: ${candles.length} bars` }, { status: 400 });
  }

  const strategies = await listAllStrategies();
  const strategy = strategies.find((s) => s.key === strategyKey);
  if (!strategy || !strategy.strategyFn) {
    return NextResponse.json({ error: `Strategy ${strategyKey} not found` }, { status: 404 });
  }

  const summary = await backtestStrategy(
    strategy.strategyFn as any,
    candles,
    { symbol: inst.symbol, display: inst.display, assetClass: inst.assetClass, timeframe: tf },
    { startOffset, maxBars }
  );

  // Apply grading to the summary trades
  if (summary.trades) {
    for (const t of summary.trades) {
      applyGrade(t as any);
    }
  }

  // Persist to DB (best-effort) — uses BacktestByGrade model (NOT backtestResult)
  if (persist) {
    try {
      await db.backtestByGrade.create({
        data: {
          strategyKey: summary.strategyKey,
          family: (strategy as any).family ?? "unknown",
          label: strategy.label ?? strategyKey,
          symbol: summary.symbol,
          timeframe: summary.timeframe,
          winRate: summary.winRate,
          profitFactor: summary.profitFactor,
          maxDrawdown: summary.maxDrawdown,
          totalTrades: summary.totalTrades,
          avgRR: summary.avgRR,
          gradeAPlus: 0, gradeA: 0, gradeBPlus: 0, gradeBMinus: 0, gradeC: 0,
          avgScore: 0,
        } as any,
      });
    } catch (err) {
      console.error("[backtest] persist error:", err);
    }
  }

  return NextResponse.json({ summary });
}
