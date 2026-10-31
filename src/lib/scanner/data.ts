// /home/z/my-project/src/lib/scanner/data.ts
// Yahoo Finance data fetcher with in-memory caching and 4h aggregation.

// yahoo-finance2 v2 is a singleton (not a constructor).
import YahooFinance from "yahoo-finance2";
import type { Timeframe } from "./instruments";
import { YF_INTERVAL, LOOKBACK_BARS } from "./instruments";
import { readCsvCandles, csvSymbolFor } from "./data-csv";

export interface Candle {
  time: number;     // unix seconds
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// In-memory cache: key = `${symbol}:${tf}`
// TTL: 5 min for intraday (1h/2h/4h), 30 min for 1d, 60 min for 1w
const cache = new Map<string, { ts: number; data: Candle[] }>();

function ttlFor(tf: Timeframe): number {
  if (tf === "1h" || tf === "2h" || tf === "4h") return 5 * 60 * 1000;
  if (tf === "1d") return 30 * 60 * 1000;
  return 60 * 60 * 1000;
}

function stripQuoteProps(quote: any): any {
  // Yahoo returns many props; pick only what we need and clean up
  return {
    open: quote.open ?? null,
    high: quote.high ?? null,
    low: quote.low ?? null,
    close: quote.close ?? null,
    volume: quote.volume ?? 0,
    date: quote.date ?? quote.timestamp ?? null,
  };
}

function aggregateTo4h(oneday: Candle[]): Candle[] {
  // Aggregate 1h candles into 4h candles aligned to 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
  const buckets = new Map<number, Candle[]>();
  for (const c of oneday) {
    const bucketHour = Math.floor(c.date.getUTCHours() / 4) * 4;
    const d = new Date(c.date);
    d.setUTCHours(bucketHour, 0, 0, 0);
    const key = Math.floor(d.getTime() / 1000);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const out: Candle[] = [];
  for (const [key, candles] of buckets) {
    if (candles.length === 0) continue;
    const open = candles[0].open;
    const close = candles[candles.length - 1].close;
    const high = Math.max(...candles.map((c) => c.high));
    const low = Math.min(...candles.map((c) => c.low));
    const volume = candles.reduce((sum, c) => sum + c.volume, 0);
    out.push({
      time: key,
      date: new Date(key * 1000),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function aggregateTo2h(oneday: Candle[]): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of oneday) {
    const bucketHour = Math.floor(c.date.getUTCHours() / 2) * 2;
    const d = new Date(c.date);
    d.setUTCHours(bucketHour, 0, 0, 0);
    const key = Math.floor(d.getTime() / 1000);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const out: Candle[] = [];
  for (const [key, candles] of buckets) {
    if (candles.length === 0) continue;
    const open = candles[0].open;
    const close = candles[candles.length - 1].close;
    const high = Math.max(...candles.map((c) => c.high));
    const low = Math.min(...candles.map((c) => c.low));
    const volume = candles.reduce((sum, c) => sum + c.volume, 0);
    out.push({
      time: key,
      date: new Date(key * 1000),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export async function getCandles(
  symbol: string,
  tf: Timeframe,
  lookback: number = LOOKBACK_BARS[tf]
): Promise<Candle[]> {
  const cacheKey = `${symbol}:${tf}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttlFor(tf)) {
    return cached.data;
  }

  // === PRIORITY 1: User-provided CSV data (if available) ===
  // CSVs cover 2011–2026 with 15 years of history — far better than Yahoo's free tier
  const csvSymbol = csvSymbolFor(symbol);
  if (csvSymbol) {
    try {
      const csvCandles = await readCsvCandles(csvSymbol, tf);
      if (csvCandles.length >= 30) {
        const sliced = csvCandles.slice(-lookback);
        cache.set(cacheKey, { ts: Date.now(), data: sliced });
        return sliced;
      }
    } catch (err) {
      console.error(`[data] CSV read failed for ${csvSymbol} ${tf}:`, err);
    }
  }

  // === PRIORITY 2: Fall back to Yahoo Finance ===
  const yfInterval = YF_INTERVAL[tf];
  const period =
    tf === "1h"
      ? "60d"
      : tf === "2h" || tf === "4h"
      ? "90d"
      : tf === "1d"
      ? "5y"
      : "10y";

  try {
    const result = await YahooFinance.chart(symbol, {
      period1: new Date(Date.now() - parsePeriodToMs(period)),
      interval: yfInterval,
    });
    const quotes: any[] = (result as any).quotes ?? [];
    let candles: Candle[] = quotes
      .map((q) => stripQuoteProps(q))
      .filter((q) => q.open != null && q.close != null && q.date != null)
      .map((q) => {
        const date = new Date(q.date);
        return {
          time: Math.floor(date.getTime() / 1000),
          date,
          open: Number(q.open),
          high: Number(q.high),
          low: Number(q.low),
          close: Number(q.close),
          volume: Number(q.volume) || 0,
        } as Candle;
      });
    if (tf === "2h") {
      candles = aggregateTo2h(candles);
    } else if (tf === "4h") {
      candles = aggregateTo4h(candles);
    }
    candles = candles.slice(-lookback);
    cache.set(cacheKey, { ts: Date.now(), data: candles });
    return candles;
  } catch (err) {
    console.error(`[data] failed to fetch ${symbol} ${tf}:`, err);
    return [];
  }
}

function parsePeriodToMs(period: string): number {
  const map: Record<string, number> = {
    "60d": 60 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "5y": 5 * 365 * 24 * 60 * 60 * 1000,
    "10y": 10 * 365 * 24 * 60 * 60 * 1000,
  };
  return map[period] ?? 60 * 24 * 60 * 60 * 1000;
}

export async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const q = await YahooFinance.quote(symbol);
    return (q as any).regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

export function clearCache(symbol?: string, tf?: Timeframe) {
  if (!symbol) {
    cache.clear();
    return;
  }
  if (tf) {
    cache.delete(`${symbol}:${tf}`);
  } else {
    for (const key of Array.from(cache.keys())) {
      if (key.startsWith(`${symbol}:`)) cache.delete(key);
    }
  }
}

// ─── LIVE DATA LAYER ─────────────────────────────────────────────────────
// Overlays the CURRENT Yahoo Finance quote onto the last candle so every
// scan evaluates the actual live market price, not a stale bar close.

const liveCache = new Map<string, { ts: number; data: Candle[]; livePrice: number | null }>();

function liveTtlFor(tf: Timeframe): number {
  if (tf === "1h" || tf === "2h" || tf === "4h") return 15 * 1000;  // 15s
  if (tf === "1d") return 30 * 1000;                                 // 30s
  return 60 * 1000;                                                  // 60s
}

export async function getCandlesLive(
  symbol: string,
  tf: Timeframe,
  lookback: number = LOOKBACK_BARS[tf]
): Promise<{ candles: Candle[]; livePrice: number | null; source: "live" | "stale" }> {
  const cacheKey = `${symbol}:${tf}:live`;
  const cached = liveCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < liveTtlFor(tf)) {
    return { candles: cached.data, livePrice: cached.livePrice, source: "live" };
  }

  const candles = await getCandles(symbol, tf, lookback);
  if (candles.length === 0) return { candles: [], livePrice: null, source: "stale" };

  const livePrice = await getCurrentPrice(symbol);

  let finalCandles = candles;
  if (livePrice != null && Number.isFinite(livePrice) && livePrice > 0) {
    finalCandles = candles.slice();
    const last = { ...finalCandles[finalCandles.length - 1] };
    last.close = livePrice;
    last.high = Math.max(last.high, livePrice);
    last.low = Math.min(last.low, livePrice);
    finalCandles[finalCandles.length - 1] = last;
  }

  liveCache.set(cacheKey, { ts: Date.now(), data: finalCandles, livePrice });

  return { candles: finalCandles, livePrice, source: livePrice != null ? "live" : "stale" };
}

export function clearLiveCache(symbol?: string, tf?: Timeframe) {
  if (!symbol) { liveCache.clear(); return; }
  if (tf) { liveCache.delete(`${symbol}:${tf}:live`); }
  else { for (const key of Array.from(liveCache.keys())) { if (key.startsWith(`${symbol}:`)) liveCache.delete(key); } }
}
