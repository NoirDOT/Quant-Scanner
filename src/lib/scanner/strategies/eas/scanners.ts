// src/lib/scanner/strategies/eas/scanners.ts
// Implements scanner functions for 10 of the most validated EAs from the user's catalog.
// Each scanner mirrors the EA's MQL5 logic and returns a ScanSignal with the EA's claimed
// backtest stats so the user can compare scanner vs EA results.

import type { ScanSignal, StrategyContext, ScannerFn, StrategyInfo } from "../../types";
import {
  ema, sma,
  macd, adx, rsi, atr,
  supertrend, psar,
  ichimoku,
  heikinAshi,
  donchianFromCloses,
} from "../../indicators";
import { detectFVGs, detectLiquiditySweeps, premiumDiscount, detectStructure } from "../../ict";

export const EA_SCANNERS_INFO: StrategyInfo[] = [
  {
    key: "ea-fvg-retracement",
    type: "trend",  // reusing the union type for compatibility
    label: "FVG Retracement (EA)",
    description: "3-candle FVG + 50% retrace, gap >= 0.3×ATR. Validated 2y AUDUSD H1: Sharpe 0.53, PF 1.22, +$13,998.",
    timeframes: ["1h", "4h", "1d"],
  },
  {
    key: "ea-adxbb",
    type: "trend",
    label: "ADX-Filtered BB (EA)",
    description: "Fade BB(20,2) edges when ADX<25 (range regime). Validated 2y AUDUSD H4: Sharpe 1.35, PF 4.68, Win 83.3%.",
    timeframes: ["1h", "4h", "1d"],
  },
  {
    key: "ea-donchian-scalper",
    type: "trend",
    label: "Donchian Scalper (EA)",
    description: "Donchian(20) breakout with TIGHT regime filter, scalper TP=0.8×ATR. Validated USDJPY H4: Sharpe 1.02, PF 2.77, Win 92.3%.",
    timeframes: ["1h", "2h", "4h"],
  },
  {
    key: "ea-ichimoku-triple",
    type: "trend",
    label: "Ichimoku Triple Confirm (EA)",
    description: "Tenkan/Kijun cross + price on correct side of cloud + cloud color aligned. Validated 16.5y USDJPY M15: Sharpe 7.76.",
    timeframes: ["1h", "2h", "4h"],
  },
  {
    key: "ea-btc-mom-adx",
    type: "trend",
    label: "BTC Momentum + ADX (EA)",
    description: "LONG-only when ROC(20)>0 AND ADX(14)>25. Passes Kieran Duff funnel + prop firm on BTCUSD D1.",
    timeframes: ["1d"],
  },
  {
    key: "ea-ma-envelope",
    type: "trend",
    label: "MA Envelope Reversal (EA)",
    description: "EMA(20) ± 3% envelope, fade extremes. Passes prop firm on EURUSD, GBPUSD, AUDUSD, CA60, EURCHF.",
    timeframes: ["1h", "4h"],
  },
  {
    key: "ea-nr7-breakout",
    type: "trend",
    label: "NR7 Contraction → Expansion (EA)",
    description: "Narrowest range of last 7 bars → breakout direction. BTCUSD D1.",
    timeframes: ["1d"],
  },
  {
    key: "ea-williams-cci",
    type: "trend",
    label: "Williams %R + CCI (EA)",
    description: "Dual-oscillator oversold/overbought: Williams %R <-80 + CCI <-100. EURUSD H1.",
    timeframes: ["1h", "4h"],
  },
  {
    key: "ea-pivot-inverted",
    type: "trend",
    label: "INVERTED Daily Pivot (EA)",
    description: "INVERTED pivot — enter WITH momentum through R1/S1 instead of fading. 10y GBPUSD D1: Sharpe 0.60, PF 1.55, +$51,656.",
    timeframes: ["1d"],
  },
  {
    key: "ea-rsi-cross",
    type: "trend",
    label: "RSI Crossover (EA)",
    description: "Long when RSI crosses above 50, short when below. Passes Kieran Duff funnel on BTCUSD.",
    timeframes: ["1h", "4h", "1d"],
  },
  {
    key: "ea-bb-rsi-combo",
    type: "trend",
    label: "BB + RSI Combo (EA)",
    description: "Dual-filter mean reversion: price < lower BB AND RSI < 30. GBPUSD/AUDUSD/NZDUSD H4.",
    timeframes: ["1h", "4h"],
  },
  {
    key: "ea-ema-cloud-touch",
    type: "trend",
    label: "EMA(200) Cloud Limit-Touch (EA)",
    description: "Price wicks below EMA(200) and closes back above. BTCUSD M15: Sharpe 0.74, PF 1.63, Win 60%.",
    timeframes: ["1h", "4h", "1d"],
  },
];

