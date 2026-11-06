// src/lib/scanner/forge/types.ts
// Strategy builder types — adapted from the Grok Workspace reference.

export type IndicatorId =
  | "rsi"
  | "stoch"
  | "zscore"
  | "bb"
  | "donchian"
  | "sma_dist"
  | "ema_dist"
  | "ret"
  | "atr_pct"
  | "close_loc";

export type Comparator = "lt" | "gt" | "cross_below" | "cross_above";

export type Side = "long" | "short" | "both";

export type ScalerMode = "off" | "trend" | "fade";

export interface Rule {
  indicator: IndicatorId;
  period: number;
  op: Comparator;
  threshold: number;
}

export interface MemoryRule {
  enabled: boolean;
  lookback: number;
  op: "lt" | "gt";
  threshold: number;
}

export interface Strategy {
  id: string;
  name: string;
  side: Side;
  entry: Rule[];
  stopAtr: number;
  targetR: number;
  maxBars: number;
  scaler: ScalerMode;
  memory: MemoryRule;
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Costs {
  spread: number;
  slippage: number;
  commission: number;
}

export interface Trade {
  side: "long" | "short";
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  net: number;
  reason: string;
}

export interface EquityPoint {
  index: number;
  t: number;
  equity: number;
}

export interface Metrics {
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  sharpe: number;
  maxDrawdown: number;
  totalReturn: number;
  avgBars: number;
  net: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: EquityPoint[];
  metrics: Metrics;
  dailyPnl: number[];
}

export interface MonteCarloSummary {
  paths: number;
  p5: number;
  p50: number;
  p95: number;
  p5Return: number;
  worstDecileDrawdown: number;
  percentProfitable: number;
}

export interface PropRules {
  target: number;
  trailing: number;
  consistency: number;
  fee: number;
  maxDays: number;
}

export interface PropSummary {
  passes: number;
  paths: number;
  passRate: number;
  medianDays: number;
  expectedNet: number;
  target: number;
  trailing: number;
  fee: number;
}

export interface Candidate {
  strategy: Strategy;
  isMetrics: Metrics;
  valMetrics: Metrics;
  score: number;
}

export interface WalkWindow {
  index: number;
  isSharpe: number;
  oosSharpe: number;
  isReturn: number;
  oosReturn: number;
  oosTrades: number;
  decay: number;
}

export interface DataSplits {
  is: { from: number; to: number };
  val: { from: number; to: number };
  holdout: { from: number; to: number };
  research: { from: number; to: number };
}

export const CAPITAL = 100_000;

export const SPLITS = {
  warmup: 80,
  isEnd: 0.62,
  valEnd: 0.85,
} as const;

export function splitIndexes(n: number): DataSplits {
  const isEnd = Math.floor(n * SPLITS.isEnd);
  const valEnd = Math.floor(n * SPLITS.valEnd);
  return {
    is: { from: SPLITS.warmup, to: isEnd },
    val: { from: isEnd, to: valEnd },
    holdout: { from: valEnd, to: n - 1 },
    research: { from: SPLITS.warmup, to: valEnd },
  };
}
