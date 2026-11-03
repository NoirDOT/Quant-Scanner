// /home/z/my-project/src/lib/scanner/strategies/traders/scanner.ts
// Executes each trader's strategy ruleset against multi-timeframe price data
// and produces a composite score + signal

import type { StrategyInfo, ScanSignal } from "../../types";
import type { Timeframe } from "../../instruments";
import { getCandlesLive, type Candle } from "../../data";
import { TRADER_STRATEGIES, type TraderStrategyDef } from "./definitions";
import {
  detectStructure,
  detectFVGs,
  activeFVGsAt,
  detectOrderBlocks,
  activeOrderBlocksAt,
  detectLiquiditySweeps,
  detectOTE,
  premiumDiscount,
  htfBias,
  findSwingPoints,
} from "../../ict";
import { activeKillzones } from "../../ict/killzones";
import { ema } from "../../indicators/moving-averages";

// Bar duration in seconds for each timeframe (for computing bar close time).
function barDurationSec(tf: Timeframe): number {
  switch (tf) {
    case "1h": return 3600;
    case "2h": return 7200;
    case "4h": return 14400;
    case "1d": return 86400;
    case "1w": return 604800;
  }
}

export const TRADER_SCAN_STRATEGIES: StrategyInfo[] = TRADER_STRATEGIES.map((t) => ({
  key: `trader-${t.key}`,
  type: "trader" as const,
  label: t.name,
  description: t.description,
  timeframes: (t.rules.htfTimeframes as Timeframe[]),
}));

export interface TraderScanResult {
  traderKey: string;
  traderName: string;
  symbol: string;
  display: string;
  assetClass: string;
  direction: "long" | "short" | "neutral";
  score: number;            // 0-100 composite
  reasons: string[];
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  ltfTimeframe: Timeframe;
  barTime?: number;          // unix seconds — LTF bar open time (for dedupe + grading)
  barCloseMs?: number;       // ms — LTF bar close time (for killzone scoring + freshness)
  metadata: {
    htfDirection: "bullish" | "bearish" | "neutral";
    htfBias: number;
    sweep: boolean;
    mss: boolean;
    fvg: boolean;
    ob: boolean;
    ote: boolean;
    inKillzone: boolean;
    confluenceNotes: string[];
    confidenceLevel: "corroborated" | "inferred";
    sources: string[];
    ruleSet: TraderStrategyDef["rules"];
  };
}