// Compute Bollinger Bands (default 20, 2σ)
function bollingerBands(closes: number[], period = 20, mult = 2): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[]; bandwidthPct: (number | null)[] } {
  const middle = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const bandwidthPct: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (middle[i] === null || i < period - 1) {
      upper.push(null);
      lower.push(null);
      bandwidthPct.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += Math.pow(closes[j] - (middle[i] as number), 2);
    }
    const std = Math.sqrt(sum / period);
    upper.push((middle[i] as number) + mult * std);
    lower.push((middle[i] as number) - mult * std);
    bandwidthPct.push(std / (middle[i] as number));
  }
  return { upper, middle, lower, bandwidthPct };
}

// Compute Williams %R (default 14)
function williamsR(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, highs[j]);
      lo = Math.min(lo, lows[j]);
    }
    const wr = ((hi - closes[i]) / (hi - lo || 1)) * -100; // -100..0
    out.push(wr);
  }
  return out;
}

// Compute CCI (default 20)
function cci(highs: number[], lows: number[], closes: number[], period = 20): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let tpSum = 0;
    const tpArr: number[] = [];
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (highs[j] + lows[j] + closes[j]) / 3;
      tpArr.push(tp);
      tpSum += tp;
    }
    const meanTP = tpSum / period;
    let meanDev = 0;
    for (const tp of tpArr) meanDev += Math.abs(tp - meanTP);
    meanDev /= period;
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    out.push((tp - meanTP) / (0.015 * meanDev || 0.0001));
  }
  return out;
}

// Compute ROC (default 20)
function roc(closes: number[], period = 20): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    out.push(((closes[i] - closes[i - period]) / closes[i - period]) * 100);
  }
  return out;
}

// Compute Stochastic (default 14, 3, 3)
function stochastic(highs: number[], lows: number[], closes: number[], period = 14, smooth = 3): { k: (number | null)[]; d: (number | null)[] } {
  const k: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      k.push(null);
      continue;
    }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, highs[j]);
      lo = Math.min(lo, lows[j]);
    }
    k.push(((closes[i] - lo) / (hi - lo || 1)) * 100);
  }
  const d = sma(k.filter((v) => v !== null) as number[], smooth);
  const dOut: (number | null)[] = [];
  let dIdx = 0;
  for (let i = 0; i < k.length; i++) {
    if (k[i] === null) {
      dOut.push(null);
    } else {
      dOut.push(d[dIdx] ?? null);
      dIdx++;
    }
  }
  return { k, d: dOut };
}

// Compute daily pivots (classical) — needs H1/L1/C1 of previous day
function dailyPivots(candles: import("../../data").Candle[]): { pp: number; r1: number; r2: number; s1: number; s2: number } | null {
  if (candles.length < 24) return null;
  // Find yesterday's candles by UTC date
  const today = candles[candles.length - 1].date;
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yKey = `${yesterday.getUTCFullYear()}-${yesterday.getUTCMonth()}-${yesterday.getUTCDate()}`;
  const yCandles = candles.filter((c) => {
    const d = c.date;
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === yKey;
  });
  if (yCandles.length === 0) {
    // fallback: use last 24 candles
    const recent = candles.slice(-24);
    const h = Math.max(...recent.map((c) => c.high));
    const l = Math.min(...recent.map((c) => c.low));
    const c = recent[recent.length - 1].close;
    const pp = (h + l + c) / 3;
    return {
      pp,
      r1: 2 * pp - l,
      r2: pp + (h - l),
      s1: 2 * pp - h,
      s2: pp - (h - l),
    };
  }
  const h = Math.max(...yCandles.map((c) => c.high));
  const l = Math.min(...yCandles.map((c) => c.low));
  const c = yCandles[yCandles.length - 1].close;
  const pp = (h + l + c) / 3;
  return {
    pp,
    r1: 2 * pp - l,
    r2: pp + (h - l),
    s1: 2 * pp - h,
    s2: pp - (h - l),
  };
}

