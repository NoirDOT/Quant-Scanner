// Yahoo Finance data fetcher with in-memory caching and 4h aggregation.
//
// DATA STRATEGY:
//   1. RAW fetch to query1.finance.yahoo.com with browser User-Agent (primary)
//   2. yahoo-finance2 library fallback (v4: must instantiate `new YahooFinance()`)
//   3. CSV data (optional, if files are present)
//
// CRITICAL: getCandlesLive returns CLOSED candles only. The last (forming)
// bar is dropped so live scans measure the same bars the backtest does.
// The current live price is returned separately for display + freshness.
//
// 4h bars are aligned to 21:00 UTC (NY 17:00 EST — the FX day rollover),
// not 00:00 UTC. This matches how most retail brokers bucket FX 4h candles
// and is what ICT/SMC killzone mapping assumes.

import YahooFinanceLib from "yahoo-finance2";
import type { Timeframe } from "./instruments";
import { YF_INTERVAL, LOOKBACK_BARS } from "./instruments";
import { readCsvCandles, csvSymbolFor } from "./data-csv";

// yahoo-finance2 v4: the default export is a CLASS — instantiate once.
// (v2-style singleton calls throw "Call new YahooFinance() first")
const yahooFinance = new YahooFinanceLib();

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── RAW Yahoo fetch (primary — bypasses library cookie/crumb issues) ───────

interface RawChartResponse {
  chart: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

async function fetchWithBackoff(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      // Yahoo sometimes returns 429 — back off and retry
      if (res.status === 429 && i < attempts - 1) {
        const delay = 800 * Math.pow(2, i) + Math.random() * 400;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = 600 * Math.pow(2, i) + Math.random() * 300;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr ?? new Error("fetch failed after retries");
}

async function rawYahooChart(
  symbol: string,
  interval: string,
  range: string
): Promise<{ candles: Candle[]; livePrice: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetchWithBackoff(url);
  if (!res.ok) throw new Error(`Yahoo raw HTTP ${res.status}`);
  const json = (await res.json()) as RawChartResponse;
  const r = json.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(json.chart?.error?.description ?? "Yahoo raw: empty result");

  const q = r.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || c == null) continue;
    const date = new Date(r.timestamp[i] * 1000);
    out.push({
      time: r.timestamp[i],
      date,
      open: Number(o),
      high: Number(h ?? Math.max(o, c)),
      low: Number(l ?? Math.min(o, c)),
      close: Number(c),
      volume: Number(q.volume?.[i] ?? 0) || 0,
    });
  }
  return { candles: out, livePrice: r.meta?.regularMarketPrice ?? null };
}

// Map our timeframe + lookback to Yahoo raw interval/range params
function rawParamsFor(tf: Timeframe): { interval: string; range: string } {
  switch (tf) {
    case "1h": return { interval: "1h", range: "60d" };
    case "2h": return { interval: "1h", range: "90d" };
    case "4h": return { interval: "1h", range: "90d" };
    case "1d": return { interval: "1d", range: "5y" };
    default:  return { interval: "1wk", range: "10y" };
  }
}

export interface Candle {
  time: number;     // unix seconds (bar OPEN time)
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
  return {
    open: quote.open ?? null,
    high: quote.high ?? null,
    low: quote.low ?? null,
    close: quote.close ?? null,
    volume: quote.volume ?? 0,
    date: quote.date ?? quote.timestamp ?? null,
  };
}

// FX 4h candles conventionally align to the NY 17:00 EST rollover, which is
// 21:00 UTC in winter (EST) and 20:00 UTC in summer (EDT). For simplicity
// and to avoid DST drift we align to 21:00 UTC year-round; the small misalign
// during EDT (~5 months/yr, 1h off) is acceptable for scanner purposes and is
// what most charting platforms default to.
const FX_4H_OFFSET_HOURS = 21; // 21:00 UTC

