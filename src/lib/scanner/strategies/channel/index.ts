import type { StrategyContext, ScanSignal, ScannerFn, StrategyInfo } from "../../types";
import { donchianFromCloses } from "../../indicators/donchian";
import { atr } from "../../indicators/atr";

export const DUAL_CHANNEL_STRATEGIES: StrategyInfo[] = [
  { key: "channel-dual-ema", type: "trend", label: "Dual EMA Channel (High/Low)", description: "EMA(high,20) + EMA(low,20) — breakout confirmed by opposite tracker rising/falling", timeframes: ["1h","2h","4h","1d","1w"] },
  { key: "channel-dual-donchian", type: "trend", label: "Dual Donchian Channel (High/Low)", description: "Donchian high(20) + Donchian low(20) — channel breakout with slope confirmation", timeframes: ["1h","2h","4h","1d","1w"] },
  { key: "channel-dual-atr", type: "trend", label: "ATR Channel (High/Low + ATR bands)", description: "EMA(high) + EMA(low) with ATR-scaled channel width, breakout + momentum", timeframes: ["1h","2h","4h","1d","1w"] },
];

function emaOfArray(values: number[], period: number): number[] {
  const out: number[] = []; const k = 2 / (period + 1); let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) { if (i === 0) { out.push(values[0]); continue; } prev = values[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}
function slope(values: number[], lookback: number): number {
  if (values.length < lookback + 1) return 0;
  const now = values[values.length - 1]; const past = values[values.length - 1 - lookback];
  if (!isFinite(past) || past === 0) return 0; return (now - past) / past;
}

export const dualEmaChannelScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return Promise.resolve(null) as any;
  const highs = candles.map(c => c.high); const lows = candles.map(c => c.low); const closes = candles.map(c => c.close);
  const period = 20; const highEMA = emaOfArray(highs, period); const lowEMA = emaOfArray(lows, period);
  const i = closes.length - 1; const close = closes[i]; const highTrack = highEMA[i]; const lowTrack = lowEMA[i];
  if (!isFinite(highTrack) || !isFinite(lowTrack)) return Promise.resolve(null) as any;
  const lowSlope = slope(lowEMA, 5); const highSlope = slope(highEMA, 5);
  const prevHighTrack = highEMA[i - 1] ?? highTrack; const prevLowTrack = lowEMA[i - 1] ?? lowTrack;
  const reasons: string[] = []; let direction: "long" | "short" | "neutral" = "neutral"; let entry = close; let stop = close;
  if (close > prevHighTrack && lowSlope > 0) { direction = "long"; entry = close; stop = lowTrack; reasons.push(`Close broke above HIGH EMA ${highTrack.toFixed(5)}`); reasons.push(`LOW tracker rising (slope ${(lowSlope*100).toFixed(2)}%)`); }
  else if (close < prevLowTrack && highSlope < 0) { direction = "short"; entry = close; stop = highTrack; reasons.push(`Close broke below LOW EMA ${lowTrack.toFixed(5)}`); reasons.push(`HIGH tracker falling (slope ${(highSlope*100).toFixed(2)}%)`); }
  if (direction === "neutral") return Promise.resolve(null) as any;
  const risk = Math.abs(entry - stop); if (risk <= 0) return Promise.resolve(null) as any;
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  const signal: ScanSignal = { strategyKey: "channel-dual-ema", strategyType: "trend", strategyLabel: "Dual EMA Channel (High/Low)", symbol, display, assetClass, timeframe, direction, score: Math.min(95, 60 + Math.abs(lowSlope*1000) + Math.abs(highSlope*1000)), reasons, entryPrice: entry, stopPrice: stop, targetPrice: target };
  return Promise.resolve(signal) as any;
};

