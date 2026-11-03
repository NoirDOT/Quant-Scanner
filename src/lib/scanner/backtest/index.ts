// src/lib/scanner/backtest/index.ts
export * from "./engine";

// Indicator-sweep backtest — runs all trend indicator strategies × timeframes
// for a given symbol and returns ranked results.
import type { Candle } from "../data";
import type { Timeframe } from "../instruments";
import { TREND_SCANNERS } from "../strategies/trend";
import { backtestStrategy, type BacktestSummary } from "./engine";

export interface SweepResult {
  strategyKey: string;
  timeframe: Timeframe;
  summary: BacktestSummary;
}

export async function sweepTrendStrategies(
  symbol: string,
  display: string,
  assetClass: string,
  candlesByTf: Record<Timeframe, Candle[]>,
  timeframes: Timeframe[] = ["1h", "2h", "4h", "1d", "1w"]
): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  for (const tf of timeframes) {
    const candles = candlesByTf[tf];
    if (!candles || candles.length < 200) continue;
    for (const [key, scannerFn] of Object.entries(TREND_SCANNERS)) {
      const summary = await backtestStrategy(
        scannerFn,
        candles,
        { symbol, display, assetClass, timeframe: tf },
        { startOffset: 250, maxBars: 100 }
      );
      results.push({ strategyKey: key, timeframe: tf, summary });
    }
  }
  // Sort by netReturn desc
  results.sort((a, b) => b.summary.netReturn - a.summary.netReturn);
  return results;
}