// === FVG Retracement (EA) ===
export const fvgRetracementScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const fvgs = detectFVGs(candles);
  if (fvgs.length === 0) return null;
  // Find recent unmitigated FVG with min 0.3 × ATR(14) gap size
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const atrArr = atr(highs, lows, closes, 14);
  const lastATR = atrArr[atrArr.length - 1];
  if (lastATR === null) return null;
  const minGap = lastATR * 0.3;
  const lastIdx = candles.length - 1;
  const lastClose = closes[lastIdx];
  const recentFvg = fvgs
    .filter((f) => !f.mitigated && f.endIndex >= lastIdx - 20 && f.size >= minGap)
    .slice(-1)[0];
  if (!recentFvg) return null;
  // Check 50% retrace: price has touched the midpoint of the FVG within last 20 bars
  const mid = (recentFvg.top + recentFvg.bottom) / 2;
  const recentCandles = candles.slice(Math.max(recentFvg.endIndex, lastIdx - 20), lastIdx + 1);
  const hasRetrace = recentCandles.some((c) => {
    if (recentFvg.direction === "bullish") return c.low <= mid;
    return c.high >= mid;
  });
  if (!hasRetrace) return null;
  const direction: "long" | "short" = recentFvg.direction === "bullish" ? "long" : "short";
  const reasons: string[] = [
    `${recentFvg.direction.toUpperCase()} FVG detected at bar ${recentFvg.startIndex + 1} (size ${(recentFvg.size / lastATR).toFixed(2)}×ATR)`,
    "Price has retraced 50% into the gap within 20 bars",
    "EA backtest (2y AUDUSD H1): Sharpe 0.53, PF 1.22, Win 48.2%, +$13,998",
  ];
  const entry = lastClose;
  const stop = recentFvg.direction === "bullish" ? recentFvg.bottom : recentFvg.top;
  const risk = Math.abs(entry - stop);
  const target = recentFvg.direction === "bullish" ? entry + 3 * risk : entry - 3 * risk;
  return {
    strategyKey: `ea-fvg-retracement-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: FVG Retracement · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score: 75,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_FVG_Retracement_AUDUSD_H1", fvg: recentFvg, atr: lastATR },
  };
};

// === ADX-Filtered BB (EA) ===
export const adxbbScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const bb = bollingerBands(closes, 20, 2);
  const adxArr = adx(highs, lows, closes, 14);
  const atrArr = atr(highs, lows, closes, 14);
  const lastATR = atrArr[atrArr.length - 1];
  const lastAdx = adxArr[adxArr.length - 1];
  const lastLower = bb.lower[bb.lower.length - 1];
  const lastUpper = bb.upper[bb.upper.length - 1];
  const lastBBWP = bb.bandwidthPct[bb.bandwidthPct.length - 1];
  if (lastATR === null || lastAdx === null || lastLower === null || lastUpper === null) return null;
  const lastIdx = candles.length - 1;
  const lastLow = lows[lastIdx];
  const lastHigh = highs[lastIdx];
  const lastClose = closes[lastIdx];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  // LONG: low touches/breaks lower BB AND ADX<25 AND BBWP<70
  if (lastLow <= lastLower && lastAdx.adx < 25 && (lastBBWP ?? 0) < 0.07) {
    direction = "long";
    score = 70;
    reasons.push(`Price touched lower BB (${lastLower.toFixed(5)})`);
    reasons.push(`ADX = ${lastAdx.adx.toFixed(1)} (range regime — confirms fade)`);
    reasons.push("BBWP < 0.07 (volatility not extreme)");
    reasons.push("EA backtest (2y AUDUSD H4): Sharpe 1.35, PF 4.68, Win 83.3%, MaxDD 2.85%");
  } else if (lastHigh >= lastUpper && lastAdx.adx < 25 && (lastBBWP ?? 0) < 0.07) {
    direction = "short";
    score = 70;
    reasons.push(`Price touched upper BB (${lastUpper.toFixed(5)})`);
    reasons.push(`ADX = ${lastAdx.adx.toFixed(1)} (range regime — confirms fade)`);
    reasons.push("BBWP < 0.07 (volatility not extreme)");
    reasons.push("EA backtest (2y AUDUSD H4): Sharpe 1.35, PF 4.68, Win 83.3%, MaxDD 2.85%");
  }
  if (direction === "neutral") return null;
  const entry = lastClose;
  const stop = direction === "long" ? entry - 2 * lastATR : entry + 2 * lastATR;
  const target = direction === "long" ? entry + 2 * lastATR : entry - 2 * lastATR;
  return {
    strategyKey: `ea-adxbb-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: ADX-BB · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_AdxBB_AUDUSD_H4", adx: lastAdx.adx, bbLower: lastLower, bbUpper: lastUpper, bbwp: lastBBWP },
  };
};

