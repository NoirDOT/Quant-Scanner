// /home/z/my-project/src/app/api/scanner/route.ts
// Unified scanner API — runs trend, ICT, trader, EA, or HORC strategies on a set of instruments.
// All signals are passed through the universal A+/A/B+/B-/C grading layer before returning.

import { NextRequest, NextResponse } from "next/server";
import {
  INSTRUMENTS,
  TIMEFRAMES,
  type Timeframe,
  type AssetClass,
  type Instrument,
} from "@/lib/scanner/instruments";
import { getCandlesLive } from "@/lib/scanner/data";
import { anyFilterMatches } from "@/lib/scanner/filters";
import { TREND_SCANNERS, TREND_STRATEGIES, runTrendScan } from "@/lib/scanner/strategies/trend";
import { ICT_SCANNERS, ICT_STRATEGIES, runICTScan, model2022Scanner } from "@/lib/scanner/strategies/ict";
import { runTraderScan, TRADER_STRATEGIES, traderResultToSignal } from "@/lib/scanner/strategies/traders";
import { EA_SCANNERS, EA_SCANNERS_INFO, runEAScan, EA_STRATEGIES } from "@/lib/scanner/strategies/eas";
import { HORC_SCANNERS, HORC_SCANNERS_INFO } from "@/lib/scanner/strategies/horc";
import { applyGrade, applyGradeAll } from "@/lib/scanner/grading";
import type { ScanSignal } from "@/lib/scanner/types";
import { dispatchAlerts } from "@/lib/scanner/alerts";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    strategyType,            // "trend" | "ict" | "trader" | "ea" | "all"
    strategies,              // string[] of strategy keys
    traderKeys,              // string[] of trader keys (for type=trader)
    eaKeys,                  // string[] of EA keys (for type=ea)
    instruments: selected,   // string[] of symbols, or "all" or asset class
    assetClasses,            // string[] of asset classes to filter
    timeframes,              // Timeframe[]
    minScore,                // number 0-100
    persist,                 // boolean — store in DB
    dispatch,                // boolean — send alerts
    filterKeys,              // string[] — Layer 2 pre-filters (4-layer architecture)
  } = body as {
    strategyType?: string;
    strategies?: string[];
    traderKeys?: string[];
    eaKeys?: string[];
    instruments?: string | string[];
    assetClasses?: string[];
    timeframes?: string[];
    minScore?: number;
    persist?: boolean;
    dispatch?: boolean;
    filterKeys?: string[];
  };

  const tfList: Timeframe[] = (timeframes && timeframes.length > 0 ? timeframes : ["1h", "4h", "1d"]) as Timeframe[];
  const minScoreVal = typeof minScore === "number" ? minScore : 50;
  const shouldPersist = !!persist;
  const shouldDispatch = !!dispatch;

  // Determine instruments
  let instruments: Instrument[] = [];
  if (!selected || selected === "all" || (Array.isArray(selected) && selected.length === 0)) {
    if (assetClasses && assetClasses.length > 0) {
      instruments = INSTRUMENTS.filter((i) => assetClasses.includes(i.assetClass));
    } else {
      // Default to majors — forex + crypto + commodities
      instruments = INSTRUMENTS.filter((i) =>
        ["forex", "crypto", "commodity", "index"].includes(i.assetClass)
      );
    }
  } else {
    const wanted = Array.isArray(selected) ? selected : [selected];
    instruments = INSTRUMENTS.filter((i) => wanted.includes(i.symbol));
    if (instruments.length === 0) {
      // Allow freeform symbols
      instruments = wanted.map((s) => ({ symbol: s, display: s, assetClass: "stock" as AssetClass }));
    }
  }

  // Cap concurrent instruments to keep response fast
  instruments = instruments.slice(0, 50);

  const allSignals: ScanSignal[] = [];
  const livePrices: Record<string, number | null> = {};
  let anyLive = false;

  // ── Per-instrument scan (extracted so we can run in parallel) ──
  const scanInstrument = async (inst: Instrument) => {
    const localSignals: ScanSignal[] = [];
    for (const tf of tfList) {
      const { candles, livePrice, source } = await getCandlesLive(inst.symbol, tf);
      if (candles.length < 30) continue;
      if (livePrice != null) { livePrices[inst.symbol] = livePrice; if (source === "live") anyLive = true; }

      // Layer 2 pre-filter (4-layer architecture)
      if (filterKeys && Array.isArray(filterKeys) && filterKeys.length > 0) {
        const passed = anyFilterMatches(
          candles,
          { symbol: inst.symbol, display: inst.display, assetClass: inst.assetClass, timeframe: tf },
          filterKeys,
        );
        if (!passed) continue;
      }

      const ctx = {
        symbol: inst.symbol,
        display: inst.display,
        assetClass: inst.assetClass,
        timeframe: tf,
        candles,
      };
      // Trend scanners
      if (!strategyType || strategyType === "trend" || strategyType === "all") {
        const trendKeys = strategies && strategies.length > 0
          ? strategies.filter((k) => TREND_STRATEGIES.some((s) => s.key === k.split("-"+tf)[0]) || Object.keys(TREND_SCANNERS).includes(k.replace(/-(1h|2h|4h|1d|1w)$/, "")))
          : Object.keys(TREND_SCANNERS);
        // Match by base key (strip trailing timeframe)
        const baseKeys = trendKeys.map((k: string) => k.replace(/-(1h|2h|4h|1d|1w)$/, ""));
        const uniqueBaseKeys = Array.from(new Set(baseKeys));
        const validKeys = uniqueBaseKeys.filter((k) => Object.keys(TREND_SCANNERS).includes(k));
        const trendSignals = await runTrendScan(ctx, validKeys);
        localSignals.push(...trendSignals);
      }
      // ICT scanners (except 2022 model — handled separately)
      if (!strategyType || strategyType === "ict" || strategyType === "all") {
        const ictKeys = strategies && strategies.length > 0
          ? strategies.filter((k) => ICT_STRATEGIES.some((s) => s.key === k.split("-"+tf)[0]))
          : Object.keys(ICT_SCANNERS);
        const baseKeys = ictKeys.map((k: string) => k.replace(/-(1h|2h|4h|1d|1w)$/, ""));
        const uniqueBaseKeys = Array.from(new Set(baseKeys));
        const validKeys = uniqueBaseKeys.filter((k) => Object.keys(ICT_SCANNERS).includes(k));
        const ictSignals = await runICTScan(ctx, validKeys);
        localSignals.push(...ictSignals);
      }
      // EA scanners (user-provided profitable EAs)
      if (strategyType === "ea" || strategyType === "all") {
        const eaList = eaKeys && eaKeys.length > 0
          ? eaKeys
          : Object.keys(EA_SCANNERS);
        const eaSignals = await runEAScan(ctx, eaList);
        localSignals.push(...eaSignals);
      }
      // HORC scanners (5th family — all 12 chapters)
      if (strategyType === "horc" || strategyType === "all") {
        const horcKeys = strategies && strategies.length > 0
          ? Object.keys(HORC_SCANNERS).filter((k) => strategies.some((s) => s.startsWith(k)))
          : Object.keys(HORC_SCANNERS);
        for (const hk of horcKeys) {
          const fn = HORC_SCANNERS[hk];
          try {
            const sig = await fn(ctx);
            if (sig) localSignals.push(sig);
          } catch (err) {
            console.error(`[scanner] HORC ${hk} failed:`, err);
          }
        }
      }
    }
    // 2022 model — uses multi-timeframe, only run if specifically requested
    if ((!strategyType || strategyType === "ict" || strategyType === "all") &&
        (!strategies || strategies.length === 0 || strategies.includes("ict-2022-model"))) {
      const m2022 = await model2022Scanner(inst.symbol, inst.display, inst.assetClass, "1d", "4h", "1h");
      if (m2022) localSignals.push(m2022);
    }
    // Trader scanners
    if (strategyType === "trader" || strategyType === "all") {
      const traders = traderKeys && traderKeys.length > 0
        ? traderKeys
        : TRADER_STRATEGIES.map((t) => t.key);
      for (const tk of traders) {
        const result = await runTraderScan(tk, inst.symbol, inst.display, inst.assetClass);
        if (result) localSignals.push(traderResultToSignal(result));
      }
    }
    return localSignals;
  };

  // ── Concurrency pool: fetch + scan N instruments at a time ──
  // Turns a serial 46×2 fetch chain (~60s+) into ~8 parallel lanes (~10s)
  const CONCURRENCY = 8;
  const queue = [...instruments];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const inst = queue.shift();
      if (!inst) break;
      try {
        const sigs = await scanInstrument(inst);
        allSignals.push(...sigs);
      } catch (err) {
        console.error(`[scanner] instrument ${inst.symbol} failed:`, err);
      }
    }
  });
  await Promise.all(workers);

  // Apply universal A+/A/B+/B-/C grading to ALL signals
  applyGradeAll(allSignals);

  // Filter by minScore
  const filtered = allSignals.filter((s) => s.score >= minScoreVal);
  // Sort by score desc
  filtered.sort((a, b) => b.score - a.score);

  // Persist to DB (best-effort)
  if (shouldPersist) {
    try {
      await db.scanResult.createMany({
        data: filtered.map((s) => ({
          strategyKey: s.strategyKey,
          strategyType: s.strategyType,
          symbol: s.symbol,
          timeframe: s.timeframe,
          direction: s.direction,
          score: s.score,
          grade: s.grade ?? null,
          reasonsJson: JSON.stringify(s.reasons),
          entryPrice: s.entryPrice ?? null as any,
          stopPrice: s.stopPrice ?? null as any,
          targetPrice: s.targetPrice ?? null as any,
        })),
      });
    } catch (err) {
      console.error("[scanner] persist error:", err);
    }
  }

  // Dispatch alerts (MUST await — on serverless the process freezes when the
  // response returns, so fire-and-forget here means alerts never actually send)
  if (shouldDispatch) {
    try {
      await dispatchAlerts(filtered);
    } catch (err) {
      console.error("[scanner] dispatch error:", err);
    }
  }

  return NextResponse.json({
    count: filtered.length,
    signals: filtered,
    meta: {
      instrumentsScanned: instruments.length,
      timeframesScanned: tfList,
      strategyType,
      minScore: minScoreVal,
      filtersApplied: filterKeys ?? [],
      live: anyLive,
      livePrices,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    strategyTypes: ["trend", "ict", "trader", "ea", "horc", "all"],
    trend: TREND_STRATEGIES,
    ict: ICT_STRATEGIES,
    trader: TRADER_STRATEGIES.map((t) => ({
      key: `trader-${t.key}`,
      traderKey: t.key,
      name: t.name,
      description: t.description,
      confidenceLevel: t.confidenceLevel,
      sources: t.sources,
      rules: t.rules,
    })),
    ea: EA_SCANNERS_INFO.map((e) => ({
      ...e,
      strategyKey: e.key,
      eaId: e.key, // EA_SCANNERS_INFO uses `key` as the unique id (no separate `id` field)
      fullDef: EA_STRATEGIES.find((s) => s.id === e.key),
    })),
    horc: HORC_SCANNERS_INFO,
    timeframes: TIMEFRAMES,
    assetClasses: ["forex", "crypto", "commodity", "stock", "index"],
  });
}
