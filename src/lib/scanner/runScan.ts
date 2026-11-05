// src/lib/scanner/runScan.ts
// Core scan orchestration — extracted from /api/scanner/route.ts so the ping
// route can call it directly (no HTTP self-fetch + no Vercel SSO workaround).
//
// Layers:
//   1. Fetch candles (closed bars only — see data.ts)
//   2. Apply Layer-2 pre-filters
//   3. Run strategies (trend / ICT / trader / EA / HORC)
//   4. Attach bar close time + catalog stats to each signal
//   5. Apply universal grading (time-aware killzone, real catalog stats)
//   6. Filter by minScore, sort by score desc
//   7. Persist to ScanResult + ForwardTestSignal (optional)
//   8. Dispatch alerts (optional — cross-sweep deduped)

import {
  INSTRUMENTS,
  type Timeframe,
  type AssetClass,
  type Instrument,
} from "./instruments";
import { getCandlesLive, pLimit, type Candle } from "./data";
import { anyFilterMatches } from "./filters";
import { TREND_SCANNERS, TREND_STRATEGIES, runTrendScan } from "./strategies/trend";
import { ICT_SCANNERS, ICT_STRATEGIES, runICTScan, model2022Scanner } from "./strategies/ict";
import { runTraderScan, TRADER_STRATEGIES, traderResultToSignal } from "./strategies/traders";
import { EA_SCANNERS, EA_SCANNERS_INFO, runEAScan } from "./strategies/eas";
import { HORC_SCANNERS, HORC_SCANNERS_INFO } from "./strategies/horc";
import { applyGrade, applyGradeAll } from "./grading";
import type { ScanSignal } from "./types";
import { dispatchAlerts } from "./alerts";
import { db } from "@/lib/db";
import { loadCatalogStatsMap, attachCatalogStats, recordSymbolDataStatus } from "./catalogStats";
import { consolidate, type Setup } from "./consolidate";
import { classifyRegime, type RegimeAssessment } from "./regime";
import { getNewsBlackout, formatActiveEvents, formatUpcomingEvents } from "./news";
import { createIndicatorCache, setIndicatorCache, clearIndicatorCache } from "./indicatorCache";

export interface RunScanOptions {
  strategyType?: string;             // "trend" | "ict" | "trader" | "ea" | "horc" | "all"
  strategies?: string[];             // strategy keys
  traderKeys?: string[];
  eaKeys?: string[];
  instruments?: string | string[];   // "all" | symbol[] | asset class filter
  assetClasses?: string[];
  timeframes?: string[];
  minScore?: number;
  persist?: boolean;
  dispatch?: boolean;
  filterKeys?: string[];
  /** Whether to write ForwardTestSignal rows for each dispatched signal. Default = persist. */
  trackForward?: boolean;
  /** Cap concurrent instrument scans (default 8). */
  concurrency?: number;
}

export interface RunScanMeta {
  instrumentsScanned: number;
  instrumentsSkipped: number;
  timeframesScanned: Timeframe[];
  strategyType?: string;
  minScore: number;
  filtersApplied: string[];
  live: boolean;
  livePrices: Record<string, number | null>;
  symbolDataStatus: Array<{ symbol: string; timeframe: string; candles: number; source: string; livePrice: number | null; lastBarTime: number | null }>;
  catalogStatsLoaded: number;
  forwardSignalsWritten: number;
  dispatched: number;
  deduped: number;
  setupCount: number;
  conflictedSetupCount: number;
  newsBlackoutActive: boolean;
  newsActiveLabel: string | null;
  newsUpcomingLabel: string | null;
  duration: number;
}

export interface RunScanResult {
  count: number;
  signals: ScanSignal[];
  /** Consolidated tradeable setups (one per symbol + direction). Empty if
   *  fewer than minFamilies agree on every pair. Use this for the UI + Discord. */
  setups: Setup[];
  /** Setups where the opposite direction is also firing (separated so the UI
   *  can show them in an "ignore" bucket). */
  conflictedSetups: Setup[];
  meta: RunScanMeta;
}

function barDurationSec(tf: Timeframe): number {
  switch (tf) {
    case "1h": return 3600;
    case "2h": return 7200;
    case "4h": return 14400;
    case "1d": return 86400;
    case "1w": return 604800;
  }
}

