// architecture.ts — 4-layer scanner architecture types
import type { Candle } from "./data";
import type { Timeframe } from "./instruments";
import type { ScanSignal, Direction } from "./types";

export type DetectorFn<T = any> = (candles: Candle[]) => T;
export interface DetectorInfo { key: string; label: string; description: string; outputType: string; category: "structure" | "ict" | "indicator" | "horc" | "session"; }

export interface ScanCandidate { symbol: string; display: string; assetClass: string; timeframe: Timeframe; direction: Direction; reasons: string[]; matchedFilters: string[]; detectorData?: Record<string, any>; }
export type FilterFn = (candles: Candle[], ctx: FilterContext) => ScanCandidate | null;
export interface FilterContext { symbol: string; display: string; assetClass: string; timeframe: Timeframe; }
export interface FilterInfo { key: string; label: string; description: string; detectorKey?: string; category: "ict" | "structure" | "session" | "trend" | "horc" | "gms"; }

export type StrategyFn = (ctx: StrategyContext) => ScanSignal | null | Promise<ScanSignal | null>;
export interface StrategyContext { symbol: string; display: string; assetClass: string; timeframe: Timeframe; candles: Candle[]; detectorData?: Record<string, any>; candidate?: ScanCandidate; }
export interface StrategyInfo {
  key: string;
  family: "trend" | "ict" | "trader" | "ea" | "horc" | "community";
  label: string; description: string; timeframes: Timeframe[];
  usesDetectors?: string[]; requiresFilters?: string[];
  recommendedPairs?: { symbol: string; timeframe: string; reason: string }[];
  avoidPairs?: { symbol: string; reason: string }[];
  backtestStats?: { winRate: number; profitFactor: number; maxDrawdown: number; sharpe?: number; sampleSize: number; };
}

export interface ScannerConfig {
  strategyKey?: string;
  family?: "trend" | "ict" | "trader" | "ea" | "horc" | "community" | "all";
  filterKeys?: string[];
  instruments: Array<{ symbol: string; display: string; assetClass: string }>;
  timeframes: Timeframe[];
  minScore?: number; minGrade?: "A+" | "A" | "B+" | "B-" | "C";
  persist?: boolean; dispatch?: boolean;
}
export interface ScannerResult {
  count: number; signals: ScanSignal[]; candidatesWithoutSignals: ScanCandidate[];
  meta: { instrumentsScanned: number; timeframesScanned: Timeframe[]; strategyRun: string; filtersApplied: string[]; minScore: number; duration: number; };
}

export type ScannerFn = StrategyFn;