function aggregateTo4h(oneday: Candle[], offsetHours = FX_4H_OFFSET_HOURS): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of oneday) {
    // Shift the candle's UTC hour by -offset so the standard Math.floor(/4)*4
    // bucketing picks the right 4h window, then shift back.
    const shiftedHour = (c.date.getUTCHours() - offsetHours + 24) % 24;
    const bucketShifted = Math.floor(shiftedHour / 4) * 4;
    const bucketHourUTC = (bucketShifted + offsetHours) % 24;
    const d = new Date(c.date);
    d.setUTCHours(bucketHourUTC, 0, 0, 0);
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
    out.push({ time: key, date: new Date(key * 1000), open, high, low, close, volume });
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
    out.push({ time: key, date: new Date(key * 1000), open, high, low, close, volume });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ─── Drop the last (incomplete/forming) bar so strategies evaluate only ────
// CLOSED candles — matches what the backtest engine sees.
function barDurationSec(tf: Timeframe): number {
  switch (tf) {
    case "1h": return 3600;
    case "2h": return 7200;
    case "4h": return 14400;
    case "1d": return 86400;
    case "1w": return 604800;
  }
}

function dropFormingBar(candles: Candle[], tf: Timeframe): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const now = Math.floor(Date.now() / 1000);
  // If the last bar's open time + duration is in the future, it's still forming.
  const barEnd = last.time + barDurationSec(tf);
  if (barEnd > now) {
    return candles.slice(0, -1);
  }
  return candles;
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

  // === PRIORITY 2: RAW Yahoo fetch (primary on Vercel) ===
  const { interval: rawInterval, range: rawRange } = rawParamsFor(tf);
  try {
    const { candles: rawCandles } = await rawYahooChart(symbol, rawInterval, rawRange);
    let candles = rawCandles;
    if (tf === "2h") candles = aggregateTo2h(candles);
    else if (tf === "4h") candles = aggregateTo4h(candles);
    if (candles.length >= 30) {
      const sliced = candles.slice(-lookback);
      cache.set(cacheKey, { ts: Date.now(), data: sliced });
      return sliced;
    }
  } catch (err) {
    console.error(`[data] raw fetch failed for ${symbol} ${tf}:`, err instanceof Error ? err.message : err);
  }

  // === PRIORITY 3: yahoo-finance2 library fallback (v4 API) ===
  const yfInterval = YF_INTERVAL[tf];
  const period =
    tf === "1h" ? "60d"
    : tf === "2h" || tf === "4h" ? "90d"
    : tf === "1d" ? "5y"
    : "10y";

  try {
    const result = await yahooFinance.chart(symbol, {
      period1: new Date(Date.now() - parsePeriodToMs(period)),
      interval: yfInterval as any,
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
    if (tf === "2h") candles = aggregateTo2h(candles);
    else if (tf === "4h") candles = aggregateTo4h(candles);
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
    const { livePrice } = await rawYahooChart(symbol, "5m", "1d");
    if (livePrice != null && Number.isFinite(livePrice) && livePrice > 0) return livePrice;
  } catch {
    /* fall through to library */
  }
  try {
    const q = await yahooFinance.quote(symbol);
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
// Returns CLOSED candles (forming bar dropped) + the current live price
// separately. Strategies evaluate the closed bar; livePrice is for display
// and freshness scoring only. This is the same data the backtest sees.

const liveCache = new Map<string, { ts: number; candles: Candle[]; livePrice: number | null }>();

function liveTtlFor(tf: Timeframe): number {
  if (tf === "1h" || tf === "2h" || tf === "4h") return 15 * 1000;  // 15s
  if (tf === "1d") return 30 * 1000;                                 // 30s
  return 60 * 1000;                                                  // 60s
}

export interface CandleDataResult {
  candles: Candle[];            // CLOSED candles only (forming bar dropped)
  livePrice: number | null;      // current Yahoo quote (display only)
  source: "live" | "stale";      // "live" if we got a fresh quote this call
  formingCandle?: Candle;        // the in-progress bar (if any) — display only
}

export async function getCandlesLive(
  symbol: string,
  tf: Timeframe,
  lookback: number = LOOKBACK_BARS[tf]
): Promise<CandleDataResult> {
  const cacheKey = `${symbol}:${tf}:live`;
  const cached = liveCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < liveTtlFor(tf)) {
    return {
      candles: cached.candles,
      livePrice: cached.livePrice,
      source: cached.livePrice != null ? "live" : "stale",
      formingCandle: undefined,
    };
  }

  const [candles, livePrice] = await Promise.all([
    getCandles(symbol, tf, lookback),
    getCurrentPrice(symbol),
  ]);
  if (candles.length === 0) return { candles: [], livePrice: null, source: "stale" };

  // Drop the forming bar so strategies evaluate only closed candles.
  const closedCandles = dropFormingBar(candles, tf);
  const formingRaw = closedCandles.length < candles.length ? candles[candles.length - 1] : undefined;

  let formingCandle: Candle | undefined = formingRaw;
  if (formingCandle && livePrice != null && Number.isFinite(livePrice) && livePrice > 0) {
    // Overlay the live price onto the forming bar for display purposes only.
    formingCandle = {
      ...formingCandle,
      close: livePrice,
      high: Math.max(formingCandle.high, livePrice),
      low: Math.min(formingCandle.low, livePrice),
    };
  }

  liveCache.set(cacheKey, {
    ts: Date.now(),
    candles: closedCandles,
    livePrice,
  });

  return {
    candles: closedCandles,
    livePrice,
    source: livePrice != null ? "live" : "stale",
    formingCandle,
  };
}

export function clearLiveCache(symbol?: string, tf?: Timeframe) {
  if (!symbol) { liveCache.clear(); return; }
  if (tf) { liveCache.delete(`${symbol}:${tf}:live`); }
  else { for (const key of Array.from(liveCache.keys())) { if (key.startsWith(`${symbol}:`)) liveCache.delete(key); } }
}

// ─── Concurrency limiter (avoids hammering Yahoo with 24+ parallel reqs) ────
// Simple promise-pool. No external deps.
export async function pLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onError?: (item: T, err: unknown) => void,
): Promise<Array<R | undefined>> {
  const queue = [...items];
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      const idx = nextIdx++;
      try {
        results[idx] = await fn(item);
      } catch (err) {
        if (onError) onError(item, err);
        else console.error("[pLimit] worker error:", err);
        results[idx] = undefined;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
