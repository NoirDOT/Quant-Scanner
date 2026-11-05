// src/lib/scanner/strategies/trend/index.ts
// Trend continuation strategies — 6 indicator families × 5 timeframes
// All indicators are cached per symbol+TF via the indicatorCache (set by runScan).

import type { StrategyContext, ScanSignal, ScannerFn, StrategyInfo } from "../../types";
import {
  ema,
  stackedEma,
  macd,
  adx,
  rsi,
  supertrend,
  psar,
  ichimoku,
  heikinAshi,
  haTrendContinuation,
  donchianFromCloses,
} from "../../indicators";
import { getIndicatorCache } from "../../indicatorCache";
import { findSwingPoints } from "../../ict/structure";

export const TREND_STRATEGIES: StrategyInfo[] = [
  { key: "trend-ema", type: "trend", label: "EMA Stack (8/21/50/200)", description: "Bullish/bearish stacked EMAs with price above/below all", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-supertrend-psar", type: "trend", label: "Supertrend + PSAR", description: "Supertrend flip confirmed by PSAR alignment", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-macd-adx", type: "trend", label: "MACD + ADX", description: "MACD histogram expansion + ADX>25 trend strength", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-ichimoku", type: "trend", label: "Ichimoku Cloud", description: "Tenkan/Kijun cross + price on correct side of cloud", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-heikin-ashi", type: "trend", label: "Heikin-Ashi Trend", description: "3 consecutive HA candles with no opposite wick", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-donchian", type: "trend", label: "Donchian Breakout", description: "20-period Donchian channel breakout with confirmation", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-following", type: "trend", label: "Trend Following", description: "Multi-EMA momentum system: EMA 21>50>200 aligned + ADX>20 + MACD confirms + pullback entry", timeframes: ["4h", "1d", "1w"] },
  { key: "trend-buy-hold", type: "trend", label: "Buy & Hold Accumulation", description: "Long-term uptrend filter: above 200 EMA + positive 50-bar momentum + volume rising. Wide stop, no fixed target.", timeframes: ["1d", "1w"] },
  { key: "trend-trendline", type: "trend", label: "Trendline Break", description: "Swing-based trendline: breaks above descending TL (long) or below ascending TL (short). Entry on break, stop at TL.", timeframes: ["1h", "2h", "4h", "1d"] },
];