export const dualDonchianChannelScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return Promise.resolve(null) as any;
  const highs = candles.map(c => c.high); const lows = candles.map(c => c.low); const closes = candles.map(c => c.close);
  const period = 20; const dc = donchianFromCloses(highs, lows, closes, period);
  const i = closes.length - 1; const state = dc[i]; if (!state) return Promise.resolve(null) as any;
  const close = closes[i]; const upper = state.upper; const lower = state.lower;
  const prevUpper = dc[i - 5]?.upper ?? upper; const prevLower = dc[i - 5]?.lower ?? lower;
  const upperSlope = prevUpper !== 0 ? (upper - prevUpper) / prevUpper : 0; const lowerSlope = prevLower !== 0 ? (lower - prevLower) / prevLower : 0;
  const reasons: string[] = []; let direction: "long" | "short" | "neutral" = "neutral"; let entry = close; let stop = close;
  if (close > upper && lowerSlope > 0) { direction = "long"; entry = close; stop = lower; reasons.push(`Close broke above Donchian upper ${upper.toFixed(5)}`); reasons.push(`Donchian lower rising (slope ${(lowerSlope*100).toFixed(2)}%)`); }
  else if (close < lower && upperSlope < 0) { direction = "short"; entry = close; stop = upper; reasons.push(`Close broke below Donchian lower ${lower.toFixed(5)}`); reasons.push(`Donchian upper falling (slope ${(upperSlope*100).toFixed(2)}%)`); }
  if (direction === "neutral") return Promise.resolve(null) as any;
  const risk = Math.abs(entry - stop); if (risk <= 0) return Promise.resolve(null) as any;
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  const signal: ScanSignal = { strategyKey: "channel-dual-donchian", strategyType: "trend", strategyLabel: "Dual Donchian Channel (High/Low)", symbol, display, assetClass, timeframe, direction, score: Math.min(95, 65 + Math.abs(lowerSlope*1000) + Math.abs(upperSlope*1000)), reasons, entryPrice: entry, stopPrice: stop, targetPrice: target };
  return Promise.resolve(signal) as any;
};

export const atrChannelScanner: ScannerFn = (ctx) => {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return Promise.resolve(null) as any;
  const highs = candles.map(c => c.high); const lows = candles.map(c => c.low); const closes = candles.map(c => c.close);
  const period = 20; const highEMA = emaOfArray(highs, period); const lowEMA = emaOfArray(lows, period);
  const atrs = atr(highs, lows, closes, 14); const lastATR = atrs[atrs.length - 1];
  if (lastATR === null || lastATR === undefined) return Promise.resolve(null) as any;
  const i = closes.length - 1; const close = closes[i]; const midEMA = (highEMA[i] + lowEMA[i]) / 2;
  const upperBand = midEMA + lastATR * 1.5; const lowerBand = midEMA - lastATR * 1.5;
  const highSlope = slope(highEMA, 5); const lowSlope = slope(lowEMA, 5);
  const reasons: string[] = []; let direction: "long" | "short" | "neutral" = "neutral"; let entry = close; let stop = close;
  if (close > upperBand && highSlope > 0 && lowSlope > 0) { direction = "long"; entry = close; stop = lowerBand; reasons.push(`Close above ATR upper band ${upperBand.toFixed(5)}`); reasons.push(`Both trackers rising — channel expansion up`); }
  else if (close < lowerBand && highSlope < 0 && lowSlope < 0) { direction = "short"; entry = close; stop = upperBand; reasons.push(`Close below ATR lower band ${lowerBand.toFixed(5)}`); reasons.push(`Both trackers falling — channel expansion down`); }
  if (direction === "neutral") return Promise.resolve(null) as any;
  const risk = Math.abs(entry - stop); if (risk <= 0) return Promise.resolve(null) as any;
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  const signal: ScanSignal = { strategyKey: "channel-dual-atr", strategyType: "trend", strategyLabel: "ATR Channel (High/Low + ATR bands)", symbol, display, assetClass, timeframe, direction, score: Math.min(95, 70 + Math.abs(lowSlope*1000) + Math.abs(highSlope*1000)), reasons, entryPrice: entry, stopPrice: stop, targetPrice: target };
  return Promise.resolve(signal) as any;
};

export const DUAL_CHANNEL_SCANNERS: Record<string, ScannerFn> = {
  "channel-dual-ema": dualEmaChannelScanner, "channel-dual-donchian": dualDonchianChannelScanner, "channel-dual-atr": atrChannelScanner,
};
