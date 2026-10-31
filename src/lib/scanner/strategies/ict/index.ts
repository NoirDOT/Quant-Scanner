// /home/z/my-project/src/lib/scanner/strategies/ict/index.ts
// ICT composite strategy — runs all 8 modules and composites a signal per timeframe

import type { StrategyContext, ScanSignal, StrategyInfo } from "../../types";
import type { Timeframe } from "../../instruments";
import { getCandles } from "../../data";
import {
  detectStructure,
  detectFVGs,
  activeFVGsAt,
  detectOrderBlocks,
  activeOrderBlocksAt,
  detectLiquiditySweeps,
  detectOTE,
  premiumDiscount,
  model2022,
} from "../../ict";
import { activeKillzones } from "../../ict/killzones";

export const ICT_STRATEGIES: StrategyInfo[] = [
  { key: "ict-fvg", type: "ict", label: "FVG (Fair Value Gap)", description: "Unmitigated 3-candle imbalance awaiting price return", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-ob", type: "ict", label: "Order Blocks", description: "Last opposing candle before displacement", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-bos-choch", type: "ict", label: "BOS / CHoCH", description: "Break of structure / change of character events", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-liquidity", type: "ict", label: "Liquidity Sweeps", description: "Stops above/below equal highs/lows swept", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-ote", type: "ict", label: "OTE (Optimal Trade Entry)", description: "Fib 0.62–0.79 retracement with optional FVG confluence", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-premium-discount", type: "ict", label: "Premium / Discount", description: "Buy in discount, sell in premium of dealing range", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-killzone", type: "ict", label: "Killzones / Silver Bullet", description: "Time-based execution windows per ICT", timeframes: ["1h", "2h", "4h", "1d", "1w"] },
  { key: "ict-2022-model", type: "ict", label: "2022 Mentorship Model", description: "HTF draw → MTF refine → LTF entry composite", timeframes: ["1h", "4h", "1d", "1w"] },
];

export function fvgScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return null;
  const fvgs = detectFVGs(candles);
  const lastIdx = candles.length - 1;
  const active = activeFVGsAt(fvgs, lastIdx);
  if (active.length === 0) return null;
  const latest = active[active.length - 1];
  const reasons: string[] = [
    `${latest.direction.toUpperCase()} FVG unmitigated since bar ${latest.startIndex + 1}`,
    `Gap zone: ${latest.bottom.toFixed(5)} → ${latest.top.toFixed(5)}`,
  ];
  const lastClose = candles[lastIdx].close;
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  if (latest.direction === "bullish" && lastClose > latest.bottom) {
    direction = "long";
    score = 65;
    reasons.push("Price above bullish FVG (continuation zone)");
  } else if (latest.direction === "bearish" && lastClose < latest.top) {
    direction = "short";
    score = 65;
    reasons.push("Price below bearish FVG (continuation zone)");
  } else {
    score = 50;
    direction = "neutral";
    reasons.push("Price currently between FVG (waiting for return)");
  }
  if (lastIdx - latest.endIndex <= 5) {
    score += 15;
    reasons.push("FVG formed within last 5 bars (fresh imbalance)");
  }
  const entry = lastClose;
  const stop = latest.direction === "bullish" ? latest.bottom * 0.999 : latest.top * 1.001;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return {
    strategyKey: `ict-fvg-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `FVG · ${timeframe.toUpperCase()}`,
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
    metadata: { fvg: latest },
  };
}

export function obScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const obs = detectOrderBlocks(candles);
  const lastIdx = candles.length - 1;
  const active = activeOrderBlocksAt(obs, lastIdx);
  if (active.length === 0) return null;
  const latest = active[active.length - 1];
  const lastClose = candles[lastIdx].close;
  const reasons: string[] = [
    `${latest.direction.toUpperCase()} Order Block active: ${latest.low.toFixed(5)} – ${latest.high.toFixed(5)}`,
  ];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 0;
  if (latest.direction === "bullish" && lastClose > latest.low) {
    direction = "long";
    score = 60;
    reasons.push("Price above bullish OB (OB respected)");
  } else if (latest.direction === "bearish" && lastClose < latest.high) {
    direction = "short";
    score = 60;
    reasons.push("Price below bearish OB (OB respected)");
  }
  if (lastIdx - latest.endIndex <= 10) {
    score += 15;
    reasons.push("OB formed within last 10 bars (fresh)");
  }
  const entry = lastClose;
  const stop = latest.direction === "bullish" ? latest.low * 0.998 : latest.high * 1.002;
  const risk = Math.abs(entry - stop);
  const target = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  return {
    strategyKey: `ict-ob-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `Order Block · ${timeframe.toUpperCase()}`,
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
    metadata: { ob: latest },
  };
}