// === Donchian Scalper (EA) ===
export const donchianScalperScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const dch = donchianFromCloses(highs, lows, closes, 20);
  const adxArr = adx(highs, lows, closes, 14);
  const atrArr = atr(highs, lows, closes, 14);
  const lastDch = dch[dch.length - 1];
  const lastAdx = adxArr[adxArr.length - 1];
  const lastATR = atrArr[atrArr.length - 1];
  if (!lastDch || !lastAdx || !lastATR) return null;
  const lastClose = closes[closes.length - 1];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (lastDch.brokeUp && lastAdx.adx < 30) {
    direction = "long";
    score = 75;
    reasons.push(`Close broke above Donchian(20) upper (${lastDch.upper.toFixed(5)})`);
    reasons.push(`ADX = ${lastAdx.adx.toFixed(1)} < 30 (avoid trend exhaustion)`);
    reasons.push("EA backtest (2y USDJPY H4): Sharpe 1.02, PF 2.77, Win 92.3%, MaxDD 2.30%");
  } else if (lastDch.brokeDown && lastAdx.adx < 30) {
    direction = "short";
    score = 75;
    reasons.push(`Close broke below Donchian(20) lower (${lastDch.lower.toFixed(5)})`);
    reasons.push(`ADX = ${lastAdx.adx.toFixed(1)} < 30 (avoid trend exhaustion)`);
    reasons.push("EA backtest (2y USDJPY H4): Sharpe 1.02, PF 2.77, Win 92.3%, MaxDD 2.30%");
  }
  if (direction === "neutral") return null;
  const entry = lastClose;
  const stop = direction === "long" ? entry - 3 * lastATR : entry + 3 * lastATR;
  const target = direction === "long" ? entry + 0.8 * lastATR : entry - 0.8 * lastATR;
  return {
    strategyKey: `ea-donchian-scalper-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: Donchian Scalper · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_Donchian_USDJPY_H4", adx: lastAdx.adx, atr: lastATR, donchian: { upper: lastDch.upper, lower: lastDch.lower } },
  };
};

// === Ichimoku Triple Confirm (EA) ===
export const ichimokuTripleScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 100) return null;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const states = ichimoku(highs, lows, closes);
  const last = states[states.length - 1];
  if (!last) return null;
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (last.bullishCross && last.priceAboveCloud && last.cloudBullish) {
    direction = "long";
    score = 85;
    reasons.push("Tenkan crossed above Kijun (Triple Confirm component 1)");
    reasons.push("Price above Senkou A and B (above cloud)");
    reasons.push("Cloud bullish (Senkou A > Senkou B)");
    reasons.push("EA backtest (16.5y USDJPY M15): Sharpe 7.76, 413,690 bars");
  } else if (last.bearishCross && last.priceBelowCloud && last.cloudBearish) {
    direction = "short";
    score = 85;
    reasons.push("Tenkan crossed below Kijun (Triple Confirm component 1)");
    reasons.push("Price below Senkou A and B (below cloud)");
    reasons.push("Cloud bearish (Senkou B > Senkou A)");
    reasons.push("EA backtest (16.5y USDJPY M15): Sharpe 7.76, 413,690 bars");
  }
  if (direction === "neutral") return null;
  const lastClose = closes[closes.length - 1];
  const entry = lastClose;
  const stop = direction === "long" ? Math.min(last.senkouA, last.senkouB) : Math.max(last.senkouA, last.senkouB);
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 3 * risk : entry - 3 * risk;
  return {
    strategyKey: `ea-ichimoku-triple-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: Ichimoku Triple · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_Ichimoku_USDJPY_M15", tenkan: last.tenkan, kijun: last.kijun, senkouA: last.senkouA, senkouB: last.senkouB },
  };
};

