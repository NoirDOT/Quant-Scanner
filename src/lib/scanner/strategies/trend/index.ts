// src/lib/scanner/strategies/trend/index.ts
// Trend continuation strategies — 6 indicator families × 5 timeframes

import type { StrategyContext, ScanSignal, ScannerFn, StrategyInfo } from "../../types";
import {
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

export const TREND_STRATEGIES: StrategyInfo[] = [
  { key: "trend-ema", type: "trend", label: "EMA Stack (8/21/50/200)", description: "Bullish/bearish stacked EMAs with price above/below all", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-supertrend-psar", type: "trend", label: "Supertrend + PSAR", description: "Supertrend flip confirmed by PSAR alignment", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-macd-adx", type: "trend", label: "MACD + ADX", description: "MACD histogram expansion + ADX>25 trend strength", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-ichimoku", type: "trend", label: "Ichimoku Cloud", description: "Tenkan/Kijun cross + price on correct side of cloud", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-heikin-ashi", type: "trend", label: "Heikin-Ashi Trend", description: "3 consecutive HA candles with no opposite wick", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "trend-donchian", type: "trend", label: "Donchian Breakout", description: "20-period Donchian channel breakout with confirmation", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
];

// === EMA Stack ===
export const emaStackScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 200) return Promise.resolve(null);
  const closes = candles.map((c) => c.close);
  const states = stackedEma(closes);
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
  const st = supertrend(highs, lows, closes, 10, 3);
  const ps = psar(highs, lows, closes);
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
  const macdStates = macd(closes);
  const adxStates = adx(highs, lows, closes);
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
  const rsiVals = rsi(closes, 14);
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
  const states = ichimoku(highs, lows, closes);
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
  const ha = heikinAshi(opens, highs, lows, closes);
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
  const states = donchianFromCloses(highs, lows, closes, 20);
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

export const TREND_SCANNERS: Record<string, ScannerFn> = {
  "trend-ema": emaStackScanner,
  "trend-supertrend-psar": supertrendPsarScanner,
  "trend-macd-adx": macdAdxScanner,
  "trend-ichimoku": ichimokuScanner,
  "trend-heikin-ashi": heikinAshiScanner,
  "trend-donchian": donchianBreakoutScanner,
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