// === EMA Stack ===
export const emaStackScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 200) return Promise.resolve(null);
  const closes = candles.map((c) => c.close);
  const cache = getIndicatorCache();
  const states = cache ? cache.getStackedEma(symbol, timeframe, candles) : stackedEma(closes);
  const last = states[states.length - 1];
  if (!last) return Promise.resolve(null);
  const lastClose = closes[closes.length - 1];
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  if (last.bullishStack) {
    direction = "long";
    score += 50;
    reasons.push("Bullish EMA stack (8 > 21 > 50 > 200)");
    if (last.priceAboveAll) {
      score += 20;
      reasons.push("Price above all 4 EMAs (strong trend continuation)");
    }
  } else if (last.bearishStack) {
    direction = "short";
    score += 50;
    reasons.push("Bearish EMA stack (8 < 21 < 50 < 200)");
    if (last.priceBelowAll) {
      score += 20;
      reasons.push("Price below all 4 EMAs (strong trend continuation)");
    }
  }
  // Extra: distance from EMA21 (pullback entry)
  if (direction !== "neutral") {
    const dist = Math.abs(lastClose - last.ema21) / last.ema21;
    if (dist < 0.005) {
      score += 20;
      reasons.push("Price near EMA21 (pullback entry zone)");
    }
  }
  score = Math.min(100, score);
  if (score < 50) return Promise.resolve(null);
  const entry = lastClose;
  const stop = direction === "long"
    ? Math.min(last.ema50, last.ema21) * 0.995
    : Math.max(last.ema50, last.ema21) * 1.005;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return Promise.resolve({
    strategyKey: `trend-ema-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EMA Stack · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { ema8: last.ema8, ema21: last.ema21, ema50: last.ema50, ema200: last.ema200 },
  });
};

// === Supertrend + PSAR ===
export const supertrendPsarScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return Promise.resolve(null);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const cache = getIndicatorCache();
  const st = cache ? cache.getSupertrend(symbol, timeframe, candles, 10, 3) : supertrend(highs, lows, closes, 10, 3);
  const ps = cache ? cache.getPsar(symbol, timeframe, candles) : psar(highs, lows, closes);
  const lastSt = st[st.length - 1];
  const lastPs = ps[ps.length - 1];
  if (!lastSt || !lastPs) return Promise.resolve(null);
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  if (lastSt.justFlippedUp || (lastSt.direction === 1 && lastPs?.isUp)) {
    direction = "long";
    score += 40;
    if (lastSt.justFlippedUp) {
      score += 20;
      reasons.push("Supertrend just flipped UP (trend continuation trigger)");
    } else {
      reasons.push("Supertrend in uptrend + PSAR confirms bullish");
    }
    if (lastPs?.isUp) {
      score += 20;
      reasons.push("PSAR below price (trend continuation confirmed)");
    }
  } else if (lastSt.justFlippedDown || (lastSt.direction === -1 && lastPs?.isDown)) {
    direction = "short";
    score += 40;
    if (lastSt.justFlippedDown) {
      score += 20;
      reasons.push("Supertrend just flipped DOWN (trend continuation trigger)");
    } else {
      reasons.push("Supertrend in downtrend + PSAR confirms bearish");
    }
    if (lastPs?.isDown) {
      score += 20;
      reasons.push("PSAR above price (trend continuation confirmed)");
    }
  }
  const lastClose = closes[closes.length - 1];
  if (lastPs?.flippedUp) {
    score += 10;
    reasons.push("PSAR just flipped up this bar");
  } else if (lastPs?.flippedDown) {
    score += 10;
    reasons.push("PSAR just flipped down this bar");
  }
  score = Math.min(100, score);
  if (score < 50) return Promise.resolve(null);
  const entry = lastClose;
  const stop = lastSt.value;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return Promise.resolve({
    strategyKey: `trend-supertrend-psar-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Supertrend+PSAR · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { supertrend: lastSt.value, supertrendDir: lastSt.direction, psar: lastPs?.psar },
  });
};

// === MACD + ADX ===
export const macdAdxScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 60) return Promise.resolve(null);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const cache = getIndicatorCache();
  const macdStates = cache ? cache.getMacd(symbol, timeframe, candles) : macd(closes);
  const adxStates = cache ? cache.getAdx(symbol, timeframe, candles) : adx(highs, lows, closes);
  const lastMacd = macdStates[macdStates.length - 1];
  const lastAdx = adxStates[adxStates.length - 1];
  if (!lastMacd || !lastAdx) return Promise.resolve(null);
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  if (lastMacd.histogram > 0 && lastAdx.adx > 25 && lastAdx.bullishDI) {
    direction = "long";
    score += 30;
    reasons.push("MACD histogram positive + ADX>25 trend strength");
    if (lastMacd.histogramExpansion) {
      score += 20;
      reasons.push("MACD histogram expanding (momentum growing)");
    }
    if (lastAdx.adx > 40) {
      score += 20;
      reasons.push(`ADX extremely strong (${lastAdx.adx.toFixed(1)})`);
    } else if (lastAdx.adx > 30) {
      score += 10;
      reasons.push(`ADX strong (${lastAdx.adx.toFixed(1)})`);
    }
    if (lastMacd.crossUp) {
      score += 20;
      reasons.push("MACD just crossed above signal line (fresh buy trigger)");
    }
  } else if (lastMacd.histogram < 0 && lastAdx.adx > 25 && lastAdx.bearishDI) {
    direction = "short";
    score += 30;
    reasons.push("MACD histogram negative + ADX>25 trend strength");
    if (lastMacd.histogramExpansion) {
      score += 20;
      reasons.push("MACD histogram expanding (bearish momentum growing)");
    }
    if (lastAdx.adx > 40) {
      score += 20;
      reasons.push(`ADX extremely strong (${lastAdx.adx.toFixed(1)})`);
    } else if (lastAdx.adx > 30) {
      score += 10;
      reasons.push(`ADX strong (${lastAdx.adx.toFixed(1)})`);
    }
    if (lastMacd.crossDown) {
      score += 20;
      reasons.push("MACD just crossed below signal line (fresh sell trigger)");
    }
  }
  score = Math.min(100, score);
  if (score < 50) return Promise.resolve(null);
  const lastClose = closes[closes.length - 1];
  const rsiVals = cache ? cache.getRsi(symbol, timeframe, candles) : rsi(closes, 14);
  const rsiVal = rsiVals[rsiVals.length - 1] ?? 50;
  const entry = lastClose;
  // Stop beyond recent swing using 14-bar ATR proxy via true range
  const tr = Math.max(
    highs[highs.length - 1] - lows[lows.length - 1],
    Math.abs(highs[highs.length - 1] - closes[closes.length - 2]),
    Math.abs(lows[lows.length - 1] - closes[closes.length - 2])
  );
  const stop = direction === "long" ? entry - 1.5 * tr : entry + 1.5 * tr;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  reasons.push(`RSI(14)=${rsiVal?.toFixed(1)}`);
  return Promise.resolve({
    strategyKey: `trend-macd-adx-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `MACD+ADX · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { macd: lastMacd.macd, adx: lastAdx.adx, rsi: rsiVal },
  });
};

