// src/lib/scanner/regime.ts
// Market regime classifier — Bull / Bear / Sideways per instrument + timeframe.
//
// "Many false signals come from running every strategy in every regime."
// Trend and breakout strategies are suppressed in sideways regimes;
// counter-trend setups are suppressed in strong trends.
//
// Classification is simple and fast (no ML): combines EMA stack direction +
// ADX strength + Supertrend direction. Heuristic but conservative.

import type { Candle } from "./data";
import { ema } from "./indicators/moving-averages";
import { adx as adxCalc } from "./indicators/adx";
import { supertrend as supertrendCalc } from "./indicators/supertrend";
import { getIndicatorCache } from "./indicatorCache";

export type Regime = "bull" | "bear" | "sideways";

export interface RegimeAssessment {
  regime: Regime;
  /** 0-100: how confident we are in the regime. <40 = weak/uncertain. */
  strength: number;
  /** Human-readable summary, e.g. "Bull · ADX 32 · EMA stack aligned" */
  label: string;
}

/**
 * Classify the market regime for a series of candles.
 *
 * Logic:
 *   1. EMA stack: 8 > 21 > 50 > 200 = bullish; 8 < 21 < 50 < 200 = bearish
 *   2. ADX: >25 = strong trend; 20-25 = developing; <20 = sideways
 *   3. Supertrend: confirms direction (1 = up, -1 = down)
 *
 *   - Bull: EMA stack bullish + ADX > 20 + Supertrend up
 *   - Bear: EMA stack bearish + ADX > 20 + Supertrend down
 *   - Sideways: ADX < 20, or EMAs tangled (no clean stack)
 */
export function classifyRegime(candles: Candle[], symbol?: string, tf?: string): RegimeAssessment {
  if (candles.length < 200) {
    return { regime: "sideways", strength: 0, label: "Insufficient data" };
  }
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const last = closes.length - 1;

  // Use the shared indicator cache when available (set by runScan per-sweep).
  // Falls back to direct computation when no cache is present (standalone use).
  const cache = symbol && tf ? getIndicatorCache() : null;

  const ema8 = cache ? cache.getEma(symbol!, tf!, candles, 8) : ema(closes, 8);
  const ema21 = cache ? cache.getEma(symbol!, tf!, candles, 21) : ema(closes, 21);
  const ema50 = cache ? cache.getEma(symbol!, tf!, candles, 50) : ema(closes, 50);
  const ema200 = cache ? cache.getEma(symbol!, tf!, candles, 200) : ema(closes, 200);

  const e8 = ema8[last];
  const e21 = ema21[last];
  const e50 = ema50[last];
  const e200 = ema200[last];

  if (e8 == null || e21 == null || e50 == null || e200 == null) {
    return { regime: "sideways", strength: 0, label: "EMA calc failed" };
  }

  // EMA stack alignment
  const bullStack = e8 > e21 && e21 > e50 && e50 > e200;
  const bearStack = e8 < e21 && e21 < e50 && e50 < e200;

  // ADX (trend strength) — returns ADXState[] with .adx property
  const adxStates = cache ? cache.getAdx(symbol!, tf!, candles, 14) : adxCalc(highs, lows, closes, 14);
  const adxLast = adxStates[adxStates.length - 1]?.adx ?? 0;

  // Supertrend — returns SupertrendState[] with .direction (1 | -1)
  const stStates = cache ? cache.getSupertrend(symbol!, tf!, candles, 10, 3) : supertrendCalc(highs, lows, closes, 10, 3);
  const stLast = stStates[stStates.length - 1];
  const stUp = stLast?.direction === 1;
  const stDown = stLast?.direction === -1;

  // Score the regime with weighted votes
  let bullVotes = 0;
  let bearVotes = 0;
  let totalVotes = 0;

  // EMA stack (2 votes — strongest signal)
  totalVotes += 2;
  if (bullStack) bullVotes += 2;
  else if (bearStack) bearVotes += 2;

  // Price vs EMA200 (1 vote)
  totalVotes += 1;
  if (closes[last] > e200) bullVotes += 1;
  else if (closes[last] < e200) bearVotes += 1;

  // Supertrend (1 vote)
  totalVotes += 1;
  if (stUp) bullVotes += 1;
  else if (stDown) bearVotes += 1;

  // ADX gates: if ADX < 20, the trend is weak regardless of EMA alignment
  const strongTrend = adxLast >= 25;
  const developingTrend = adxLast >= 20;

  // Decide regime
  let regime: Regime = "sideways";
  let strength = 0;
  const parts: string[] = [];

  if (bullVotes > bearVotes && (bullStack || stUp) && developingTrend) {
    regime = "bull";
    strength = Math.min(100, Math.round((bullVotes / totalVotes) * 100 * (strongTrend ? 1 : 0.7)));
    parts.push("Bull");
    if (bullStack) parts.push("EMA stack aligned");
    parts.push(strongTrend ? `ADX ${adxLast.toFixed(0)}` : `ADX ${adxLast.toFixed(0)} (developing)`);
  } else if (bearVotes > bullVotes && (bearStack || stDown) && developingTrend) {
    regime = "bear";
    strength = Math.min(100, Math.round((bearVotes / totalVotes) * 100 * (strongTrend ? 1 : 0.7)));
    parts.push("Bear");
    if (bearStack) parts.push("EMA stack aligned");
    parts.push(strongTrend ? `ADX ${adxLast.toFixed(0)}` : `ADX ${adxLast.toFixed(0)} (developing)`);
  } else {
    regime = "sideways";
    strength = Math.max(0, Math.round((1 - adxLast / 25) * 100));
    parts.push("Sideways");
    parts.push(`ADX ${adxLast.toFixed(0)}`);
    if (!bullStack && !bearStack) parts.push("EMAs tangled");
  }

  return { regime, strength, label: parts.join(" · ") };
}

/**
 * Returns true if a strategy type is compatible with the given regime.
 * Used to gate signals — suppress strategies that don't fit the current regime.
 *
 * - Trend strategies (trend, ea): require bull or bear (not sideways),
 *   and suppress counter-trend signals
 * - ICT strategies (ict, trader): work in any regime (they look for
 *   structure shifts, which happen at regime transitions)
 * - HORC (origin/structure): works in any regime
 * - Community: mixed — let them through
 */
export function strategyFitsRegime(
  strategyType: "trend" | "ict" | "trader" | "ea" | "horc" | "community",
  regime: Regime,
  signalDirection: "long" | "short" | "neutral",
): boolean {
  // Trend + EA: suppress in sideways, suppress counter-trend
  if (strategyType === "trend" || strategyType === "ea") {
    if (regime === "sideways") return false;
    if (regime === "bull" && signalDirection === "short") return false;
    if (regime === "bear" && signalDirection === "long") return false;
    return true;
  }
  // ICT + Trader + HORC + Community: allow in all regimes
  // (they look for transitions, liquidity, structure shifts — valid anytime)
  return true;
}