// === BTC Momentum + ADX (EA) — long-only ===
export const btcMomAdxScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rocArr = roc(closes, 20);
  const adxArr = adx(highs, lows, closes, 14);
  const atrArr = atr(highs, lows, closes, 14);
  const lastROC = rocArr[rocArr.length - 1];
  const lastAdx = adxArr[adxArr.length - 1];
  const lastATR = atrArr[atrArr.length - 1];
  if (lastROC === null || !lastAdx || !lastATR) return null;
  // LONG-only
  if (lastROC > 0 && lastAdx.adx > 25) {
    const lastClose = closes[closes.length - 1];
    const entry = lastClose;
    const stop = entry - 2 * lastATR;
    const target = entry + 3 * lastATR;
    return {
      strategyKey: `ea-btc-mom-adx-${timeframe}`,
      strategyType: "trend",
      strategyLabel: `EA: BTC Mom+ADX · ${timeframe.toUpperCase()}`,
      symbol, display, assetClass, timeframe,
      direction: "long",
      score: 80,
      reasons: [
        `ROC(20) = ${lastROC.toFixed(2)}% (positive momentum)`,
        `ADX(14) = ${lastAdx.adx.toFixed(1)} > 25 (trend strength)`,
        `LONG-only (no short entries)`,
        `Passes Kieran Duff funnel + prop firm on BTCUSD D1`,
      ],
      entryPrice: entry,
      stopPrice: stop,
      targetPrice: target,
      metadata: { eaId: "ZAI_BTC_MOM_ADX", roc: lastROC, adx: lastAdx.adx, atr: lastATR },
    };
  }
  return null;
};

