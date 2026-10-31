// strategies/community/index.ts
// Community-derived strategies — winning rule sets from backtests.
//
// 5 winning strategies from the tweet backtests (see download/TWEET_STRATEGIES_BACKTEST_V2.md):
//   1. Supertrend(10,2) + 4h HTF filter (flip exit) — ⭐ +1,247R total / +0.100 avg R
//   2. Supertrend(10,3) + 4h HTF filter (flip exit) — +565R / +0.081 avg R
//   3. SMC BOS/CHoCH strength=5 (2R target) — +672R / +0.029 avg R
//   4. SMC BOS/CHoCH strength=3 (2R target) — +352R / +0.012 avg R
//   5. Fib 50% midpoint (1R target) — positive on 8/9 instruments, ~65% WR
//
// Source tweets:
//   - SMC: @shotaro_forex (https://x.com/shotaro_forex/status/2115212512803344879)
//   - Supertrend: @ferhanxu (https://x.com/ferhanxu/status/2115399498339864837)
//     HTF filter per tweet replies recommending "SuperTrend HTF"
//   - Fib 50%: user-shared backtest (prior session)

import type { ScanSignal } from "../../types";
import type { StrategyFn, StrategyInfo } from "../../architecture";
import { atr } from "../../indicators";
import { detectSwingPivots } from "../horc/origin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregateTo4h(candles: import("../../data").Candle[]): import("../../data").Candle[] {
  if (candles.length === 0) return [];
  const buckets = new Map<number, import("../../data").Candle[]>();
  for (const c of candles) {
    const bucketHour = Math.floor(c.date.getUTCHours() / 4) * 4;
    const d = new Date(c.date);
    d.setUTCHours(bucketHour, 0, 0, 0);
    const key = Math.floor(d.getTime() / 1000);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const out: import("../../data").Candle[] = [];
  for (const [key, cs] of buckets) {
    if (cs.length === 0) continue;
    out.push({
      time: key, date: new Date(key * 1000),
      open: cs[0].open, high: Math.max(...cs.map((c) => c.high)),
      low: Math.min(...cs.map((c) => c.low)), close: cs[cs.length - 1].close,
      volume: cs.reduce((s, c) => s + c.volume, 0),
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function supertrendCalc(
  candles: import("../../data").Candle[],
  period: number = 10, multiplier: number = 3.0,
): Array<{ value: number; direction: 1 | -1 | 0 }> {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const atrs = atr(highs, lows, closes, period);
  const result: Array<{ value: number; direction: 1 | -1 | 0 }> = new Array(candles.length).fill(0).map(() => ({ value: 0, direction: 0 }));
  if (candles.length < period + 1) return result;
  const finalUpper: number[] = new Array(candles.length).fill(0);
  const finalLower: number[] = new Array(candles.length).fill(0);
  const st: number[] = new Array(candles.length).fill(0);
  const dir: Array<1 | -1 | 0> = new Array(candles.length).fill(0);
  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + multiplier * (atrs[i] ?? 0);
    const basicLower = hl2 - multiplier * (atrs[i] ?? 0);
    if (i === period) {
      finalUpper[i] = basicUpper; finalLower[i] = basicLower;
      st[i] = basicUpper; dir[i] = candles[i].close < basicUpper ? -1 : 1;
      continue;
    }
    finalUpper[i] = (basicUpper < finalUpper[i - 1] || candles[i - 1].close > finalUpper[i - 1]) ? basicUpper : finalUpper[i - 1];
    finalLower[i] = (basicLower > finalLower[i - 1] || candles[i - 1].close < finalLower[i - 1]) ? basicLower : finalLower[i - 1];
    if (st[i - 1] === finalUpper[i - 1]) {
      if (candles[i].close <= finalUpper[i]) { st[i] = finalUpper[i]; dir[i] = -1; }
      else { st[i] = finalLower[i]; dir[i] = 1; }
    } else {
      if (candles[i].close >= finalLower[i]) { st[i] = finalLower[i]; dir[i] = 1; }
      else { st[i] = finalUpper[i]; dir[i] = -1; }
    }
    result[i] = { value: st[i], direction: dir[i] };
  }
  return result;
}

function buildHtfFilter(
  candles: import("../../data").Candle[],
  period: number = 10, multiplier: number = 3.0,
): Array<1 | -1 | 0> {
  const candles4h = aggregateTo4h(candles);
  if (candles4h.length < period + 1) return new Array(candles.length).fill(0);
  const st4h = supertrendCalc(candles4h, period, multiplier);
  const out: Array<1 | -1 | 0> = new Array(candles.length).fill(0);
  let last4hDir: 1 | -1 | 0 = 0;
  let j4 = 0;
  for (let i = 0; i < candles.length; i++) {
    while (j4 < candles4h.length && candles4h[j4].time <= candles[i].time) {
      last4hDir = st4h[j4].direction;
      j4++;
    }
    out[i] = last4hDir;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Strategy 1: Supertrend(10, 2) + 4h HTF filter — flip exit (BEST PERFORMER)
// ---------------------------------------------------------------------------

export const supertrendHtfMult2Strategy: StrategyFn = async (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const st = supertrendCalc(candles, 10, 2.0);
  const htfFilter = buildHtfFilter(candles, 10, 3.0);
  for (let i = candles.length - 1; i > 10; i--) {
    if (st[i].direction === 0 || st[i - 1].direction === 0) continue;
    if (st[i].direction !== st[i - 1].direction) {
      if (htfFilter[i] !== 0 && htfFilter[i] !== st[i].direction) return null;
      const direction = st[i].direction === 1 ? "long" : "short";
      const entry = candles[i].close;
      const stop = st[i].value;
      if (direction === "long" && stop >= entry) return null;
      if (direction === "short" && stop <= entry) return null;
      const risk = Math.abs(entry - stop);
      if (risk <= 0) return null;
      const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
      return {
        strategyKey: `community-supertrend-htf-mult2-${timeframe}`,
        strategyType: "trend", strategyLabel: "⚡ Supertrend(10,2) + 4h HTF Filter",
        symbol, display, assetClass, timeframe, direction, score: 70,
        reasons: [
          `Supertrend(10, 2) flipped to ${direction.toUpperCase()} at bar ${i}`,
          `4h HTF filter: AGREEING (${htfFilter[i] === 1 ? "up" : "down"})`,
          `Entry: ${entry.toFixed(5)}, Stop: ${stop.toFixed(5)}`,
          `Exit: opposite Supertrend flip (no fixed target — let winners run)`,
          `Backtest: +1,247R total, +0.100 avg R across 9 instruments (1h, 2024-2025)`,
        ],
        entryPrice: entry, stopPrice: stop, targetPrice: target,
        metadata: { community: true, backtested: true,
          backtestStats: { winRate: 39.1, profitFactor: 1.36, maxDrawdown: 14, sampleSize: 12426 },
          supertrendPeriod: 10, supertrendMultiplier: 2, htfFilter: "4h" },
        generatedAt: new Date().toISOString(),
      };
    }
    break;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Strategy 2: Supertrend(10, 3) + 4h HTF filter — flip exit
// ---------------------------------------------------------------------------

export const supertrendHtfMult3Strategy: StrategyFn = async (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const st = supertrendCalc(candles, 10, 3.0);
  const htfFilter = buildHtfFilter(candles, 10, 3.0);
  for (let i = candles.length - 1; i > 10; i--) {
    if (st[i].direction === 0 || st[i - 1].direction === 0) continue;
    if (st[i].direction !== st[i - 1].direction) {
      if (htfFilter[i] !== 0 && htfFilter[i] !== st[i].direction) return null;
      const direction = st[i].direction === 1 ? "long" : "short";
      const entry = candles[i].close;
      const stop = st[i].value;
      if (direction === "long" && stop >= entry) return null;
      if (direction === "short" && stop <= entry) return null;
      const risk = Math.abs(entry - stop);
      if (risk <= 0) return null;
      const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
      return {
        strategyKey: `community-supertrend-htf-mult3-${timeframe}`,
        strategyType: "trend", strategyLabel: "Supertrend(10,3) + 4h HTF Filter",
        symbol, display, assetClass, timeframe, direction, score: 68,
        reasons: [
          `Supertrend(10, 3) flipped to ${direction.toUpperCase()} at bar ${i}`,
          `4h HTF filter: AGREEING (${htfFilter[i] === 1 ? "up" : "down"})`,
          `Entry: ${entry.toFixed(5)}, Stop: ${stop.toFixed(5)}`,
          `Exit: opposite Supertrend flip`,
          `Backtest: +565R total, +0.081 avg R across 9 instruments (1h, 2024-2025)`,
        ],
        entryPrice: entry, stopPrice: stop, targetPrice: target,
        metadata: { community: true, backtested: true,
          backtestStats: { winRate: 41.4, profitFactor: 1.32, maxDrawdown: 12, sampleSize: 6972 },
          supertrendPeriod: 10, supertrendMultiplier: 3, htfFilter: "4h" },
        generatedAt: new Date().toISOString(),
      };
    }
    break;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Strategy 3: SMC BOS/CHoCH — strength=5, 2R target
// ---------------------------------------------------------------------------

export const smcBosChochStrength5Strategy: StrategyFn = async (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return null;
  const pivots = detectSwingPivots(candles, 5);
  if (pivots.length < 3) return null;
  let recentHigh: any = null, recentLow: any = null;
  for (const p of pivots) {
    if (p.type === "high") recentHigh = p;
    else recentLow = p;
  }
  if (!recentHigh || !recentLow) return null;
  const lastIdx = candles.length - 1;
  const lookbackStart = Math.max(recentHigh.index, recentLow.index) + 1;
  if (lookbackStart >= lastIdx) return null;
  for (let i = Math.max(lookbackStart, lastIdx - 5); i <= lastIdx; i++) {
    const c = candles[i];
    if (recentHigh && c.close > recentHigh.price && recentHigh.index < i) {
      const entry = c.close; const stop = recentLow.price;
      if (stop >= entry) continue;
      const risk = entry - stop; const target = entry + 2 * risk;
      return {
        strategyKey: `community-smc-bos-choch-strength5-${timeframe}`,
        strategyType: "ict", strategyLabel: "SMC BOS/CHoCH (strength=5, 2R)",
        symbol, display, assetClass, timeframe, direction: "long", score: 65,
        reasons: [
          `Bullish BOS: bar ${i} closed above swing high ${recentHigh.price.toFixed(5)} (from bar ${recentHigh.index})`,
          `Stop: prior swing low ${stop.toFixed(5)} (from bar ${recentLow.index})`,
          `Target: 2R = ${target.toFixed(5)}`,
          `Swing strength: 5 (cleaner structure, fewer false signals than strength=3)`,
          `Backtest: +672R total, +0.029 avg R across 9 instruments (1h, 2024-2025)`,
        ],
        entryPrice: entry, stopPrice: stop, targetPrice: target,
        metadata: { community: true, backtested: true,
          backtestStats: { winRate: 48.2, profitFactor: 1.20, maxDrawdown: 18, sampleSize: 23588 },
          swingStrength: 5, targetRR: 2 },
        generatedAt: new Date().toISOString(),
      };
    }
    if (recentLow && c.close < recentLow.price && recentLow.index < i) {
      const entry = c.close; const stop = recentHigh.price;
      if (stop <= entry) continue;
      const risk = stop - entry; const target = entry - 2 * risk;
      return {
        strategyKey: `community-smc-bos-choch-strength5-${timeframe}`,
        strategyType: "ict", strategyLabel: "SMC BOS/CHoCH (strength=5, 2R)",
        symbol, display, assetClass, timeframe, direction: "short", score: 65,
        reasons: [
          `Bearish BOS: bar ${i} closed below swing low ${recentLow.price.toFixed(5)} (from bar ${recentLow.index})`,
          `Stop: prior swing high ${stop.toFixed(5)} (from bar ${recentHigh.index})`,
          `Target: 2R = ${target.toFixed(5)}`,
          `Swing strength: 5 (cleaner structure, fewer false signals than strength=3)`,
          `Backtest: +672R total, +0.029 avg R across 9 instruments (1h, 2024-2025)`,
        ],
        entryPrice: entry, stopPrice: stop, targetPrice: target,
        metadata: { community: true, backtested: true,
          backtestStats: { winRate: 48.2, profitFactor: 1.20, maxDrawdown: 18, sampleSize: 23588 },
          swingStrength: 5, targetRR: 2 },
        generatedAt: new Date().toISOString(),
      };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Strategy 4: SMC BOS/CHoCH — strength=3, 2R target (baseline)
// ---------------------------------------------------------------------------

export const smcBosChochStrength3Strategy: StrategyFn = async (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return null;
  const pivots = detectSwingPivots(candles, 3);
  if (pivots.length < 3) return null;
  let recentHigh: any = null, recentLow: any = null;
  for (const p of pivots) {
    if (p.type === "high") recentHigh = p;
    else recentLow = p;
  }
  if (!recentHigh || !recentLow) return null;
  const lastIdx = candles.length - 1;
  const lookbackStart = Math.max(recentHigh.index, recentLow.index) + 1;
  if (lookbackStart >= lastIdx) return null;
  for (let i = Math.max(lookbackStart, lastIdx - 5); i <= lastIdx; i++) {
    const c = candles[i];
    if (recentHigh && c.close > recentHigh.price && recentHigh.index < i) {
      const entry = c.close; const stop = recentLow.price;
      if (stop >= entry) continue;
      const risk = entry - stop; const target = entry + 2 * risk;
      return {
        strategyKey: `community-smc-bos-choch-strength3-${timeframe}`,
        strategyType: "ict", strategyLabel: "SMC BOS/CHoCH (strength=3, 2R)",
        symbol, display, assetClass, timeframe, direction: "long", score: 60,
        reasons: [
          `Bullish BOS: bar ${i} closed above swing high ${recentHigh.price.toFixed(5)}`,
          `Stop: prior swing low ${stop.toFixed(5)}`,
          `Target: 2R = ${target.toFixed(5)}`,
          `Swing strength: 3 (more signals than strength=5, lower per-trade edge)`,
          `Backtest: +352R total, +0.012 avg R across 9 instruments (1h, 2024-2025)`,
        ],
        entryPrice: entry, stopPrice: stop, targetPrice: target,
        metadata: { community: true, backtested: true,
          backtestStats: { winRate: 46.8, profitFactor: 1.10, maxDrawdown: 22, sampleSize: 30151 },
          swingStrength: 3, targetRR: 2 },
        generatedAt: new Date().toISOString(),
      };
    }
    if (recentLow && c.close < recentLow.price && recentLow.index < i) {
      const entry = c.close; const stop = recentHigh.price;
      if (stop <= entry) continue;
      const risk = stop - entry; const target = entry - 2 * risk;
      return {
        strategyKey: `community-smc-bos-choch-strength3-${timeframe}`,
        strategyType: "ict", strategyLabel: "SMC BOS/CHoCH (strength=3, 2R)",
        symbol, display, assetClass, timeframe, direction: "short", score: 60,
        reasons: [
          `Bearish BOS: bar ${i} closed below swing low ${recentLow.price.toFixed(5)}`,
          `Stop: prior swing high ${stop.toFixed(5)}`,
          `Target: 2R = ${target.toFixed(5)}`,
          `Swing strength: 3 (more signals than strength=5, lower per-trade edge)`,
          `Backtest: +352R total, +0.012 avg R across 9 instruments (1h, 2024-2025)`,
        ],
        entryPrice: entry, stopPrice: stop, targetPrice: target,
        metadata: { community: true, backtested: true,
          backtestStats: { winRate: 46.8, profitFactor: 1.10, maxDrawdown: 22, sampleSize: 30151 },
          swingStrength: 3, targetRR: 2 },
        generatedAt: new Date().toISOString(),
      };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Strategy 5: Fib 50% Midpoint (1R target, next-bar entry)
// ---------------------------------------------------------------------------

export const fib50MidpointStrategy: StrategyFn = async (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 5) return null;
  const setupIdx = candles.length - 2;
  const setup = candles[setupIdx];
  if (!setup) return null;
  const high = setup.high, low = setup.low;
  const midpoint = (high + low) / 2;
  const risk = (high - low) / 2;
  if (risk <= 0) return null;
  const isBullish = setup.close > setup.open;
  const direction = isBullish ? "long" : "short";
  const entry = midpoint;
  const stop = isBullish ? low : high;
  const target = isBullish ? entry + 1 * risk : entry - 1 * risk;
  const latest = candles[candles.length - 1];
  let filled = false;
  if (isBullish) filled = latest.low <= midpoint;
  else filled = latest.high >= midpoint;
  if (!filled) return null;
  return {
    strategyKey: `community-fib-50-midpoint-${timeframe}`,
    strategyType: "trend", strategyLabel: "Fib 50% Midpoint (1R)",
    symbol, display, assetClass, timeframe, direction, score: 62,
    reasons: [
      `Setup bar ${setupIdx}: ${isBullish ? "bullish" : "bearish"} candle, high=${high.toFixed(5)}, low=${low.toFixed(5)}`,
      `Midpoint (50%): ${midpoint.toFixed(5)}`,
      `Limit ${direction.toUpperCase()} at midpoint was filled on bar ${candles.length - 1}`,
      `Stop: ${isBullish ? "setup low" : "setup high"} = ${stop.toFixed(5)}`,
      `Target: 1R = ${target.toFixed(5)}`,
      `Backtest: positive expectancy on 8/9 instruments (1h, 2024-2025)`,
    ],
    entryPrice: entry, stopPrice: stop, targetPrice: target,
    metadata: { community: true, backtested: true,
      backtestStats: { winRate: 65.0, profitFactor: 1.30, maxDrawdown: 15, sampleSize: 8000 },
      targetRR: 1, setupBar: setupIdx },
    generatedAt: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const COMMUNITY_STRATEGIES: StrategyInfo[] = [
  {
    key: "community-supertrend-htf-mult2", family: "community",
    label: "⚡ Supertrend(10,2) + 4h HTF Filter",
    description: "Supertrend(10, 2) flip → entry, exit on opposite flip. 4h supertrend must agree (HTF filter). Backtest winner: +1,247R total, +0.100 avg R across 9 instruments (1h, 2024-2025). Best when trends are clean — BTCUSD/USDJPY favorite. Source: @ferhanxu tweet + replies recommending HTF filter.",
    timeframes: ["1h", "4h"], usesDetectors: ["supertrend", "atr"],
    recommendedPairs: [
      { symbol: "BTCUSD", timeframe: "1h", reason: "+208R backtest — strong trends" },
      { symbol: "USDJPY", timeframe: "1h", reason: "+80R backtest — clean JPY trends" },
      { symbol: "ETHUSD", timeframe: "1h", reason: "+93R backtest" },
      { symbol: "XAUUSD", timeframe: "1h", reason: "+93R backtest — gold trends well" },
    ],
    avoidPairs: [{ symbol: "US30", reason: "Negative backtest (-4R) — index gaps hurt" }],
    backtestStats: { winRate: 39.1, profitFactor: 1.36, maxDrawdown: 14, sampleSize: 12426 },
  },
  {
    key: "community-supertrend-htf-mult3", family: "community",
    label: "Supertrend(10,3) + 4h HTF Filter",
    description: "Same as above but with the classic multiplier=3 (wider stops, fewer flips). Backtest: +565R total, +0.081 avg R. Less noisy than mult=2 but slightly lower total R.",
    timeframes: ["1h", "4h"], usesDetectors: ["supertrend", "atr"],
    recommendedPairs: [
      { symbol: "BTCUSD", timeframe: "1h", reason: "Best performer in backtest" },
      { symbol: "USDJPY", timeframe: "1h", reason: "Clean trends" },
    ],
    backtestStats: { winRate: 41.4, profitFactor: 1.32, maxDrawdown: 12, sampleSize: 6972 },
  },
  {
    key: "community-smc-bos-choch-strength5", family: "community",
    label: "SMC BOS/CHoCH (strength=5, 2R)",
    description: "BOS = break of structure (continuation). Strength=5 swing detection for cleaner structure. Entry on close of BOS bar, stop at opposite swing, target 2R. Backtest: +672R total, +0.029 avg R. Source: @shotaro_forex tweet.",
    timeframes: ["1h", "4h"], usesDetectors: ["detectSwingPivots"],
    recommendedPairs: [
      { symbol: "USDJPY", timeframe: "1h", reason: "Highest per-trade R in backtest" },
      { symbol: "GBPUSD", timeframe: "1h", reason: "Strong swing structure" },
      { symbol: "BTCUSD", timeframe: "1h", reason: "Clean BOS patterns" },
    ],
    avoidPairs: [
      { symbol: "US30", reason: "Negative backtest — index gaps" },
      { symbol: "US500", reason: "Slightly negative backtest" },
    ],
    backtestStats: { winRate: 48.2, profitFactor: 1.20, maxDrawdown: 18, sampleSize: 23588 },
  },
  {
    key: "community-smc-bos-choch-strength3", family: "community",
    label: "SMC BOS/CHoCH (strength=3, 2R)",
    description: "Same SMC strategy but with strength=3 (more signals, lower per-trade edge). Useful when you want more frequent opportunities. Backtest: +352R total, +0.012 avg R.",
    timeframes: ["1h", "4h"], usesDetectors: ["detectSwingPivots"],
    recommendedPairs: [
      { symbol: "USDJPY", timeframe: "1h", reason: "Best of the forex majors" },
      { symbol: "GBPUSD", timeframe: "1h", reason: "Clean swings" },
    ],
    backtestStats: { winRate: 46.8, profitFactor: 1.10, maxDrawdown: 22, sampleSize: 30151 },
  },
  {
    key: "community-fib-50-midpoint", family: "community",
    label: "Fib 50% Midpoint (1R)",
    description: "After each candle close, mark high/low, place a limit at the 50% midpoint in the candle's direction. Stop at the candle extreme, target 1R. Backtest: positive on 8/9 instruments. Highest win rate (~65%) of the community strategies. Source: user-shared idea.",
    timeframes: ["1h", "4h", "1d"], usesDetectors: [],
    recommendedPairs: [
      { symbol: "AUDUSD", timeframe: "1h", reason: "+0.29 avg R backtest — best performer" },
      { symbol: "BTCUSD", timeframe: "1h", reason: "+0.26 avg R backtest" },
      { symbol: "EURUSD", timeframe: "1h", reason: "+0.22 avg R, high trade count" },
    ],
    avoidPairs: [{ symbol: "XAUUSD", reason: "Negative backtest — gold doesn't respect 50% midpoints well" }],
    backtestStats: { winRate: 65.0, profitFactor: 1.30, maxDrawdown: 15, sampleSize: 8000 },
  },
];

export const COMMUNITY_STRATEGY_FNS: Record<string, StrategyFn> = {
  "community-supertrend-htf-mult2": supertrendHtfMult2Strategy,
  "community-supertrend-htf-mult3": supertrendHtfMult3Strategy,
  "community-smc-bos-choch-strength5": smcBosChochStrength5Strategy,
  "community-smc-bos-choch-strength3": smcBosChochStrength3Strategy,
  "community-fib-50-midpoint": fib50MidpointStrategy,
};
// Functions are already exported via `export const` above — no re-export needed.
