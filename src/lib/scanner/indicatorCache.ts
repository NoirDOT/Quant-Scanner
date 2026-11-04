// src/lib/scanner/indicatorCache.ts
// Per-scan indicator cache — compute each indicator once per symbol+TF and
// share across all strategies that need it. Eliminates the O(n²) cost where
// every strategy recomputes EMA, ATR, structure, etc. on the same candles.
//
// Usage (inside a strategy):
//   const cache = getIndicatorCache();  // reads from global, set by runScan
//   const ema50 = cache.getEma(symbol, tf, candles, 50);
//   // Second call with the same symbol+tf+period returns the cached value
//   // without recomputing.

import type { Candle } from "./data";
import { ema, stackedEma } from "./indicators/moving-averages";
import { atr } from "./indicators/atr";
import { rsi } from "./indicators/rsi";
import { adx } from "./indicators/adx";
import { supertrend } from "./indicators/supertrend";
import { macd } from "./indicators/macd";
import { donchianFromCloses } from "./indicators/donchian";
import { heikinAshi } from "./indicators/heikin-ashi";
import { ichimoku } from "./indicators/ichimoku";
import { psar } from "./indicators/psar";

export interface IndicatorCache {
  getEma(symbol: string, tf: string, candles: Candle[], period: number): (number | null)[];
  getStackedEma(symbol: string, tf: string, candles: Candle[]): ReturnType<typeof stackedEma>;
  getAtr(symbol: string, tf: string, candles: Candle[], period?: number): ReturnType<typeof atr>;
  getRsi(symbol: string, tf: string, candles: Candle[], period?: number): (number | null)[];
  getAdx(symbol: string, tf: string, candles: Candle[], period?: number): ReturnType<typeof adx>;
  getSupertrend(symbol: string, tf: string, candles: Candle[], period?: number, multiplier?: number): ReturnType<typeof supertrend>;
  getMacd(symbol: string, tf: string, candles: Candle[]): ReturnType<typeof macd>;
  getDonchian(symbol: string, tf: string, candles: Candle[], period?: number): ReturnType<typeof donchianFromCloses>;
  getHeikinAshi(symbol: string, tf: string, candles: Candle[]): ReturnType<typeof heikinAshi>;
  getIchimoku(symbol: string, tf: string, candles: Candle[]): ReturnType<typeof ichimoku>;
  getPsar(symbol: string, tf: string, candles: Candle[]): ReturnType<typeof psar>;
  clear(): void;
  size(): number;
}

export function createIndicatorCache(): IndicatorCache {
  const cache = new Map<string, unknown>();

  function key(symbol: string, tf: string, name: string, ...params: number[]): string {
    return `${symbol}:${tf}:${name}:${params.join(",")}`;
  }

  return {
    getEma(symbol, tf, candles, period) {
      const k = key(symbol, tf, "ema", period);
      if (cache.has(k)) return cache.get(k) as (number | null)[];
      const closes = candles.map((c) => c.close);
      const result = ema(closes, period);
      cache.set(k, result);
      return result;
    },

    getStackedEma(symbol, tf, candles) {
      const k = key(symbol, tf, "stackedEma");
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof stackedEma>;
      const closes = candles.map((c) => c.close);
      const result = stackedEma(closes);
      cache.set(k, result);
      return result;
    },

    getAtr(symbol, tf, candles, period = 14) {
      const k = key(symbol, tf, "atr", period);
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof atr>;
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = atr(highs, lows, closes, period);
      cache.set(k, result);
      return result;
    },

    getRsi(symbol, tf, candles, period = 14) {
      const k = key(symbol, tf, "rsi", period);
      if (cache.has(k)) return cache.get(k) as (number | null)[];
      const closes = candles.map((c) => c.close);
      const result = rsi(closes, period);
      cache.set(k, result);
      return result;
    },

    getAdx(symbol, tf, candles, period = 14) {
      const k = key(symbol, tf, "adx", period);
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof adx>;
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = adx(highs, lows, closes, period);
      cache.set(k, result);
      return result;
    },

    getSupertrend(symbol, tf, candles, period = 10, multiplier = 3) {
      const k = key(symbol, tf, "supertrend", period, multiplier);
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof supertrend>;
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = supertrend(highs, lows, closes, period, multiplier);
      cache.set(k, result);
      return result;
    },

    getMacd(symbol, tf, candles) {
      const k = key(symbol, tf, "macd");
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof macd>;
      const closes = candles.map((c) => c.close);
      const result = macd(closes);
      cache.set(k, result);
      return result;
    },

    getDonchian(symbol, tf, candles, period = 20) {
      const k = key(symbol, tf, "donchian", period);
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof donchianFromCloses>;
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = donchianFromCloses(highs, lows, closes, period);
      cache.set(k, result);
      return result;
    },

    getHeikinAshi(symbol, tf, candles) {
      const k = key(symbol, tf, "heikinAshi");
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof heikinAshi>;
      const opens = candles.map((c) => c.open);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = heikinAshi(opens, highs, lows, closes);
      cache.set(k, result);
      return result;
    },

    getIchimoku(symbol, tf, candles) {
      const k = key(symbol, tf, "ichimoku");
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof ichimoku>;
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = ichimoku(highs, lows, closes);
      cache.set(k, result);
      return result;
    },

    getPsar(symbol, tf, candles) {
      const k = key(symbol, tf, "psar");
      if (cache.has(k)) return cache.get(k) as ReturnType<typeof psar>;
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const result = psar(highs, lows, closes);
      cache.set(k, result);
      return result;
    },

    clear() {
      cache.clear();
    },

    size() {
      return cache.size;
    },
  };
}

// ─── Global per-scan cache ─────────────────────────────────────────────────
// Set by runScan at the start of a sweep, cleared at the end.
// Strategies can read it via getIndicatorCache() without changing their
// function signatures.

const GLOBAL_CACHE_KEY = "__scannerIndicatorCache";

export function setIndicatorCache(cache: IndicatorCache): void {
  (globalThis as any)[GLOBAL_CACHE_KEY] = cache;
}

export function getIndicatorCache(): IndicatorCache | null {
  return (globalThis as any)[GLOBAL_CACHE_KEY] ?? null;
}

export function clearIndicatorCache(): void {
  delete (globalThis as any)[GLOBAL_CACHE_KEY];
}