// === MA Envelope Reversal (EA) ===
export const maEnvelopeScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const atrArr = atr(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  const lastEMA = ema20[ema20.length - 1];
  const lastATR = atrArr[atrArr.length - 1];
  if (lastEMA === null || lastATR === null) return null;
  const lastClose = closes[closes.length - 1];
  const lower = lastEMA * 0.97; // -3% envelope
  const upper = lastEMA * 1.03; // +3% envelope
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (lastClose < lower) {
    direction = "long";
    score = 70;
    reasons.push(`Close ${lastClose.toFixed(5)} below lower EMA20 envelope (97% = ${lower.toFixed(5)})`);
    reasons.push("Mean-reversion target: EMA(20)");
    reasons.push("EA: Passes prop firm on EURUSD, GBPUSD, AUDUSD, CA60, EURCHF");
  } else if (lastClose > upper) {
    direction = "short";
    score = 70;
    reasons.push(`Close ${lastClose.toFixed(5)} above upper EMA20 envelope (103% = ${upper.toFixed(5)})`);
    reasons.push("Mean-reversion target: EMA(20)");
    reasons.push("EA: Passes prop firm on EURUSD, GBPUSD, AUDUSD, CA60, EURCHF");
  }
  if (direction === "neutral") return null;
  const entry = lastClose;
  const risk = Math.abs(entry - lastEMA);
  const stop = direction === "long" ? entry - risk * 0.5 : entry + risk * 0.5;
  const target = lastEMA; // mean reversion target
  return {
    strategyKey: `ea-ma-envelope-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: MA Envelope · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_MA_Envelope", ema20: lastEMA, lowerEnvelope: lower, upperEnvelope: upper },
  };
};

// === NR7 Contraction → Expansion (EA) ===
export const nr7BreakoutScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return null;
  const ranges = candles.map((c) => c.high - c.low);
  const lastIdx = candles.length - 1;
  // Check NR7: today's range is narrowest of last 7
  const last7 = ranges.slice(lastIdx - 6, lastIdx + 1);
  if (last7.length < 7) return null;
  const todayRange = last7[6];
  const prior6 = last7.slice(0, 6);
  if (Math.min(...prior6) <= todayRange) return null; // not NR7
  const nr7High = candles[lastIdx].high;
  const nr7Low = candles[lastIdx].low;
  // Need a breakout on the next bar (we check most recent bar)
  // For scanner mode: check if last bar closed above nr7High or below nr7Low
  // Actually NR7 detection bar IS the narrow bar; breakout happens on subsequent bars
  // Simplification: check if any of last 3 bars closed beyond NR7 levels
  const recent = candles.slice(Math.max(0, lastIdx - 3), lastIdx + 1);
  const breakoutUp = recent.some((c) => c.close > nr7High);
  const breakoutDown = recent.some((c) => c.close < nr7Low);
  if (!breakoutUp && !breakoutDown) return null;
  const direction: "long" | "short" = breakoutUp ? "long" : "short";
  const lastClose = candles[lastIdx].close;
  const entry = lastClose;
  const stop = breakoutUp ? nr7Low : nr7High;
  const risk = Math.abs(entry - stop);
  const target = breakoutUp ? entry + 2 * risk : entry - 2 * risk;
  return {
    strategyKey: `ea-nr7-breakout-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: NR7 Breakout · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score: 75,
    reasons: [
      `NR7 detected: today's range is narrowest of last 7 bars (${todayRange.toFixed(5)})`,
      `Breakout ${direction === "long" ? "above" : "below"} NR7 ${direction === "long" ? "high" : "low"} in last 3 bars`,
      `SL = opposite NR7 edge, TP = 2R`,
    ],
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_NR_Contraction_Expansion", nr7High, nr7Low, nr7Range: todayRange },
  };
};

// === Williams %R + CCI (EA) ===
export const williamsCciScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const wr = williamsR(highs, lows, closes, 14);
  const cciArr = cci(highs, lows, closes, 20);
  const atrArr = atr(highs, lows, closes, 14);
  const lastWR = wr[wr.length - 1];
  const lastCCI = cciArr[cciArr.length - 1];
  const lastATR = atrArr[atrArr.length - 1];
  if (lastWR === null || lastCCI === null || lastATR === null) return null;
  const lastClose = closes[closes.length - 1];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (lastWR < -80 && lastCCI < -100) {
    direction = "long";
    score = 75;
    reasons.push(`Williams %R = ${lastWR.toFixed(1)} (oversold <-80)`);
    reasons.push(`CCI = ${lastCCI.toFixed(0)} (oversold confirmation <-100)`);
    reasons.push("EA: SL 1.5×ATR, TP 3×ATR (RR 2:1)");
  } else if (lastWR > -20 && lastCCI > 100) {
    direction = "short";
    score = 75;
    reasons.push(`Williams %R = ${lastWR.toFixed(1)} (overbought >-20)`);
    reasons.push(`CCI = ${lastCCI.toFixed(0)} (overbought confirmation >100)`);
    reasons.push("EA: SL 1.5×ATR, TP 3×ATR (RR 2:1)");
  }
  if (direction === "neutral") return null;
  const entry = lastClose;
  const stop = direction === "long" ? entry - 1.5 * lastATR : entry + 1.5 * lastATR;
  const target = direction === "long" ? entry + 3 * lastATR : entry - 3 * lastATR;
  return {
    strategyKey: `ea-williams-cci-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: Williams%R+CCI · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_WilliamsCCI_EURUSD_H1", williamsR: lastWR, cci: lastCCI, atr: lastATR },
  };
};

// === INVERTED Daily Pivot (EA) ===
export const pivotInvertedScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const pivots = dailyPivots(candles);
  if (!pivots) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const atrArr = atr(highs, lows, closes, 20);
  const lastATR = atrArr[atrArr.length - 1];
  if (lastATR === null) return null;
  const lastClose = closes[closes.length - 1];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  // INVERTED: long when close breaks above R1
  if (lastClose > pivots.r1) {
    direction = "long";
    score = 70;
    reasons.push(`Close ${lastClose.toFixed(5)} broke above R1 (${pivots.r1.toFixed(5)}) — INVERTED pivot entry`);
    reasons.push("10y GBPUSD D1 EA: Sharpe 0.60, PF 1.55, +$51,656");
  } else if (lastClose < pivots.s1) {
    direction = "short";
    score = 70;
    reasons.push(`Close ${lastClose.toFixed(5)} broke below S1 (${pivots.s1.toFixed(5)}) — INVERTED pivot entry`);
    reasons.push("10y GBPUSD D1 EA: Sharpe 0.60, PF 1.55, +$51,656");
  }
  if (direction === "neutral") return null;
  const entry = lastClose;
  const stop = direction === "long" ? entry - lastATR : entry + lastATR;
  const target = direction === "long" ? entry + 2 * lastATR : entry - 2 * lastATR;
  return {
    strategyKey: `ea-pivot-inverted-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: Pivot Inverted · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_Pivot_GBPUSD_D1_INVERTED", pivots, atr: lastATR },
  };
};

