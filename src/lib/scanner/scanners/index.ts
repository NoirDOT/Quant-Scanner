// scanners/index.ts — Layer 4 batch runner
import type { Candle } from "../data";
import type { Timeframe } from "../instruments";
import type { ScanSignal } from "../types";
import { applyGrade } from "../grading";
import type { ScannerConfig, ScannerResult, StrategyContext, ScanCandidate } from "../architecture";
import { runFilters } from "../filters";
import { listAllStrategies } from "../strategies/all";
import { getCandles } from "../data";

export async function runScanner(config: ScannerConfig): Promise<ScannerResult> {
  const start = Date.now();
  const minScore = config.minScore ?? 50;
  const gradeRank: Record<string, number> = { "A+": 5, "A": 4, "B+": 3, "B-": 2, "C": 1 };
  const minGradeRank = config.minGrade ? gradeRank[config.minGrade] : 0;

  const allStrategies = await listAllStrategies();
  const strategiesToRun = allStrategies.filter((s) => {
    if (config.strategyKey && config.strategyKey !== "all") {
      return s.key === config.strategyKey || s.key.startsWith(config.strategyKey.replace(/-(1h|2h|4h|1d|1w)$/, ""));
    }
    if (config.family && config.family !== "all") return s.family === config.family;
    return true;
  });

  const signals: ScanSignal[] = [];
  const candidatesWithoutSignals: ScanCandidate[] = [];

  for (const inst of config.instruments) {
    for (const tf of config.timeframes) {
      let candles: Candle[] = [];
      try { candles = await getCandles(inst.symbol, tf as Timeframe); }
      catch (err) { console.error(`[scanner] getCandles(${inst.symbol}, ${tf}) failed:`, err); continue; }
      if (candles.length < 30) continue;

      const ctxBase = { symbol: inst.symbol, display: inst.display, assetClass: inst.assetClass, timeframe: tf as Timeframe };
      let passedFilter = true;
      let filterCandidates: ScanCandidate[] = [];
      if (config.filterKeys && config.filterKeys.length > 0) {
        filterCandidates = runFilters(candles, ctxBase, config.filterKeys);
        passedFilter = filterCandidates.length > 0;
      }
      if (!passedFilter) continue;

      for (const strategy of strategiesToRun) {
        if (!strategy.strategyFn) continue;
        const ctx: StrategyContext = { ...ctxBase, candles,
          detectorData: filterCandidates[0]?.detectorData, candidate: filterCandidates[0] };
        try {
          const signal = await strategy.strategyFn(ctx);
          if (!signal) continue;
          if (strategy.backtestStats) signal.metadata = { ...signal.metadata, catalogStats: strategy.backtestStats };
          applyGrade(signal);
          signals.push(signal);
        } catch (err) {
          console.error(`[scanner] strategy ${strategy.key} on ${inst.symbol}:${tf} failed:`, err);
        }
      }
      if (filterCandidates.length > 0) candidatesWithoutSignals.push(...filterCandidates);
    }
  }

  const filtered = signals.filter((s) => {
    if (s.score < minScore) return false;
    if (s.grade && gradeRank[s.grade] < minGradeRank) return false;
    return true;
  });
  filtered.sort((a, b) => b.score - a.score);

  return { count: filtered.length, signals: filtered, candidatesWithoutSignals,
    meta: { instrumentsScanned: config.instruments.length, timeframesScanned: config.timeframes as Timeframe[],
      strategyRun: config.strategyKey ?? `family:${config.family ?? "all"}`,
      filtersApplied: config.filterKeys ?? [], minScore, duration: Date.now() - start } };
}
