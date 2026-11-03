// src/lib/scanner/catalogStats.ts
// Loads BacktestByGrade rows from the DB and attaches them to signals as
// metadata.catalogStats so the grading layer (catalogScore) reads REAL
// backtested win-rate / profit-factor per strategy, not family defaults.
//
// Also persists per-symbol data freshness to SymbolDataStatus.

import type { ScanSignal } from "./types";
import { db } from "@/lib/db";

export interface CatalogStatsEntry {
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgRR: number;
}

type StatsMap = Map<string, CatalogStatsEntry>;

let cachedStats: StatsMap | null = null;
let cachedStatsAt = 0;
const STATS_TTL_MS = 5 * 60 * 1000; // 5 min — backtests don't change often

/**
 * Load BacktestByGrade rows, indexed by strategyKey. Cached for 5 min so the
 * whole sweep only incurs one DB round-trip. Returns an empty map if the DB
 * is unavailable (grading falls back to family defaults).
 */
export async function loadCatalogStatsMap(): Promise<StatsMap> {
  if (cachedStats && Date.now() - cachedStatsAt < STATS_TTL_MS) {
    return cachedStats;
  }
  const map: StatsMap = new Map();
  try {
    // Average across symbols/timeframes for the same strategyKey, weighted by trades
    const rows = await db.backtestByGrade.findMany({
      select: {
        strategyKey: true,
        winRate: true,
        profitFactor: true,
        totalTrades: true,
        avgRR: true,
      },
    });
    const byKey = new Map<string, { wrSum: number; pfSum: number; tradeSum: number; rrSum: number; n: number }>();
    for (const r of rows) {
      const agg = byKey.get(r.strategyKey) ?? { wrSum: 0, pfSum: 0, tradeSum: 0, rrSum: 0, n: 0 };
      const w = Math.max(1, r.totalTrades);
      agg.wrSum += r.winRate * w;
      agg.pfSum += r.profitFactor * w;
      agg.rrSum += r.avgRR * w;
      agg.tradeSum += r.totalTrades;
      agg.n += 1;
      byKey.set(r.strategyKey, agg);
    }
    for (const [key, agg] of byKey) {
      const totalW = Math.max(1, agg.tradeSum);
      map.set(key, {
        winRate: agg.wrSum / totalW,
        profitFactor: agg.pfSum / totalW,
        totalTrades: agg.tradeSum,
        avgRR: agg.rrSum / totalW,
      });
    }
  } catch (err) {
    console.error("[catalogStats] load failed:", err);
  }
  cachedStats = map;
  cachedStatsAt = Date.now();
  return map;
}

/**
 * Attach metadata.catalogStats to each signal from the cached stats map.
 *
 * Live signals carry keys like `trend-ema-4h`, `ict-fvg-1d`, `ea-…-4h`, but
 * BacktestByGrade rows are keyed by the BASE strategy key (`trend-ema`,
 * `ict-fvg`, `ea-…`). So we strip the trailing timeframe suffix before lookup.
 *
 * Signals whose base key has no backtest data are left untouched (so
 * catalogScore falls back to family defaults).
 */
function baseStrategyKey(strategyKey: string): string {
  return strategyKey.replace(/-(1h|2h|4h|1d|1w)$/, "");
}

export function attachCatalogStats(signals: ScanSignal[], statsMap?: StatsMap): void {
  const map = statsMap ?? (globalThis as any).__scannerCatalogStats as StatsMap | undefined;
  if (!map) return;
  for (const s of signals) {
    // Try the full key first (trader keys like `trader-jadecapfx` have no TF suffix),
    // then fall back to the base key (strips `-4h`, `-1d` etc.)
    const stats = map.get(s.strategyKey) ?? map.get(baseStrategyKey(s.strategyKey));
    if (stats) {
      s.metadata = {
        ...(s.metadata ?? {}),
        catalogStats: { winRate: stats.winRate, profitFactor: stats.profitFactor },
      };
    }
  }
}

export interface SymbolStatusRow {
  symbol: string;
  timeframe: string;
  candles: number;
  source: string;
  livePrice: number | null;
  lastBarTime: number | null;
  error?: string;
}

/**
 * Persist per-symbol data freshness so the UI/summary can surface silent
 * Yahoo failures. Uses upsert on the (symbol, timeframe) unique key.
 */
export async function recordSymbolDataStatus(rows: SymbolStatusRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    // Batch via Promise.all — small N (typically <100 rows)
    await Promise.all(rows.map((r) =>
      db.symbolDataStatus.upsert({
        where: { symbol_timeframe: { symbol: r.symbol, timeframe: r.timeframe } },
        create: {
          symbol: r.symbol,
          timeframe: r.timeframe,
          candles: r.candles,
          lastBarTime: r.lastBarTime,
          lastLivePrice: r.livePrice,
          source: r.source,
          error: r.error,
        },
        update: {
          candles: r.candles,
          lastBarTime: r.lastBarTime,
          lastLivePrice: r.livePrice,
          source: r.source,
          error: r.error,
          checkedAt: new Date(),
        },
      }).catch(() => null)
    ));
  } catch (err) {
    console.error("[catalogStats] recordSymbolDataStatus error:", err);
  }
}

// Test hook — reset cache between runs in unit tests
export function _resetCatalogStatsCache(): void {
  cachedStats = null;
  cachedStatsAt = 0;
}