// === Ichimoku ===
export const ichimokuScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 80) return Promise.resolve(null);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const cache = getIndicatorCache();
  const states = cache ? cache.getIchimoku(symbol, timeframe, candles) : ichimoku(highs, lows, closes);
  const last = states[states.length - 1];
  if (!last) return Promise.resolve(null);
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  if (last.priceAboveCloud && last.cloudBullish && last.bullishCross) {
    direction = "long";
    score += 50;
    reasons.push("Price above cloud + cloud bullish + Tenkan crossed above Kijun");
  } else if (last.priceBelowCloud && last.cloudBearish && last.bearishCross) {
    direction = "short";
    score += 50;
    reasons.push("Price below cloud + cloud bearish + Tenkan crossed below Kijun");
  } else if (last.priceAboveCloud && last.cloudBullish) {
    direction = "long";
    score += 30;
    reasons.push("Price above bullish cloud (trend continuation context)");
    if (last.bullishCross) {
      score += 20;
      reasons.push("Tenkan crossed above Kijun this bar");
    }
  } else if (last.priceBelowCloud && last.cloudBearish) {
    direction = "short";
    score += 30;
    reasons.push("Price below bearish cloud (trend continuation context)");
    if (last.bearishCross) {
      score += 20;
      reasons.push("Tenkan crossed below Kijun this bar");
    }
  }
  score = Math.min(100, score);
  if (score < 50) return Promise.resolve(null);
  const lastClose = closes[closes.length - 1];
  const entry = lastClose;
  const stop = direction === "long" ? Math.min(last.senkouA, last.senkouB) * 0.995 : Math.max(last.senkouA, last.senkouB) * 1.005;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return Promise.resolve({
    strategyKey: `trend-ichimoku-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Ichimoku · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      tenkan: last.tenkan,
      kijun: last.kijun,
      senkouA: last.senkouA,
      senkouB: last.senkouB,
    },
  });
};

// === Heikin-Ashi trend ===
export const heikinAshiScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return Promise.resolve(null);
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const cache = getIndicatorCache();
  const ha = cache ? cache.getHeikinAshi(symbol, timeframe, candles) : heikinAshi(opens, highs, lows, closes);
  const trend = haTrendContinuation(ha, 3);
  const last = ha[ha.length - 1];
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  if (trend === "bull") {
    direction = "long";
    score += 50;
    reasons.push("3+ consecutive bullish HA candles with no lower wick");
    if (last.strongBull) {
      score += 20;
      reasons.push("Last candle closed at high (strong bull)");
    }
  } else if (trend === "bear") {
    direction = "short";
    score += 50;
    reasons.push("3+ consecutive bearish HA candles with no upper wick");
    if (last.strongBear) {
      score += 20;
      reasons.push("Last candle closed at low (strong bear)");
    }
  }
  // Pullback: last candle shows opposite wick (entry signal)
  if (direction === "long" && last.close < last.open) {
    score += 15;
    reasons.push("Mild pullback this bar (entry opportunity)");
  } else if (direction === "short" && last.close > last.open) {
    score += 15;
    reasons.push("Mild pullback this bar (entry opportunity)");
  }
  score = Math.min(100, score);
  if (score < 50) return Promise.resolve(null);
  const lastClose = closes[closes.length - 1];
  const entry = lastClose;
  const stop = direction === "long" ? last.low * 0.995 : last.high * 1.005;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return Promise.resolve({
    strategyKey: `trend-heikin-ashi-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Heikin-Ashi · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
  });
};

