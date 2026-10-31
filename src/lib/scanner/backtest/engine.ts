// /home/z/my-project/src/lib/scanner/backtest/engine.ts
// Walk-forward backtester with win-rate, R:R, max DD, profit factor, equity curve

import type { Candle } from "../data";
import type { ScanSignal } from "../types";
import type { Timeframe } from "../instruments";

export interface Trade {
  entryIndex: number;
  entryTime: number;
  exitIndex: number;
  exitTime: number;
  direction: "long" | "short";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitPrice: number;
  outcome: "win" | "loss" | "timeout";
  barsHeld: number;
  pnlPct: number;
  rMultiple: number;
}

export interface BacktestSummary {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  profitFactor: number;     // gross profit / gross loss
  maxDrawdown: number;      // percentage
  avgRR: number;
  netReturn: number;        // percentage
  avgBarsHeld: number;
  equityCurve: { time: number; equity: number }[];
  trades: Trade[];
  strategyKey: string;
  symbol: string;
  timeframe: Timeframe;
  start: string;
  end: string;
}

// Backtest a strategy by walking through history and re-running the scanner
// at each historical bar.
export async function backtestStrategy(
  strategyFn: (ctx: { candles: Candle[]; symbol: string; display: string; assetClass: string; timeframe: Timeframe }) => ScanSignal | null | Promise<ScanSignal | null>,
  fullCandles: Candle[],
  ctx: { symbol: string; display: string; assetClass: string; timeframe: Timeframe },
  options: {
    minBarsPerTrade?: number;    // bars to wait after exit before next entry
    startOffset?: number;         // skip the first N bars (warm-up)
    maxBars?: number;             // limit trade duration
    riskPerTrade?: number;        // 0-1, fractional equity risked per trade
    initialEquity?: number;
  } = {}
): Promise<BacktestSummary> {
  const minBars = options.minBarsPerTrade ?? 5;
  const startOffset = options.startOffset ?? 200;
  const maxBars = options.maxBars ?? 100;
  const risk = options.riskPerTrade ?? 0.01;
  let equity = options.initialEquity ?? 10000;
  const initialEquity = equity;
  const trades: Trade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  let lastExitBar = -Infinity;
  let peak = equity;
  let maxDD = 0;

  // Walk forward
  for (let i = startOffset; i < fullCandles.length - 1; i++) {
    // Update equity curve at each bar
    if (i % 5 === 0 || i === fullCandles.length - 2) {
      equityCurve.push({ time: fullCandles[i].time, equity });
    }
    if (i < lastExitBar + minBars) continue;
    // Slice historical window
    const window = fullCandles.slice(0, i + 1);
    const signal = await strategyFn({ ...ctx, candles: window });
    if (!signal) continue;
    if (signal.direction === "neutral") continue;
    if (!signal.entryPrice || !signal.stopPrice || !signal.targetPrice) continue;
    // Simulate trade: walk forward to find SL or TP
    const entry = signal.entryPrice;
    const stop = signal.stopPrice;
    const target = signal.targetPrice;
    const direction = signal.direction;
    const entryIndex = i;
    const entryTime = fullCandles[i].time;
    let exitPrice = entry;
    let exitIndex = i;
    let outcome: "win" | "loss" | "timeout" = "timeout";
    for (let j = i + 1; j < Math.min(fullCandles.length, i + maxBars + 1); j++) {
      const c = fullCandles[j];
      if (direction === "long") {
        if (c.low <= stop) {
          exitPrice = stop;
          exitIndex = j;
          outcome = "loss";
          break;
        }
        if (c.high >= target) {
          exitPrice = target;
          exitIndex = j;
          outcome = "win";
          break;
        }
      } else {
        if (c.high >= stop) {
          exitPrice = stop;
          exitIndex = j;
          outcome = "loss";
          break;
        }
        if (c.low <= target) {
          exitPrice = target;
          exitIndex = j;
          outcome = "win";
          break;
        }
      }
    }
    if (outcome === "timeout") {
      exitPrice = fullCandles[Math.min(fullCandles.length - 1, i + maxBars)].close;
      exitIndex = Math.min(fullCandles.length - 1, i + maxBars);
    }
    const pnlPct =
      direction === "long"
        ? (exitPrice - entry) / entry
        : (entry - exitPrice) / entry;
    const risk0 = Math.abs(entry - stop) / entry;
    const rMultiple = risk0 > 0 ? pnlPct / risk0 : 0;
    // Update equity: risk% * rMultiple
    const dollarPnL = equity * risk * rMultiple;
    equity += dollarPnL;
    trades.push({
      entryIndex,
      entryTime,
      exitIndex,
      exitTime: fullCandles[exitIndex].time,
      direction,
      entryPrice: entry,
      stopPrice: stop,
      targetPrice: target,
      exitPrice,
      outcome,
      barsHeld: exitIndex - entryIndex,
      pnlPct,
      rMultiple,
    });
    lastExitBar = exitIndex;
    peak = Math.max(peak, equity);
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  equityCurve.push({ time: fullCandles[fullCandles.length - 1].time, equity });
  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const grossProfit = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const avgRR =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length
      : 0;
  return {
    totalTrades: trades.length,
    winTrades: wins.length,
    lossTrades: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor,
    maxDrawdown: maxDD * 100,
    avgRR,
    netReturn: ((equity - initialEquity) / initialEquity) * 100,
    avgBarsHeld:
      trades.length > 0
        ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length
        : 0,
    equityCurve,
    trades,
    strategyKey: signalKey(strategyFn),
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    start: fullCandles[startOffset]?.date.toISOString() || "",
    end: fullCandles[fullCandles.length - 1].date.toISOString(),
  };
}

// Helper — identify strategy by function name (best-effort)
function signalKey(fn: any): string {
  return fn?.name ?? "unknown";
}