export function bosChochScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const events = detectStructure(candles);
  if (events.length === 0) return null;
  const last = events[events.length - 1];
  const recentEvents = events.filter((e) => e.index >= candles.length - 5);
  const reasons: string[] = [
    `Last structure event: ${last.kind} ${last.direction.toUpperCase()} at bar ${last.index + 1}`,
  ];
  const direction: "long" | "short" = last.direction === "bullish" ? "long" : "short";
  let score = 55;
  if (last.kind === "BOS") {
    score += 15;
    reasons.push("BOS = trend continuation confirmation");
  } else {
    score += 20;
    reasons.push("CHoCH = reversal — fresh trend initiation (higher-probability)");
  }
  if (recentEvents.length >= 2) {
    score += 10;
    reasons.push(`${recentEvents.length} structure events in last 5 bars`);
  }
  const lastClose = candles[candles.length - 1].close;
  const stop = last.direction === "bullish" ? last.price * 0.998 : last.price * 1.002;
  const risk = Math.abs(lastClose - stop);
  const target = last.direction === "bullish" ? lastClose + 2 * risk : lastClose - 2 * risk;
  return {
    strategyKey: `ict-bos-choch-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `${last.kind} · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score: Math.min(100, score),
    reasons,
    entryPrice: lastClose,
    stopPrice: stop,
    targetPrice: target,
    metadata: { kind: last.kind, structureDirection: last.direction },
  };
}

export function liquidityScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const sweeps = detectLiquiditySweeps(candles);
  const lastIdx = candles.length - 1;
  const recent = sweeps.filter((s) => s.index >= lastIdx - 5);
  if (recent.length === 0) return null;
  const sweep = recent[recent.length - 1];
  const reasons: string[] = [
    `${sweep.direction === "buy-side" ? "Buy-side" : "Sell-side"} liquidity swept at ${sweep.price.toFixed(5)}`,
    "Wick + close on opposite side of the equal highs/lows",
  ];
  const direction: "long" | "short" = sweep.direction === "buy-side" ? "short" : "long";
  let score = 65;
  if (sweep.displacementIndex < candles.length) {
    const disp = candles[sweep.displacementIndex];
    if (direction === "long" && disp.close > disp.open) {
      score += 20;
      reasons.push("Bullish displacement candle confirmed after sweep");
    } else if (direction === "short" && disp.close < disp.open) {
      score += 20;
      reasons.push("Bearish displacement candle confirmed after sweep");
    }
  }
  const lastClose = candles[lastIdx].close;
  const stop = sweep.price * (direction === "long" ? 0.998 : 1.002);
  const risk = Math.abs(lastClose - stop);
  const target = direction === "long" ? lastClose + 2 * risk : lastClose - 2 * risk;
  return {
    strategyKey: `ict-liquidity-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `Liquidity Sweep · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score: Math.min(100, score),
    reasons,
    entryPrice: lastClose,
    stopPrice: stop,
    targetPrice: target,
    metadata: { sweep },
  };
}

export function oteScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const otes = detectOTE(candles);
  if (otes.length === 0) return null;
  const lastIdx = candles.length - 1;
  const recent = otes.filter((o) => o.index >= lastIdx - 3);
  if (recent.length === 0) return null;
  const ote = recent[recent.length - 1];
  const reasons: string[] = [
    `OTE zone: ${ote.oteBottom.toFixed(5)} → ${ote.oteTop.toFixed(5)} (${ote.direction.toUpperCase()})`,
    `Mid (0.705): ${ote.oteMid.toFixed(5)}`,
  ];
  if (ote.fvgConfluence) {
    reasons.push("FVG confluence inside OTE — higher-probability entry");
  }
  const direction: "long" | "short" = ote.direction === "bullish" ? "long" : "short";
  let score = 60;
  if (ote.fvgConfluence) score += 25;
  if (ote.index === lastIdx) score += 10;
  const lastClose = candles[lastIdx].close;
  const stop = ote.direction === "bullish" ? ote.swingLow : ote.swingHigh;
  const risk = Math.abs(lastClose - stop);
  const target = direction === "long" ? lastClose + 2 * risk : lastClose - 2 * risk;
  return {
    strategyKey: `ict-ote-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `OTE · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score: Math.min(100, score),
    reasons,
    entryPrice: lastClose,
    stopPrice: stop,
    targetPrice: target,
    metadata: { ote },
  };
}