export async function runTraderScan(
  traderKey: string,
  symbol: string,
  display: string,
  assetClass: string
): Promise<TraderScanResult | null> {
  const trader = TRADER_STRATEGIES.find((t) => t.key === traderKey);
  if (!trader) return null;
  const htfTf = (trader.rules.htfTimeframes[0] as Timeframe) || "4h";
  const mtfTf = (trader.rules.htfTimeframes[1] as Timeframe) || "1h";
  const ltfTf = (trader.rules.ltfTimeframe as Timeframe) || "1m";

  // For LTF we approximate 1m/5m/15m using 1h data (Yahoo doesn't provide <1h granularity for free)
  // Use 1h as the LTF proxy
  const effectiveLtf: Timeframe =
    String(ltfTf) === "1m" || String(ltfTf) === "5m" || String(ltfTf) === "15m"
      ? "1h"
      : (ltfTf as Timeframe);

  const [htfRes, mtfRes, ltfRes] = await Promise.all([
    getCandlesLive(symbol, htfTf),
    getCandlesLive(symbol, mtfTf),
    getCandlesLive(symbol, effectiveLtf),
  ]);
  const htfCandles = htfRes.candles;
  const mtfCandles = mtfRes.candles;
  const ltfCandles = ltfRes.candles;

  if (htfCandles.length < 30 || mtfCandles.length < 30 || ltfCandles.length < 30) {
    return null;
  }

  // Bar close time = the LTF (most granular) closed bar's close time.
  // Used by the grading layer for time-aware killzone scoring + cross-sweep dedupe.
  const lastLtfBar = ltfCandles[ltfCandles.length - 1];
  const ltfBarCloseMs = lastLtfBar ? (lastLtfBar.time + barDurationSec(effectiveLtf)) * 1000 : Date.now();

  // HTF bias
  const htf = htfBias(htfCandles, htfTf);

  // MTF: structure events
  const mtfEvents = detectStructure(mtfCandles);
  const mtfLastEvent = mtfEvents[mtfEvents.length - 1];
  const mtfMss =
    mtfLastEvent &&
    mtfLastEvent.index >= mtfCandles.length - 10 &&
    mtfLastEvent.kind === "CHoCH";

  // LTF: sweep, FVG, OB, OTE
  const ltfFvgs = detectFVGs(ltfCandles);
  const ltfObs = detectOrderBlocks(ltfCandles);
  const ltfSweeps = detectLiquiditySweeps(ltfCandles);
  const ltfOtes = detectOTE(ltfCandles);
  const ltfPD = premiumDiscount(ltfCandles);
  const lastIdx = ltfCandles.length - 1;
  const activeLtfFvg = activeFVGsAt(ltfFvgs, lastIdx).slice(-1)[0];
  const activeLtfOb = activeOrderBlocksAt(ltfObs, lastIdx).slice(-1)[0];
  const recentSweep = ltfSweeps.find((s) => s.index >= lastIdx - 10);
  const recentOte = ltfOtes.filter((o) => o.index >= lastIdx - 5).slice(-1)[0];
  const pdState = ltfPD[ltfPD.length - 1];

  // Killzone check
  const activeKZs = activeKillzones();
  const inKillzone = activeKZs.length > 0;
  // For Dion Trades: also check if we're in the 9:30 OR or 10AM window (UTC equivalent)
  const utcHour = new Date().getUTCHours();
  const inDionWindow = utcHour >= 13 && utcHour <= 16; // 9:30am-12pm ET approx

  // Trendline confluence for Tori Trades: detect using recent swing slope
  const swings = findSwingPoints(ltfCandles, 2);
  const lastSwingHigh = swings.filter((s) => s.type === "high").slice(-1)[0];
  const lastSwingLow = swings.filter((s) => s.type === "low").slice(-1)[0];
  let trendlineConfluence = false;
  if (lastSwingHigh && lastSwingLow) {
    // simple: recent swing high vs low slope is consistent with HTF direction
    const price = ltfCandles[lastIdx].close;
    if (htf.direction === "bullish" && price > lastSwingLow.price) trendlineConfluence = true;
    if (htf.direction === "bearish" && price < lastSwingHigh.price) trendlineConfluence = true;
  }

  // MA confluence for MovingAverage: price above 20 EMA on LTF
  let maConfluence = false;
  const closes = ltfCandles.map((c) => c.close);
  const ema20Arr = ema(closes, 20);
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const lastClose = ltfCandles[lastIdx].close;
  if (ema20 !== null) {
    maConfluence =
      (htf.direction === "bullish" && lastClose > ema20) ||
      (htf.direction === "bearish" && lastClose < ema20);
  }

  // Composite scoring based on trader's requiredModules
  let score = 0;
  const reasons: string[] = [];
  const confluenceNotes: string[] = [];
  const required = trader.rules.requiredModules.map((m) => m.toLowerCase());

  // HTF bias (always required)
  if (htf.direction !== "neutral") {
    score += 25;
    reasons.push(`HTF ${htfTf.toUpperCase()} bias: ${htf.direction.toUpperCase()} (${htf.bias.toFixed(0)})`);
  } else {
    reasons.push("HTF bias neutral");
  }

  // Liquidity sweep
  const hasSweep = !!recentSweep;
  if (hasSweep && (required.some((r) => r.includes("liquidity")) || required.some((r) => r.includes("irl")) || required.some((r) => r.includes("sweep")))) {
    score += 20;
    reasons.push(
      `${recentSweep!.direction === "buy-side" ? "Buy-side" : "Sell-side"} liquidity sweep detected (LTF, last 10 bars)`
    );
  }

  // MSS (displacement / CHoCH)
  const hasMss = !!mtfMss || (mtfLastEvent && mtfLastEvent.index >= mtfCandles.length - 10 && mtfLastEvent.kind === "CHoCH");
  if (hasMss && required.some((r) => r.includes("mss") || r.includes("bos"))) {
    score += 20;
    reasons.push(`MSS/CHoCH on MTF (${mtfTf.toUpperCase()}) within last 10 bars`);
  }

  // FVG
  const hasFvg = !!activeLtfFvg;
  if (hasFvg && required.some((r) => r.includes("fvg"))) {
    score += 20;
    reasons.push(
      `${activeLtfFvg!.direction.toUpperCase()} FVG active on LTF (${effectiveLtf.toUpperCase()}): ${activeLtfFvg!.bottom.toFixed(5)} → ${activeLtfFvg!.top.toFixed(5)}`
    );
  }

  // Order Block
  const hasOb = !!activeLtfOb;
  if (hasOb && required.some((r) => r.includes("order block") || r.includes("ob"))) {
    score += 15;
    reasons.push(
      `${activeLtfOb!.direction.toUpperCase()} Order Block active on LTF: ${activeLtfOb!.low.toFixed(5)} – ${activeLtfOb!.high.toFixed(5)}`
    );
  }

  // OTE / Fibonacci
  const hasOte = !!recentOte;
  if (hasOte && required.some((r) => r.includes("ote") || r.includes("fib"))) {
    score += 20;
    reasons.push(
      `OTE zone on LTF: ${recentOte!.oteBottom.toFixed(5)} → ${recentOte!.oteTop.toFixed(5)} (${recentOte!.direction})`
    );
    if (recentOte!.fvgConfluence) {
      score += 10;
      reasons.push("FVG confluence inside OTE (A+ setup)");
    }
  }

  // Killzone
  const mustKillzone = required.some((r) => r.includes("killzone")) || required.some((r) => r.includes("silver bullet"));
  if (mustKillzone) {
    if (inKillzone) {
      score += 15;
      reasons.push(`Inside ICT killzone: ${activeKZs.map((k) => k.name).join(", ")}`);
      const sb = activeKZs.find((k) => k.isSilverBullet);
      if (sb) {
        score += 10;
        reasons.push("Silver Bullet window active — highest-probability execution");
      }
    } else {
      reasons.push("OUTSIDE killzone — setup scored lower per trader's rules");
    }
  } else {
    if (inKillzone) score += 5; // small bonus
  }

  // Dion-specific: 10AM / 9:30 OR window
  if (trader.key === "diontrades") {
    if (inDionWindow) {
      score += 15;
      reasons.push("Inside 9:30–10AM NY window (Dion's primary time window)");
    }
  }

  // Confluence extras (MovingAverage, Tori trendlines)
  if (trader.key === "movingaverage" && maConfluence) {
    score += 20;
    reasons.push(`MA confluence: price ${lastClose > ema20! ? "above" : "below"} 20-EMA on LTF aligned with HTF bias`);
    confluenceNotes.push("MA20 confluence confirmed");
  }
  if (trader.key === "toritrades" && trendlineConfluence) {
    score += 15;
    reasons.push("Trendline confluence: recent swing slope aligned with HTF direction");
    confluenceNotes.push("Trendline confluence confirmed");
  }

  // Premium/Discount for Jadecapfx (Fib-based)
  if (trader.key === "jadecapfx" && pdState) {
    if (htf.direction === "bullish" && pdState.discountZone) {
      score += 10;
      reasons.push("Entry in discount zone (Fib confluence for Jadecapfx)");
    } else if (htf.direction === "bearish" && pdState.premiumZone) {
      score += 10;
      reasons.push("Entry in premium zone (Fib confluence for Jadecapfx)");
    }
  }

  score = Math.min(100, score);

  // Direction
  let direction: "long" | "short" | "neutral" = "neutral";
  if (htf.direction === "bullish") direction = "long";
  else if (htf.direction === "bearish") direction = "short";

  // Final entry / stop / target
  const entry = lastClose;
  let stopPrice: number | undefined;
  let targetPrice: number | undefined;
  if (activeLtfOb) {
    stopPrice = activeLtfOb.direction === "bullish"
      ? activeLtfOb.low * 0.998
      : activeLtfOb.high * 1.002;
  } else if (activeLtfFvg) {
    stopPrice = activeLtfFvg.direction === "bullish"
      ? activeLtfFvg.bottom * 0.999
      : activeLtfFvg.top * 1.001;
  }
  if (stopPrice && entry) {
    const risk = Math.abs(entry - stopPrice);
    targetPrice = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
  }

  return {
    traderKey: trader.key,
    traderName: trader.name,
    symbol,
    display,
    assetClass,
    direction,
    score,
    reasons,
    entryPrice: entry,
    stopPrice,
    targetPrice,
    ltfTimeframe: effectiveLtf,
    barTime: lastLtfBar?.time,
    barCloseMs: ltfBarCloseMs,
    metadata: {
      htfDirection: htf.direction,
      htfBias: htf.bias,
      sweep: hasSweep,
      mss: hasMss,
      fvg: hasFvg,
      ob: hasOb,
      ote: hasOte,
      inKillzone,
      confluenceNotes,
      confidenceLevel: trader.confidenceLevel,
      sources: trader.sources,
      ruleSet: trader.rules,
    },
  };
}

export function traderResultToSignal(r: TraderScanResult): ScanSignal {
  return {
    strategyKey: `trader-${r.traderKey}`,
    strategyType: "trader",
    strategyLabel: `${r.traderName} Model`,
    symbol: r.symbol,
    display: r.display,
    assetClass: r.assetClass,
    timeframe: r.ltfTimeframe,
    direction: r.direction,
    score: r.score,
    reasons: r.reasons,
    entryPrice: r.entryPrice,
    stopPrice: r.stopPrice,
    targetPrice: r.targetPrice,
    metadata: {
      ...r.metadata,
      barTime: r.barTime,
      barCloseMs: r.barCloseMs,
    },
  };
}