// === RSI Crossover (EA) ===
export const rsiCrossScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return null;
  const closes = candles.map((c) => c.close);
  const atrArr = atr(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  const rsiArr = rsi(closes, 14);
  const lastATR = atrArr[atrArr.length - 1];
  const lastRSI = rsiArr[rsiArr.length - 1];
  const prevRSI = rsiArr[rsiArr.length - 2];
  if (lastATR === null || lastRSI === null || prevRSI === null) return null;
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (prevRSI < 50 && lastRSI > 50) {
    direction = "long";
    score = 70;
    reasons.push(`RSI crossed above 50 (from ${prevRSI.toFixed(1)} to ${lastRSI.toFixed(1)})`);
    reasons.push("EA: Passes Kieran Duff funnel + prop firm on BTCUSD");
  } else if (prevRSI > 50 && lastRSI < 50) {
    direction = "short";
    score = 70;
    reasons.push(`RSI crossed below 50 (from ${prevRSI.toFixed(1)} to ${lastRSI.toFixed(1)})`);
    reasons.push("EA: Passes Kieran Duff funnel + prop firm on BTCUSD");
  }
  if (direction === "neutral") return null;
  const lastClose = closes[closes.length - 1];
  const entry = lastClose;
  const stop = direction === "long" ? entry - 2 * lastATR : entry + 2 * lastATR;
  const target = direction === "long" ? entry + 4 * lastATR : entry - 4 * lastATR;
  return {
    strategyKey: `ea-rsi-cross-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: RSI Cross · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_RSI_Cross", rsi: lastRSI, prevRSI, atr: lastATR },
  };
};

// === BB + RSI Combo (EA) ===
export const bbRsiComboScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const closes = candles.map((c) => c.close);
  const bb = bollingerBands(closes, 20, 2);
  const rsiArr = rsi(closes, 14);
  const atrArr = atr(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  const lastLower = bb.lower[bb.lower.length - 1];
  const lastUpper = bb.upper[bb.upper.length - 1];
  const lastMiddle = bb.middle[bb.middle.length - 1];
  const lastRSI = rsiArr[rsiArr.length - 1];
  const lastATR = atrArr[atrArr.length - 1];
  if (lastLower === null || lastUpper === null || lastMiddle === null || lastRSI === null || lastATR === null) return null;
  const lastClose = closes[closes.length - 1];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (lastClose < lastLower && lastRSI < 30) {
    direction = "long";
    score = 75;
    reasons.push(`Close below lower BB (${lastLower.toFixed(5)})`);
    reasons.push(`RSI(14) = ${lastRSI.toFixed(1)} < 30 (dual oversold)`);
    reasons.push("Target: middle BB (SMA 20)");
  } else if (lastClose > lastUpper && lastRSI > 70) {
    direction = "short";
    score = 75;
    reasons.push(`Close above upper BB (${lastUpper.toFixed(5)})`);
    reasons.push(`RSI(14) = ${lastRSI.toFixed(1)} > 70 (dual overbought)`);
    reasons.push("Target: middle BB (SMA 20)");
  }
  if (direction === "neutral") return null;
  const entry = lastClose;
  const stop = direction === "long" ? entry - 2 * lastATR : entry + 2 * lastATR;
  const target = lastMiddle;
  return {
    strategyKey: `ea-bb-rsi-combo-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: BB+RSI Combo · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_BB_RSI_Combo", bbLower: lastLower, bbUpper: lastUpper, bbMiddle: lastMiddle, rsi: lastRSI, atr: lastATR },
  };
};