// === Donchian Breakout ===
export const donchianBreakoutScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 25) return Promise.resolve(null);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const cache = getIndicatorCache();
  const states = cache ? cache.getDonchian(symbol, timeframe, candles, 20) : donchianFromCloses(highs, lows, closes, 20);
  const last = states[states.length - 1];
  if (!last) return Promise.resolve(null);
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  if (last.brokeUp) {
    direction = "long";
    score += 50;
    reasons.push("Closed above 20-period Donchian upper (breakout)");
    // Confirm with volume spike if available
    const vol = candles[candles.length - 1].volume;
    const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
    if (vol > avgVol * 1.3 && vol > 0) {
      score += 20;
      reasons.push("Volume spike on breakout (+30% above average)");
    }
  } else if (last.brokeDown) {
    direction = "short";
    score += 50;
    reasons.push("Closed below 20-period Donchian lower (breakdown)");
    const vol = candles[candles.length - 1].volume;
    const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
    if (vol > avgVol * 1.3 && vol > 0) {
      score += 20;
      reasons.push("Volume spike on breakdown (+30% above average)");
    }
  }
  // Trend continuation: donchian channel slope
  if (direction !== "neutral") {
    const states5 = states[states.length - 6];
    if (states5) {
      if (direction === "long" && last.upper > states5.upper) {
        score += 15;
        reasons.push("Channel upper rising (trend continuation confirmed)");
      } else if (direction === "short" && last.lower < states5.lower) {
        score += 15;
        reasons.push("Channel lower falling (trend continuation confirmed)");
      }
    }
  }
  score = Math.min(100, score);
  if (score < 50) return Promise.resolve(null);
  const lastClose = closes[closes.length - 1];
  const entry = lastClose;
  const stop = direction === "long" ? last.middle : last.middle;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return Promise.resolve({
    strategyKey: `trend-donchian-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Donchian · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { upper: last.upper, lower: last.lower, middle: last.middle },
  });
};

// === Trendline Break ===
// Uses swing points to draw a trendline, signals on break.

// ─── Trend Following (momentum + pullback) ──────────────────────────────────
// A classic trend-following system: EMA 21 > 50 > 200 aligned (bull) or
// 21 < 50 < 200 aligned (bear), ADX > 20 confirms trend strength, MACD
// histogram confirms direction, entry on pullback to EMA21, stop below
// EMA50, target at 2R.
export const trendFollowingScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 200) return Promise.resolve(null);
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const cache = getIndicatorCache();
  const ema21Arr = cache ? cache.getEma(symbol, timeframe, candles, 21) : ema(closes, 21);
  const ema50Arr = cache ? cache.getEma(symbol, timeframe, candles, 50) : ema(closes, 50);
  const ema200Arr = cache ? cache.getEma(symbol, timeframe, candles, 200) : ema(closes, 200);
  const adxArr = cache ? cache.getAdx(symbol, timeframe, candles) : adx(highs, lows, closes);
  const macdStates = cache ? cache.getMacd(symbol, timeframe, candles) : macd(closes);
  const rsiArr = cache ? cache.getRsi(symbol, timeframe, candles) : rsi(closes, 14);

  const last = closes.length - 1;
  const e21 = ema21Arr[last];
  const e50 = ema50Arr[last];
  const e200 = ema200Arr[last];
  const lastAdx = adxArr[last];
  const lastMacd = macdStates[last];
  const lastRsi = rsiArr[last];
  if (!e21 || !e50 || !e200 || !lastAdx || !lastMacd) return Promise.resolve(null);

  const lastClose = closes[last];
  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";

  // Bullish trend: EMA 21 > 50 > 200
  if (e21 > e50 && e50 > e200) {
    direction = "long";
    score += 30;
    reasons.push("EMA 21 > 50 > 200 (bullish trend alignment)");

    // ADX confirms trend strength
    if (lastAdx.adx > 25) {
      score += 20;
      reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (strong trend)`);
    } else if (lastAdx.adx > 20) {
      score += 10;
      reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (developing trend)`);
    } else {
      score -= 10;
      reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (weak — trend may be fading)`);
    }

    // MACD confirms direction
    if (lastMacd.histogram > 0) {
      score += 15;
      reasons.push("MACD histogram positive (momentum confirms)");
    } else {
      score -= 10;
      reasons.push("MACD histogram negative (momentum diverges)");
    }

    // Pullback entry: price near EMA21 (within 1 ATR)
    const dist = (lastClose - e21) / e21;
    if (Math.abs(dist) < 0.005) {
      score += 20;
      reasons.push("Price near EMA21 (pullback entry zone)");
    } else if (lastClose > e21) {
      score += 5;
      reasons.push("Price above EMA21 (trend continuation)");
    }

    // RSI not overbought
    if (lastRsi != null && lastRsi < 70) {
      score += 10;
      reasons.push(`RSI ${lastRsi.toFixed(0)} (room to run)`);
    } else if (lastRsi != null && lastRsi >= 70) {
      score -= 10;
      reasons.push(`RSI ${lastRsi.toFixed(0)} (overbought — wait for pullback)`);
    }
  }
  // Bearish trend: EMA 21 < 50 < 200
  else if (e21 < e50 && e50 < e200) {
    direction = "short";
    score += 30;
    reasons.push("EMA 21 < 50 < 200 (bearish trend alignment)");

    if (lastAdx.adx > 25) {
      score += 20;
      reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (strong trend)`);
    } else if (lastAdx.adx > 20) {
      score += 10;
      reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (developing trend)`);
    }

    if (lastMacd.histogram < 0) {
      score += 15;
      reasons.push("MACD histogram negative (momentum confirms)");
    }

    const dist = (lastClose - e21) / e21;
    if (Math.abs(dist) < 0.005) {
      score += 20;
      reasons.push("Price near EMA21 (pullback entry zone)");
    }

    if (lastRsi != null && lastRsi > 30) {
      score += 10;
      reasons.push(`RSI ${lastRsi.toFixed(0)} (room to fall)`);
    }
  }

  score = Math.min(100, Math.max(0, score));
  if (score < 50) return Promise.resolve(null);

  const entry = lastClose;
  const stop = direction === "long"
    ? e50 * 0.995  // stop below EMA50
    : e50 * 1.005;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;

  return Promise.resolve({
    strategyKey: `trend-following-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Trend Following · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { ema21: e21, ema50: e50, ema200: e200, adx: lastAdx.adx, macdHist: lastMacd.histogram, rsi: lastRsi },
  });
};

// ─── Buy & Hold Accumulation ────────────────────────────────────────────────
// Long-term accumulation signal: identifies instruments in a sustained
// uptrend (above 200 EMA, positive 50-bar momentum, volume rising) and
// signals "accumulate" (long). Wide stop below 200 EMA, no fixed target —
// this is a position-building signal, not a quick trade.
export const buyHoldScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 200) return Promise.resolve(null);
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const cache = getIndicatorCache();
  const ema50Arr = cache ? cache.getEma(symbol, timeframe, candles, 50) : ema(closes, 50);
  const ema200Arr = cache ? cache.getEma(symbol, timeframe, candles, 200) : ema(closes, 200);
  const adxArr = cache ? cache.getAdx(symbol, timeframe, candles) : adx(highs, lows, closes);

  const last = closes.length - 1;
  const e50 = ema50Arr[last];
  const e200 = ema200Arr[last];
  const lastAdx = adxArr[last];
  if (!e50 || !e200 || !lastAdx) return Promise.resolve(null);

  const lastClose = closes[last];
  const reasons: string[] = [];
  let score = 0;

  // Must be above 200 EMA (long-term uptrend)
  if (lastClose <= e200) return Promise.resolve(null);
  score += 30;
  reasons.push("Price above 200 EMA (long-term uptrend intact)");

  // EMA 50 above 200 (golden cross structure)
  if (e50 > e200) {
    score += 20;
    reasons.push("EMA 50 > 200 (golden cross — bullish structure)");
  }

  // Positive 50-bar momentum (price higher than 50 bars ago)
  const momentumBar = Math.max(0, last - 50);
  const momentum = (lastClose - closes[momentumBar]) / closes[momentumBar];
  if (momentum > 0.02) {
    score += 15;
    reasons.push(`+${(momentum * 100).toFixed(1)}% over 50 bars (positive momentum)`);
  } else if (momentum > 0) {
    score += 5;
    reasons.push(`+${(momentum * 100).toFixed(1)}% over 50 bars (slight positive)`);
  } else {
    score -= 10;
    reasons.push(`${(momentum * 100).toFixed(1)}% over 50 bars (momentum fading)`);
  }

  // ADX > 20 (trend exists)
  if (lastAdx.adx > 25) {
    score += 15;
    reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (strong trend)`);
  } else if (lastAdx.adx > 20) {
    score += 10;
    reasons.push(`ADX ${lastAdx.adx.toFixed(0)} (trend developing)`);
  }

  // Volume rising (last 10 bars avg > last 50 bars avg)
  const last10Vol = candles.slice(-10).reduce((s, c) => s + c.volume, 0) / 10;
  const last50Vol = candles.slice(-50).reduce((s, c) => s + c.volume, 0) / 50;
  if (last50Vol > 0 && last10Vol > last50Vol * 1.1) {
    score += 10;
    reasons.push("Volume rising (accumulation in progress)");
  }

  // RSI not overbought (room to accumulate)
  const rsiArr = cache ? cache.getRsi(symbol, timeframe, candles) : rsi(closes, 14);
  const lastRsi = rsiArr[last];
  if (lastRsi != null && lastRsi < 70) {
    score += 10;
    reasons.push(`RSI ${lastRsi.toFixed(0)} (not overbought — accumulation zone)`);
  } else if (lastRsi != null) {
    score -= 5;
    reasons.push(`RSI ${lastRsi.toFixed(0)} (overbought — wait for pullback)`);
  }

  score = Math.min(100, Math.max(0, score));
  if (score < 50) return Promise.resolve(null);

  // Buy & hold: wide stop below 200 EMA (5% buffer), no fixed target
  // (target = entry + 10R as a placeholder — this is a "hold" signal)
  const entry = lastClose;
  const stop = e200 * 0.95; // 5% below 200 EMA
  const risk = Math.abs(entry - stop);
  const target = entry + 10 * risk; // 10R target (long-term hold)

  return Promise.resolve({
    strategyKey: `trend-buy-hold-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Buy & Hold · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction: "long",
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      ema50: e50, ema200: e200, adx: lastAdx.adx, rsi: lastRsi,
      momentum50: momentum, volTrend: last10Vol / (last50Vol || 1),
      type: "accumulation", // signals to the UI this is a long-term hold
    },
  });
};

// ─── Trendline Break ────────────────────────────────────────────────────────
// Uses swing points to draw a trendline between the last 2-3 swing highs
// (for descending TL) or swing lows (for ascending TL). Signals when price
// breaks through the trendline. Entry on break, stop at the TL, target at 2R.
export const trendlineBreakScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return Promise.resolve(null);

  // Find swing points (lookback=2 for sensitivity)
  const swings = findSwingPoints(candles, 2);
  if (swings.length < 4) return Promise.resolve(null); // need at least 2 highs + 2 lows

  const lastClose = candles[candles.length - 1].close;
  const lastIdx = candles.length - 1;

  // Get the last 2-3 swing highs and lows
  const swingHighs = swings.filter((s) => s.type === "high").slice(-3);
  const swingLows = swings.filter((s) => s.type === "low").slice(-3);

  const reasons: string[] = [];
  let score = 0;
  let direction: "long" | "short" | "neutral" = "neutral";
  let trendlinePrice = 0;

  // Check for descending trendline (lower highs) → long on break above
  if (swingHighs.length >= 2) {
    const h1 = swingHighs[swingHighs.length - 2];
    const h2 = swingHighs[swingHighs.length - 1];
    // Descending: h2.price < h1.price
    if (h2.price < h1.price) {
      // Extrapolate the trendline to the current bar
      const barsBetween = lastIdx - h1.index;
      const slope = (h2.price - h1.price) / (h2.index - h1.index);
      trendlinePrice = h1.price + slope * barsBetween;

      // Price broke above the trendline this bar?
      if (lastClose > trendlinePrice && candles[candles.length - 2].close <= trendlinePrice) {
        direction = "long";
        score += 40;
        reasons.push("Broke above descending trendline (bearish trend broken)");
        reasons.push(`Trendline at ${trendlinePrice.toFixed(5)}, close ${lastClose.toFixed(5)}`);

        // Confirm with volume
        const vol = candles[lastIdx].volume;
        const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
        if (vol > avgVol * 1.3 && vol > 0) {
          score += 20;
          reasons.push("Volume spike on breakout (+30% above average)");
        }

        // Check if there's a prior swing low for stop placement
        if (swingLows.length >= 1) {
          const lastLow = swingLows[swingLows.length - 1];
          if (lastLow.price < lastClose) {
            score += 10;
            reasons.push("Prior swing low below for stop placement");
          }
        }
      }
    }
  }

  // Check for ascending trendline (higher lows) → short on break below
  if (direction === "neutral" && swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2];
    const l2 = swingLows[swingLows.length - 1];
    // Ascending: l2.price > l1.price
    if (l2.price > l1.price) {
      const barsBetween = lastIdx - l1.index;
      const slope = (l2.price - l1.price) / (l2.index - l1.index);
      trendlinePrice = l1.price + slope * barsBetween;

      // Price broke below the trendline this bar?
      if (lastClose < trendlinePrice && candles[candles.length - 2].close >= trendlinePrice) {
        direction = "short";
        score += 40;
        reasons.push("Broke below ascending trendline (bullish trend broken)");
        reasons.push(`Trendline at ${trendlinePrice.toFixed(5)}, close ${lastClose.toFixed(5)}`);

        const vol = candles[lastIdx].volume;
        const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
        if (vol > avgVol * 1.3 && vol > 0) {
          score += 20;
          reasons.push("Volume spike on breakdown (+30% above average)");
        }

        if (swingHighs.length >= 1) {
          const lastHigh = swingHighs[swingHighs.length - 1];
          if (lastHigh.price > lastClose) {
            score += 10;
            reasons.push("Prior swing high above for stop placement");
          }
        }
      }
    }
  }

  score = Math.min(100, Math.max(0, score));
  if (score < 50 || direction === "neutral") return Promise.resolve(null);

  const entry = lastClose;
  // Stop at the trendline (if it breaks back, the trade is invalid)
  const stop = trendlinePrice;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return Promise.resolve(null);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;

  return Promise.resolve({
    strategyKey: `trend-trendline-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `Trendline Break · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      trendlinePrice,
      swingHighs: swingHighs.map((s) => s.price),
      swingLows: swingLows.map((s) => s.price),
    },
  });
};

export const TREND_SCANNERS: Record<string, ScannerFn> = {
  "trend-ema": emaStackScanner,
  "trend-supertrend-psar": supertrendPsarScanner,
  "trend-macd-adx": macdAdxScanner,
  "trend-ichimoku": ichimokuScanner,
  "trend-heikin-ashi": heikinAshiScanner,
  "trend-donchian": donchianBreakoutScanner,
  "trend-following": trendFollowingScanner,
  "trend-buy-hold": buyHoldScanner,
  "trend-trendline": trendlineBreakScanner,
};

export async function runTrendScan(
  ctx: StrategyContext,
  strategies: string[] = Object.keys(TREND_SCANNERS)
): Promise<ScanSignal[]> {
  const results: ScanSignal[] = [];
  for (const key of strategies) {
    const fn = TREND_SCANNERS[key];
    if (!fn) continue;
    const signal = await fn(ctx);
    if (signal) results.push(signal);
  }
  return results;
}
