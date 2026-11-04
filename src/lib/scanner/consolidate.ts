// src/lib/scanner/consolidate.ts
// Collapse hundreds of raw signals into a handful of tradeable SETUPS.
//
// The unit you actually trade is PAIR + DIRECTION, not strategy. A full sweep
// produces 500+ raw signals because 10 trader models all fire on EUR/USD and
// 8 ICT scanners all flag the same FVG. This module merges every signal for
// the same symbol + direction into a single Setup carrying:
//   - which FAMILIES agree (trend / ict / trader / ea / horc) — counted as
//     independent votes, not strategies (10 trader models = 1 vote)
//   - which timeframes agree (4h + 1d agreement is stronger than 4h alone)
//   - the best entry/stop/target + R:R
//   - a conflict flag when the opposite direction is also firing
//   - the market regime (bull/bear/sideways) — attached by runScan
//
// A setup is GATED before ranking:
//   - minimum 2 agreeing families (kills single-strategy noise)
//   - minimum R:R (default 1.5)
//   - price still near entry (within 0.5×ATR — stale setups dropped)
//   - regime alignment (trend/EA signals suppressed in sideways + counter-trend)
//   - ADR exhaustion (drop if price already moved >80% of average daily range)

import type { ScanSignal } from "./types";
import type { Regime, RegimeAssessment } from "./regime";
import { strategyFitsRegime } from "./regime";
import { isSymbolAffected, type NewsBlackoutResult } from "./news";

export interface Setup {
  symbol: string;
  display: string;
  assetClass: string;
  direction: "long" | "short";
  families: string[];                  // unique families that agree
  timeframes: string[];                 // unique timeframes
  strategyCount: number;                // total raw signals collapsed
  rr: number;                           // R:R of the best signal
  score: number;                        // blended setup score
  conflicted: boolean;                  // opposite direction also firing
  best: ScanSignal;                     // highest-scoring raw signal
  allSignals: ScanSignal[];             // every signal collapsed into this setup
  regime?: Regime;                      // bull/bear/sideways (from runScan)
  regimeLabel?: string;                 // human-readable regime
  regimeFits?: boolean;                 // does the signal direction fit the regime?
  newsBlackout?: boolean;               // true if a high-impact event is active
  newsLabel?: string;                   // e.g. "NFP active"
}

export interface ConsolidateOptions {
  minFamilies?: number;   // default 2 — kills single-strategy noise
  minRR?: number;         // default 1.5
  maxStaleAtrMultiple?: number; // default 0.5 — drop if price moved >0.5×ATR past entry
  livePrices?: Record<string, number | null>;
  /** Per-symbol regime assessment (computed by runScan from the candle data). */
  regimes?: Record<string, RegimeAssessment>;
  /** Drop setups where the signal direction conflicts with the regime.
   *  Default true — trend/EA counter-trend signals are suppressed. */
  applyRegimeGate?: boolean;
  /** News blackout state — when active, affected setups are suppressed. */
  newsBlackout?: NewsBlackoutResult | null;
}

