// /home/z/my-project/src/lib/scanner/ict/model2022.ts
// ICT 2022 Mentorship Model — top-down HTF draw on 1W/1D, refine on 4H, entry on 1H/15m
// We model this as a multi-timeframe composite: needs HTF bias + MTF confirmation + LTF entry

import type { Candle } from "../data";
import { detectStructure, latestStructureAt } from "./structure";
import { detectFVGs, activeFVGsAt } from "./fvg";
import { detectOrderBlocks, activeOrderBlocksAt } from "./orderBlocks";
import { premiumDiscount } from "./premiumDiscount";
import { detectLiquiditySweeps } from "./liquidity";

export interface HTFBias {
  direction: "bullish" | "bearish" | "neutral";
  bias: number;       // 0-100 strength
  reason: string;
}

export interface Model2022Signal {
  htfTimeframe: string;        // e.g. "1w" or "1d"
  htfDirection: "bullish" | "bearish" | "neutral";
  htfBias: number;
  htfReason: string;
  mtfTimeframe: string;        // "4h"
  mtfConfirmed: boolean;
  mtfReason: string;
  ltfTimeframe: string;        // "1h"
  ltfEntryTriggered: boolean;
  ltfReason: string;
  fvg: ReturnType<typeof activeFVGsAt>[number] | null;
  orderBlock: ReturnType<typeof activeOrderBlocksAt>[number] | null;
  inDiscount: boolean;
  inPremium: boolean;
  sweptLiquidity: boolean;
  compositeScore: number;     // 0-100
  finalSignal: "long" | "short" | "neutral";
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
}

export function htfBias(candles: Candle[], tf: string): HTFBias {
  if (candles.length < 50) {
    return { direction: "neutral", bias: 0, reason: "Insufficient HTF history" };
  }
  const events = detectStructure(candles);
  const last = events[events.length - 1];
  if (!last) return { direction: "neutral", bias: 20, reason: "No clear structure break yet" };
  // Count last 3 events in same direction = stronger trend
  const recent = events.slice(-3);
  const sameDir = recent.filter((e) => e.direction === last.direction).length;
  const bias = 40 + sameDir * 20;
  return {
    direction: last.direction,
    bias: Math.min(100, bias),
    reason: `${tf}: ${last.kind} ${last.direction.toUpperCase()}, ${sameDir}/3 consecutive structure breaks in same direction`,
  };
}

export function mtfConfirmation(
  candles: Candle[],
  htfDir: "bullish" | "bearish" | "neutral"
): { confirmed: boolean; reason: string } {
  if (htfDir === "neutral") {
    return { confirmed: false, reason: "HTF neutral — no MTF confirmation needed yet" };
  }
  const fvgs = detectFVGs(candles);
  const obs = detectOrderBlocks(candles);
  const lastIdx = candles.length - 1;
  const activeFVG = activeFVGsAt(fvgs, lastIdx).slice(-1)[0];
  const activeOB = activeOrderBlocksAt(obs, lastIdx).slice(-1)[0];
  if (!activeFVG && !activeOB) {
    return { confirmed: false, reason: "No active MTF FVG/OB" };
  }
  if (htfDir === "bullish") {
    if (activeFVG && activeFVG.direction === "bullish") {
      return { confirmed: true, reason: "MTF bullish FVG active" };
    }
    if (activeOB && activeOB.direction === "bullish") {
      return { confirmed: true, reason: "MTF bullish Order Block active" };
    }
  } else {
    if (activeFVG && activeFVG.direction === "bearish") {
      return { confirmed: true, reason: "MTF bearish FVG active" };
    }
    if (activeOB && activeOB.direction === "bearish") {
      return { confirmed: true, reason: "MTF bearish Order Block active" };
    }
  }
  return { confirmed: false, reason: "Active MTF FVG/OB but mismatched direction" };
}

export function ltfEntry(
  candles: Candle[],
  htfDir: "bullish" | "bearish" | "neutral"
): { triggered: boolean; reason: string; fvg?: any; ob?: any; inPremium?: boolean; inDiscount?: boolean; swept?: boolean } {
  if (htfDir === "neutral") return { triggered: false, reason: "HTF neutral" };
  const fvgs = detectFVGs(candles);
  const obs = detectOrderBlocks(candles);
  const sweeps = detectLiquiditySweeps(candles);
  const pd = premiumDiscount(candles);
  const lastIdx = candles.length - 1;
  const lastCandle = candles[lastIdx];
  const pdState = pd[pd.length - 1];
  const activeFVG = activeFVGsAt(fvgs, lastIdx).slice(-1)[0];
  const activeOB = activeOrderBlocksAt(obs, lastIdx).slice(-1)[0];
  const recentSweep = sweeps.find(
    (s) => s.index >= lastIdx - 5
  );
  const triggered =
    activeFVG && activeFVG.direction === htfDir &&
    pdState &&
    (htfDir === "bullish" ? pdState.discountZone : pdState.premiumZone) &&
    recentSweep;
  return {
    triggered: !!triggered,
    reason: triggered
      ? `LTF: FVG + ${htfDir === "bullish" ? "discount" : "premium"} + liquidity sweep confluence`
      : `LTF: Missing one of FVG/Premium-Discount/sweep`,
    fvg: activeFVG,
    ob: activeOB,
    inPremium: pdState?.premiumZone,
    inDiscount: pdState?.discountZone,
    swept: !!recentSweep,
  };
}

export function model2022(
  htfCandles: Candle[], htfTf: string,
  mtfCandles: Candle[], mtfTf: string,
  ltfCandles: Candle[], ltfTf: string,
): Model2022Signal {
  const htf = htfBias(htfCandles, htfTf);
  const mtf = mtfConfirmation(mtfCandles, htf.direction);
  const ltf = ltfEntry(ltfCandles, htf.direction);
  let score = 0;
  if (htf.direction !== "neutral") score += htf.bias * 0.4;
  if (mtf.confirmed) score += 30;
  if (ltf.triggered) score += 30;
  score = Math.min(100, score);
  const finalSignal =
    score >= 70
      ? htf.direction === "bullish"
        ? "long"
        : htf.direction === "bearish"
        ? "short"
        : "neutral"
      : "neutral";
  const last = ltfCandles[ltfCandles.length - 1];
  const entryPrice = finalSignal !== "neutral" ? last.close : undefined;
  const stopPrice =
    finalSignal === "long" && ltf.ob
      ? ltf.ob.low
      : finalSignal === "short" && ltf.ob
      ? ltf.ob.high
      : undefined;
  const targetPrice =
    entryPrice && stopPrice
      ? finalSignal === "long"
        ? entryPrice + 2 * Math.abs(entryPrice - stopPrice)
        : entryPrice - 2 * Math.abs(entryPrice - stopPrice)
      : undefined;
  return {
    htfTimeframe: htfTf,
    htfDirection: htf.direction,
    htfBias: htf.bias,
    htfReason: htf.reason,
    mtfTimeframe: mtfTf,
    mtfConfirmed: mtf.confirmed,
    mtfReason: mtf.reason,
    ltfTimeframe: ltfTf,
    ltfEntryTriggered: ltf.triggered,
    ltfReason: ltf.reason,
    fvg: ltf.fvg ?? null,
    orderBlock: ltf.ob ?? null,
    inDiscount: !!ltf.inDiscount,
    inPremium: !!ltf.inPremium,
    sweptLiquidity: !!ltf.swept,
    compositeScore: score,
    finalSignal,
    entryPrice,
    stopPrice,
    targetPrice,
  };
}