export function premiumDiscountScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 50) return null;
  const pd = premiumDiscount(candles);
  const last = pd[pd.length - 1];
  if (!last) return null;
  const reasons: string[] = [
    `Dealing range: ${last.rangeLow.toFixed(5)} – ${last.rangeHigh.toFixed(5)}`,
    `Equilibrium (50%): ${last.equilibrium.toFixed(5)}`,
  ];
  let direction: "long" | "short" | "neutral" = "neutral";
  let score = 50;
  if (last.inDiscountExtreme) {
    direction = "long";
    score = 70;
    reasons.push("Price in deep discount (bottom 25% of range) — long bias");
  } else if (last.inPremiumExtreme) {
    direction = "short";
    score = 70;
    reasons.push("Price in deep premium (top 25% of range) — short bias");
  } else if (last.discountZone) {
    direction = "long";
    score = 55;
    reasons.push("Price in discount (below 50%) — long bias");
  } else if (last.premiumZone) {
    direction = "short";
    score = 55;
    reasons.push("Price in premium (above 50%) — short bias");
  }
  if (score < 50) return null;
  const lastClose = candles[candles.length - 1].close;
  const stop = direction === "long" ? last.rangeLow * 0.998 : last.rangeHigh * 1.002;
  const risk = Math.abs(lastClose - stop);
  const target = last.equilibrium;
  return {
    strategyKey: `ict-premium-discount-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `Premium/Discount · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: lastClose,
    stopPrice: stop,
    targetPrice: target,
    metadata: { ...last },
  };
}

export function killzoneScanner(ctx: StrategyContext): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  if (candles.length < 30) return null;
  const activeKZs = activeKillzones();
  if (activeKZs.length === 0) return null;
  const reasons: string[] = activeKZs.map((k) => `${k.name} active (${k.minutesRemaining} min left): ${k.description}`);
  let score = 50;
  const sb = activeKZs.find((k) => k.isSilverBullet);
  let direction: "long" | "short" | "neutral" = "neutral";
  if (sb) {
    score = 75;
    direction = sb.bulletDirection ?? "neutral";
    reasons.push("Silver Bullet window active — ICT's highest-probability execution window");
  } else {
    score = 55;
  }
  const lastClose = candles[candles.length - 1].close;
  return {
    strategyKey: `ict-killzone-${timeframe}`,
    strategyType: "ict",
    strategyLabel: `Killzone · ${timeframe.toUpperCase()}`,
    symbol,
    display,
    assetClass,
    timeframe,
    direction,
    score,
    reasons,
    entryPrice: lastClose,
    metadata: { activeKillzones: activeKZs },
  };
}

export async function model2022Scanner(
  symbol: string,
  display: string,
  assetClass: string,
  htfTf: Timeframe = "1d",
  mtfTf: Timeframe = "4h",
  ltfTf: Timeframe = "1h"
): Promise<ScanSignal | null> {
  const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
    getCandles(symbol, htfTf),
    getCandles(symbol, mtfTf),
    getCandles(symbol, ltfTf),
  ]);
  if (htfCandles.length < 30 || mtfCandles.length < 30 || ltfCandles.length < 30) return null;
  const signal = model2022(htfCandles, htfTf, mtfCandles, mtfTf, ltfCandles, ltfTf);
  if (signal.compositeScore < 50) return null;
  return {
    strategyKey: `ict-2022-model-${htfTf}-${mtfTf}-${ltfTf}`,
    strategyType: "ict",
    strategyLabel: `2022 Model · ${htfTf}/${mtfTf}/${ltfTf}`,
    symbol,
    display,
    assetClass,
    timeframe: ltfTf,
    direction: signal.finalSignal,
    score: signal.compositeScore,
    reasons: [
      `HTF (${signal.htfTimeframe.toUpperCase()}): ${signal.htfReason}`,
      `MTF (${signal.mtfTimeframe.toUpperCase()}): ${signal.mtfReason}`,
      `LTF (${signal.ltfTimeframe.toUpperCase()}): ${signal.ltfReason}`,
    ],
    entryPrice: signal.entryPrice,
    stopPrice: signal.stopPrice,
    targetPrice: signal.targetPrice,
    metadata: { ...signal },
  };
}

export const ICT_SCANNERS: Record<string, (ctx: StrategyContext) => ScanSignal | null> = {
  "ict-fvg": fvgScanner,
  "ict-ob": obScanner,
  "ict-bos-choch": bosChochScanner,
  "ict-liquidity": liquidityScanner,
  "ict-ote": oteScanner,
  "ict-premium-discount": premiumDiscountScanner,
  "ict-killzone": killzoneScanner,
};

export async function runICTScan(
  ctx: StrategyContext,
  strategies: string[] = Object.keys(ICT_SCANNERS)
): Promise<ScanSignal[]> {
  const results: ScanSignal[] = [];
  for (const key of strategies) {
    const fn = ICT_SCANNERS[key];
    if (!fn) continue;
    const signal = fn(ctx);
    if (signal) results.push(signal);
  }
  return results;
}
