// /home/z/my-project/build/hubb-final/HUBB/src/lib/scanner/types.ts
// Shared types for strategies & scan results.
//
// EXTENDED in this rebuild:
//   - Added "ea" and "horc" strategy types (5 families now: trend/ict/trader/ea/horc).
//   - Added `grade` field for the universal A+/A/B+/B-/C grading layer.
//   - Added `gradeFactors` for transparency into how the grade was computed.

import type { Timeframe } from "./instruments";

export type Direction = "long" | "short" | "neutral";

/** Universal grade letters from the grading layer (src/lib/scanner/grading.ts). */
export type Grade = "A+" | "A" | "B+" | "B-" | "C" | null;

export interface GradeFactors {
  /** 0-100: weighted raw score (signal.score before grading adjustments). */
  rawScore: number;
  /** 0-25: how many confluences fired (origin/liquidity/zone/AOI etc). */
  confluenceScore: number;
  /** 0-25: alignment with active ICT killzone (London/NY/Silver Bullet). */
  killzoneScore: number;
  /** 0-20: reward-to-risk ratio of the entry/stop/target. */
  rrScore: number;
  /** 0-15: catalog edge — backtested win-rate / profit-factor of the strategy. */
  catalogScore: number;
  /** 0-15: freshness — how recent the signal is (decays over 24h). */
  freshnessScore: number;
}

export interface ScanSignal {
  strategyKey: string;       // unique key, e.g. "trend-ema-stack-1h"
  strategyType: "trend" | "ict" | "trader" | "ea" | "horc";
  strategyLabel: string;     // human-readable
  symbol: string;
  display: string;
  assetClass: string;
  timeframe: Timeframe;
  direction: Direction;
  score: number;             // 0-100 (final score after grading adjustments)
  grade?: Grade;             // universal letter grade (A+/A/B+/B-/C)
  gradeFactors?: GradeFactors;
  reasons: string[];         // human-readable triggered conditions
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  /** Optional metadata (e.g. HORC move structure, EA backtest stats). */
  metadata?: Record<string, any>;
  /** ISO timestamp when the signal was generated. */
  generatedAt?: string;
}

export interface StrategyInfo {
  key: string;
  type: "trend" | "ict" | "trader" | "ea" | "horc";
  label: string;
  description: string;
  timeframes: Timeframe[];
  /** Best pairs for this strategy (Ch "recommendedPairs" gap from prior session). */
  recommendedPairs?: { symbol: string; timeframe: string; reason: string }[];
  /** Pairs to avoid for this strategy. */
  avoidPairs?: { symbol: string; reason: string }[];
}

export interface StrategyContext {
  symbol: string;
  display: string;
  assetClass: string;
  timeframe: Timeframe;
  candles: import("./data").Candle[];
}

export type ScannerFn = (ctx: StrategyContext) => Promise<ScanSignal | null> | ScanSignal | null;