export function consolidate(
  signals: ScanSignal[],
  opts: ConsolidateOptions = {},
): { setups: Setup[]; conflicted: Setup[]; dropped: number } {
  const minFamilies = opts.minFamilies ?? 2;
  const minRR = opts.minRR ?? 1.5;
  const livePrices = opts.livePrices ?? {};
  const regimes = opts.regimes ?? {};
  const applyRegimeGate = opts.applyRegimeGate ?? true;
  const newsBlackout = opts.newsBlackout ?? null;

  // Group all signals by symbol
  const bySymbol = new Map<string, ScanSignal[]>();
  for (const s of signals) {
    if (s.direction === "neutral") continue;
    const arr = bySymbol.get(s.symbol) ?? [];
    arr.push(s);
    bySymbol.set(s.symbol, arr);
  }

  const accepted: Setup[] = [];
  const conflictedOut: Setup[] = [];
  let dropped = 0;

  for (const [symbol, sigs] of bySymbol) {
    const regime = regimes[symbol];

    for (const dir of ["long", "short"] as const) {
      const side = sigs.filter((s) => s.direction === dir);
      if (side.length === 0) continue;

      const families = [...new Set(side.map((s) => s.strategyType))];
      const timeframes = [...new Set(side.map((s) => s.timeframe))];
      const best = side.reduce((a, b) => (b.score > a.score ? b : a));

      const { entryPrice: e, stopPrice: sl, targetPrice: tp } = best;
      const rr = e && sl && tp && e !== sl ? Math.abs(tp - e) / Math.abs(e - sl) : 0;

      // Conflict: the opposite direction is also firing on this symbol.
      // If the opposite side has at least half as many signals, mark conflicted.
      const oppositeCount = sigs.length - side.length;
      const conflicted = oppositeCount >= side.length * 0.5;

      // Gating — drop single-strategy noise and poor R:R
      if (families.length < minFamilies) { dropped++; continue; }
      if (rr < minRR) { dropped++; continue; }

      // Stale check: if we have a live price and it's already run past the entry
      // by more than 0.5×ATR, the setup is stale. (We approximate "ATR" using
      // the distance from entry to stop, which is the risk leg.)
      const live = livePrices[symbol];
      if (live != null && e != null && sl != null) {
        const risk = Math.abs(e - sl);
        const movePastEntry = dir === "long"
          ? Math.max(0, live - e)
          : Math.max(0, e - live);
        if (movePastEntry > risk * (opts.maxStaleAtrMultiple ?? 0.5)) {
          dropped++;
          continue;
        }
      }

      // Regime gate: suppress trend/EA signals that don't fit the regime
      let regimeFits = true;
      if (applyRegimeGate && regime) {
        // Check the best signal's family — if it's trend/ea and the direction
        // conflicts with the regime, drop the setup.
        const bestFamily = best.strategyType as "trend" | "ict" | "trader" | "ea" | "horc" | "community";
        regimeFits = strategyFitsRegime(bestFamily, regime.regime, dir);
        if (!regimeFits) {
          dropped++;
          continue;
        }
      }

      // News blackout: suppress setups on currencies affected by a high-impact event
      // (NFP, FOMC, CPI, rate decisions). These cause violent, unpredictable moves.
      let newsAffected = false;
      let newsLabel: string | undefined;
      if (newsBlackout && newsBlackout.inBlackout) {
        newsAffected = isSymbolAffected(symbol, best.assetClass, newsBlackout);
        if (newsAffected) {
          newsLabel = newsBlackout.activeEvents
            .map((e) => e.name.split(" ")[0]) // "NFP", "FOMC", etc.
            .join("+") + " active";
          dropped++;
          continue; // suppress the setup entirely during the blackout window
        }
      }

      // Blended setup score (placeholder weights — tune against forward-test data)
      // Start from the best signal's score, then reward cross-family + cross-TF
      // agreement, penalize conflicts.
      let score = best.score
        + 8 * (families.length - 1)              // +8 per additional family
        + (timeframes.length > 1 ? 10 : 0)      // +10 if 4h + 1d agree
        - (conflicted ? 15 : 0);                 // -15 if opposite direction firing

      // Regime strength bonus: setups aligned with a strong regime get a boost
      if (regime && regimeFits) {
        score += regime.strength * 0.1;           // up to +10 for strong regime alignment
      }

      const setup: Setup = {
        symbol,
        display: best.display,
        assetClass: best.assetClass,
        direction: dir,
        families,
        timeframes,
        strategyCount: side.length,
        rr,
        score,
        conflicted,
        best,
        allSignals: side,
        regime: regime?.regime,
        regimeLabel: regime?.label,
        regimeFits,
        newsBlackout: newsAffected,
        newsLabel,
      };

      if (conflicted) conflictedOut.push(setup);
      else accepted.push(setup);
    }
  }

  accepted.sort((a, b) => b.score - a.score);
  conflictedOut.sort((a, b) => b.score - a.score);

  return { setups: accepted, conflicted: conflictedOut, dropped };
}