// === EMA(200) Cloud Limit-Touch (EA) ===
export const emaCloudTouchScanner: ScannerFn = (ctx: StrategyContext): ScanSignal | null => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 250) return null;
  const closes = candles.map((c) => c.close);
  const ema200 = ema(closes, 200);
  const lastEMA = ema200[ema200.length - 1];
  if (lastEMA === null) return null;
  const lastIdx = candles.length - 1;
  const last = candles[lastIdx];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  const reasons: string[] = [];
  if (last.low < lastEMA && last.close > lastEMA) {
    direction = "long";
    score = 75;
    reasons.push(`Price wicked below EMA(200) (${lastEMA.toFixed(5)}) and closed back above`);
    reasons.push("EA backtest (60d BTCUSD M15): Sharpe 0.74, PF 1.63, Win 60.0%, +$5,939");
  } else if (last.high > lastEMA && last.close < lastEMA) {
    direction = "short";
    score = 75;
    reasons.push(`Price wicked above EMA(200) (${lastEMA.toFixed(5)}) and closed back below`);
    reasons.push("EA backtest (60d BTCUSD M15): Sharpe 0.74, PF 1.63, Win 60.0%, +$5,939");
  }
  if (direction === "neutral") return null;
  const atrArr = atr(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  const lastATR = atrArr[atrArr.length - 1];
  if (lastATR === null) return null;
  const entry = last.close;
  const stop = direction === "long" ? entry - 1.5 * lastATR : entry + 1.5 * lastATR;
  const target = direction === "long" ? entry + 4.5 * lastATR : entry - 4.5 * lastATR;
  return {
    strategyKey: `ea-ema-cloud-touch-${timeframe}`,
    strategyType: "trend",
    strategyLabel: `EA: EMA200 Cloud Touch · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: { eaId: "ZAI_EmaCloud_BTCUSD_M15", ema200: lastEMA, atr: lastATR },
  };
};

// Registry
export const EA_SCANNERS: Record<string, ScannerFn> = {
  "ea-fvg-retracement": fvgRetracementScanner,
  "ea-adxbb": adxbbScanner,
  "ea-donchian-scalper": donchianScalperScanner,
  "ea-ichimoku-triple": ichimokuTripleScanner,
  "ea-btc-mom-adx": btcMomAdxScanner,
  "ea-ma-envelope": maEnvelopeScanner,
  "ea-nr7-breakout": nr7BreakoutScanner,
  "ea-williams-cci": williamsCciScanner,
  "ea-pivot-inverted": pivotInvertedScanner,
  "ea-rsi-cross": rsiCrossScanner,
  "ea-bb-rsi-combo": bbRsiComboScanner,
  "ea-ema-cloud-touch": emaCloudTouchScanner,
};

export async function runEAScan(
  ctx: StrategyContext,
  strategies: string[] = Object.keys(EA_SCANNERS)
): Promise<ScanSignal[]> {
  const results: ScanSignal[] = [];
  for (const key of strategies) {
    const fn = EA_SCANNERS[key];
    if (!fn) continue;
    const signal = await fn(ctx);
    if (signal) results.push(signal);
  }
  return results;
}