function resolveInstruments(opts: RunScanOptions): Instrument[] {
  const selected = opts.instruments;
  const assetClasses = opts.assetClasses;
  let instruments: Instrument[] = [];
  if (!selected || selected === "all" || (Array.isArray(selected) && selected.length === 0)) {
    if (assetClasses && assetClasses.length > 0) {
      instruments = INSTRUMENTS.filter((i) => assetClasses.includes(i.assetClass));
    } else {
      instruments = INSTRUMENTS.filter((i) =>
        ["forex", "crypto", "commodity", "index"].includes(i.assetClass)
      );
    }
  } else {
    const wanted = Array.isArray(selected) ? selected : [selected];
    instruments = INSTRUMENTS.filter((i) => wanted.includes(i.symbol));
    if (instruments.length === 0) {
      instruments = wanted.map((s) => ({ symbol: s, display: s, assetClass: "stock" as AssetClass }));
    }
  }
  return instruments.slice(0, 50);
}

export async function runScan(opts: RunScanOptions = {}): Promise<RunScanResult> {
  const startedAt = Date.now();

  // Create a per-scan indicator cache and stash it on globalThis so all
  // strategies can share computed indicators (EMA, ATR, ADX, Supertrend, etc.)
  // without recomputing them for every strategy on the same candles.
  const indicatorCache = createIndicatorCache();
  setIndicatorCache(indicatorCache);

  const tfList: Timeframe[] = (opts.timeframes && opts.timeframes.length > 0
    ? opts.timeframes
    : ["1h", "4h", "1d"]) as Timeframe[];
  const minScoreVal = typeof opts.minScore === "number" ? opts.minScore : 50;
  const shouldPersist = !!opts.persist;
  const shouldDispatch = !!opts.dispatch;
  const shouldTrackForward = opts.trackForward ?? shouldPersist;
  const filterKeys = opts.filterKeys;
  const strategyType = opts.strategyType;
  const strategies = opts.strategies;
  const traderKeys = opts.traderKeys;
  const eaKeys = opts.eaKeys;
  const concurrency = Math.min(opts.concurrency ?? 8, 12);

  const instruments = resolveInstruments(opts);

  // Pre-load backtest stats once for the whole sweep (powers catalogScore).
  let catalogStatsLoaded = 0;
  try {
    const statsMap = await loadCatalogStatsMap();
    catalogStatsLoaded = statsMap.size;
    // Stash on global so attachCatalogStats can read it without re-querying.
    (globalThis as any).__scannerCatalogStats = statsMap;
  } catch (err) {
    console.error("[runScan] loadCatalogStatsMap failed:", err);
  }

  const allSignals: ScanSignal[] = [];
  const livePrices: Record<string, number | null> = {};
  /** FX rates for risk sizing — map of quote currency → USD price of 1 unit.
   *  e.g. { "JPY": 0.0067, "GBP": 1.27, "EUR": 1.08 }
   *  Derived from livePrices as the scan progresses. */
  const fxRates: Record<string, number> = {};
  const symbolDataStatus: RunScanMeta["symbolDataStatus"] = [];
  /** Per-symbol regime assessment, computed from the daily candle data.
   *  Used by consolidate() to gate counter-trend setups. */
  const regimes: Record<string, import("./regime").RegimeAssessment> = {};
  /** Per-symbol ADR (Average Daily Range) in price units, computed from daily
   *  candles. Used by consolidate() for the ADR exhaustion gate. */
  const adrs: Record<string, number> = {};
  let anyLive = false;
  let instrumentsSkipped = 0;

  const scanInstrument = async (inst: Instrument) => {
    const localSignals: ScanSignal[] = [];
    for (const tf of tfList) {
      const result = await getCandlesLive(inst.symbol, tf);
      const { candles, livePrice, source, formingCandle } = result;
      if (candles.length < 30) {
        symbolDataStatus.push({
          symbol: inst.symbol, timeframe: tf, candles: candles.length,
          source: "failed", livePrice: null, lastBarTime: null,
        });
        continue;
      }
      if (livePrice != null) { livePrices[inst.symbol] = livePrice; if (source === "live") anyLive = true; }

      const lastClosed = candles[candles.length - 1];
      const barCloseMs = (lastClosed.time + barDurationSec(tf)) * 1000;
      const lastBarTime = lastClosed.time;

      // Compute regime from the daily candle data (most stable timeframe for
      // regime classification). We only need to do this once per symbol.
      if (!regimes[inst.symbol] && tf === "1d" && candles.length >= 200) {
        try {
          regimes[inst.symbol] = classifyRegime(candles, inst.symbol, tf);
        } catch (err) {
          console.error(`[runScan] regime classify failed for ${inst.symbol}:`, err);
        }
      }

      // Compute ADR (Average Daily Range) from daily candles for the ADR
      // exhaustion gate in consolidate(). ADR = average of (high - low) over
      // the last 14 daily bars. Only compute once per symbol (on 1d TF).
      if (adrs[inst.symbol] == null && tf === "1d" && candles.length >= 14) {
        const last14 = candles.slice(-14);
        const ranges = last14.map((c) => c.high - c.low);
        adrs[inst.symbol] = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      }

      symbolDataStatus.push({
        symbol: inst.symbol, timeframe: tf, candles: candles.length,
        source, livePrice, lastBarTime,
      });

      // Layer 2 pre-filter
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
        const baseKeys = trendKeys.map((k: string) => k.replace(/-(1h|2h|4h|1d|1w)$/, ""));
        const uniqueBaseKeys = Array.from(new Set(baseKeys));
        const validKeys = uniqueBaseKeys.filter((k) => Object.keys(TREND_SCANNERS).includes(k));
        const trendSignals = await runTrendScan(ctx, validKeys);
        // Tag each signal with bar close time so grading can score killzone correctly
        for (const s of trendSignals) {
          s.metadata = { ...(s.metadata ?? {}), barCloseMs, barTime: lastBarTime };
        }
        localSignals.push(...trendSignals);
      }
      // ICT scanners
      if (!strategyType || strategyType === "ict" || strategyType === "all") {
        const ictKeys = strategies && strategies.length > 0
          ? strategies.filter((k) => ICT_STRATEGIES.some((s) => s.key === k.split("-"+tf)[0]))
          : Object.keys(ICT_SCANNERS);
        const baseKeys = ictKeys.map((k: string) => k.replace(/-(1h|2h|4h|1d|1w)$/, ""));
        const uniqueBaseKeys = Array.from(new Set(baseKeys));
        const validKeys = uniqueBaseKeys.filter((k) => Object.keys(ICT_SCANNERS).includes(k));
        const ictSignals = await runICTScan(ctx, validKeys);
        for (const s of ictSignals) {
          s.metadata = { ...(s.metadata ?? {}), barCloseMs, barTime: lastBarTime };
        }
        localSignals.push(...ictSignals);
      }
      // EA scanners
      if (strategyType === "ea" || strategyType === "all") {
        const eaList = eaKeys && eaKeys.length > 0 ? eaKeys : Object.keys(EA_SCANNERS);
        const eaSignals = await runEAScan(ctx, eaList);
        for (const s of eaSignals) {
          s.metadata = { ...(s.metadata ?? {}), barCloseMs, barTime: lastBarTime };
        }
        localSignals.push(...eaSignals);
      }
      // HORC scanners
      if (strategyType === "horc" || strategyType === "all") {
        const horcKeys = strategies && strategies.length > 0
          ? Object.keys(HORC_SCANNERS).filter((k) => strategies.some((s) => s.startsWith(k)))
          : Object.keys(HORC_SCANNERS);
        for (const hk of horcKeys) {
          const fn = HORC_SCANNERS[hk as keyof typeof HORC_SCANNERS];
          try {
            const sig = await fn(ctx);
            if (sig) {
              sig.metadata = { ...(sig.metadata ?? {}), barCloseMs, barTime: lastBarTime };
              localSignals.push(sig);
            }
          } catch (err) {
            console.error(`[scanner] HORC ${hk} failed:`, err);
          }
        }
      }
    }
    // 2022 model (multi-timeframe — runs once per instrument)
    if ((!strategyType || strategyType === "ict" || strategyType === "all") &&
        (!strategies || strategies.length === 0 || strategies.includes("ict-2022-model"))) {
      const m2022 = await model2022Scanner(inst.symbol, inst.display, inst.assetClass, "1d", "4h", "1h");
      if (m2022) {
        // The 2022 model fetches its own data, so we don't have the bar time
        // from the outer loop. Floor the current time to the 4h bar boundary
        // so the dedupe key is STABLE across sweeps within the same bar —
        // otherwise Date.now() changes every sweep and the key never repeats,
        // causing re-alerts every sweep + junk rows in ForwardTestSignal.
        // (4h bars close at 01, 05, 09, 13, 17, 21 UTC with 21:00 alignment.)
        const nowSec = Math.floor(Date.now() / 1000);
        const fourHours = 4 * 3600;
        const barOpenSec = Math.floor(nowSec / fourHours) * fourHours;
        const barCloseSec = barOpenSec + fourHours;
        m2022.metadata = {
          ...(m2022.metadata ?? {}),
          barCloseMs: barCloseSec * 1000,
          barTime: barOpenSec,
        };
        localSignals.push(m2022);
      }
    }
    // Trader scanners — 10 models in parallel
    if (strategyType === "trader" || strategyType === "all") {
      const traders = traderKeys && traderKeys.length > 0
        ? traderKeys
        : TRADER_STRATEGIES.map((t) => t.key);
      const traderResults = await Promise.all(
        traders.map(async (tk) => {
          try {
            return await runTraderScan(tk, inst.symbol, inst.display, inst.assetClass);
          } catch (err) {
            console.error(`[scanner] trader ${tk} failed for ${inst.symbol}:`, err);
            return null;
          }
        })
      );
      for (const result of traderResults) {
        if (result) {
          // traderResultToSignal now carries barTime + barCloseMs from the
          // trader scanner (the LTF closed bar's close time). Do NOT overwrite
          // with Date.now() — that would re-introduce the scan-time killzone
          // bug and break cross-sweep dedupe.
          const sig = traderResultToSignal(result);
          localSignals.push(sig);
        }
      }
    }
    return localSignals;
  };

  // Concurrency-limited instrument scan
  await pLimit(instruments, concurrency, async (inst) => {
    try {
      const sigs = await scanInstrument(inst);
      allSignals.push(...sigs);
    } catch (err) {
      console.error(`[scanner] instrument ${inst.symbol} failed:`, err);
      instrumentsSkipped++;
    }
  });

  // Derive FX rates from live prices for risk sizing.
  // For each forex pair, the live price tells us how many USD 1 unit of the
  // quote currency is worth. e.g. USDJPY=149.5 → 1 JPY = 1/149.5 USD = 0.00669.
  for (const [symbol, price] of Object.entries(livePrices)) {
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    if (!symbol.includes("=") && !symbol.endsWith("=X")) continue;
    const pair = symbol.replace("=X", "");
    if (pair.length !== 6) continue;
    const base = pair.slice(0, 3);
    const quote = pair.slice(3, 6);
    if (base === "USD") {
      // e.g. USDJPY=149.5 → 1 JPY = 1/149.5 USD
      fxRates[quote] = 1 / price;
    } else if (quote === "USD") {
      // e.g. EURUSD=1.08 → 1 EUR = 1.08 USD
      fxRates[base] = price;
    }
    // Cross pairs (e.g. EURGBP) don't directly give us USD rates, but we can
    // derive them if we have the USD rate for one of the currencies.
  }
  // Cross-pair derivation: if we know GBP/USD and EUR/GBP, we can compute EUR/USD.
  for (const [symbol, price] of Object.entries(livePrices)) {
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const pair = symbol.replace("=X", "");
    if (pair.length !== 6) continue;
    const base = pair.slice(0, 3);
    const quote = pair.slice(3, 6);
    if (base === "USD" || quote === "USD") continue; // direct pair, already handled
    // EURGBP: if we know GBP/USD, then EUR/USD = EURGBP × GBP/USD
    if (fxRates[quote] && !fxRates[base]) {
      fxRates[base] = price * fxRates[quote];
    }
  }

  // Attach catalog stats (sync, reads from global cached earlier)
  attachCatalogStats(allSignals);

  // Apply universal grading (uses barCloseMs from metadata if present)
  applyGradeAll(allSignals, (s) => s.metadata?.barCloseMs);

  // Filter + sort
  const filtered = allSignals.filter((s) => s.score >= minScoreVal);
  filtered.sort((a, b) => b.score - a.score);

  // Compute news blackout state once for the whole sweep.
  // When a high-impact event (NFP, FOMC, CPI, rate decision) is in its
  // blackout window, affected setups are suppressed.
  const newsBlackout = getNewsBlackout();

  // Consolidate raw signals into tradeable setups (one per symbol + direction).
  // This MUST happen before dispatch so Discord sends setup embeds (with
  // regime, risk sizing, TV deep link) instead of individual signal embeds.
  const { setups, conflicted: conflictedSetups } = consolidate(filtered, {
    livePrices,
    regimes,
    newsBlackout,
    adrs,
  });

  // Persist ScanResult rows (best-effort) — one row per filtered signal.
  // This is the historical record (queryable via /api/scanner/signals).
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
          barTime: s.metadata?.barTime ?? null,
        })),
      });
    } catch (err) {
      console.error("[scanner] persist error:", err);
    }
  }

  // Record per-symbol data status (best-effort)
  if (shouldPersist || shouldDispatch) {
    try {
      await recordSymbolDataStatus(symbolDataStatus);
    } catch (err) {
      console.error("[scanner] symbolDataStatus write error:", err);
    }
  }

  // Dispatch alerts (cross-sweep deduped via DispatchedSignal table).
  // Pass the consolidated SETUPS so Discord sends setup embeds (with regime,
  // risk sizing, TV deep link) instead of individual signal embeds.
  // dispatchAlerts returns the list of signals it ACTUALLY dispatched
  // (after dedupe + cap), which we use below for forward-test tracking.
  let dispatched = 0;
  let deduped = 0;
  let dispatchedSignals: ScanSignal[] = [];
  if (shouldDispatch) {
    try {
      const result = await dispatchAlerts(filtered, {
        trackForward: shouldTrackForward,
        setups: setups.length > 0 ? setups : undefined,
        fxRates,
      });
      dispatched = result.dispatched;
      deduped = result.deduped;
      dispatchedSignals = result.dispatchedSignals;
    } catch (err) {
      console.error("[scanner] dispatch error:", err);
    }
  }

  // Write ForwardTestSignal rows ONLY for dispatched signals (not every
  // filtered signal). The unique constraint on
  // (strategyKey, symbol, timeframe, direction, barTime) prevents the same
  // setup being written 6× per day for a persistent signal. Signals with
  // no entry/stop/target are skipped (can't compute R multiple without them).
  let forwardSignalsWritten = 0;
  if (shouldTrackForward && dispatchedSignals.length > 0) {
    try {
      // Filter out signals missing entry/stop/target — they'd produce 0
      // values that make outcome replay meaningless.
      const fwdRows = dispatchedSignals
        .filter((s) => s.entryPrice != null && s.stopPrice != null && s.targetPrice != null)
        .map((s) => ({
          strategyKey: s.strategyKey,
          family: s.strategyType,
          symbol: s.symbol,
          timeframe: s.timeframe,
          direction: s.direction,
          entryPrice: s.entryPrice!,
          stopPrice: s.stopPrice!,
          targetPrice: s.targetPrice!,
          score: s.score,
          grade: s.grade ?? null,
          reasonsJson: JSON.stringify(s.reasons),
          barTime: s.metadata?.barTime ?? null,
        }));
      if (fwdRows.length > 0) {
        // The unique constraint on (strategyKey, symbol, timeframe, direction, barTime)
        // prevents duplicate rows for the same setup. We catch the constraint
        // violation at the DB level rather than using skipDuplicates (which
        // requires a preview feature that isn't enabled).
        try {
          const r = await db.forwardTestSignal.createMany({ data: fwdRows as any });
          forwardSignalsWritten = r.count;
        } catch (dupErr: any) {
          // P2002 = unique constraint violation — expected when the same bar
          // re-dispatches. Count the rows we attempted as "written" since the
          // first occurrence is already in the DB.
          if (dupErr?.code === "P2002") {
            forwardSignalsWritten = fwdRows.length;
          } else {
            throw dupErr;
          }
        }
      }
    } catch (err) {
      console.error("[scanner] forward test signal write error:", err);
    }
  }

  const duration = Date.now() - startedAt;

  // Clear the indicator cache — it's per-scan, not persistent.
  clearIndicatorCache();

  return {
    count: filtered.length,
    signals: filtered,
    setups,
    conflictedSetups,
    meta: {
      instrumentsScanned: instruments.length,
      instrumentsSkipped,
      timeframesScanned: tfList,
      strategyType,
      minScore: minScoreVal,
      filtersApplied: filterKeys ?? [],
      live: anyLive,
      livePrices,
      symbolDataStatus,
      catalogStatsLoaded,
      forwardSignalsWritten,
      dispatched,
      deduped,
      setupCount: setups.length,
      conflictedSetupCount: conflictedSetups.length,
      newsBlackoutActive: newsBlackout.inBlackout,
      newsActiveLabel: formatActiveEvents(newsBlackout),
      newsUpcomingLabel: formatUpcomingEvents(newsBlackout),
      duration,
    },
  };
}
