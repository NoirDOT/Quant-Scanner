// src/lib/scanner/strategies/horc/opposition.ts
// HORC Chapter 5: The opposition rule and timeframe selection.
//
// Per the HORC Visual Study Guide:
//   - "A majority of readings is not, in this framework, proof of the correct
//     participant." (No majority vote.)
//   - Opposition test: on a given interval, the new period's first registered
//     participant must OPPOSE the previous period's CLOSING participant.
//   - "Both readings must come from that same timeframe."
//   - "Select the highest conclusive eligible timeframe." Walk down the eligible
//     hierarchy until one passes opposition.
//   - Gap exception: a gap that clears ORH/ORL AND is not repaired by the first
//     opening candle's body or wick back to previous close → registers initial
//     direction without opposition test. "If even part remains unfilled when
//     that first candle finishes, the lesson calls it unrepaired on that interval."
//
// This module:
//   1. Builds the eligible-timeframe hierarchy for D/W/M/Y period tiers.
//   2. For each interval in the hierarchy, computes the previous period's closing
//      participant + the new period's first registered participant, and tests
//      opposition.
//   3. Returns the highest conclusive interval.
//   4. Handles the gap exception.

import type { Candle } from "../../data";
import type {
  EligibleTimeframe,
  OppositionResult,
  Participant,
} from "./types";
import {
  ELIGIBLE_TF_HIERARCHY_DAILY,
  ELIGIBLE_TF_HIERARCHY_WEEKLY,
  ELIGIBLE_TF_HIERARCHY_MONTHLY,
} from "./types";
import { registerAllCycles, type PeriodTier } from "./or-cycle";

// ---------------------------------------------------------------------------
// Resample candles to an arbitrary timeframe (simple aggregation)
// ---------------------------------------------------------------------------

const TF_MINUTES: Record<EligibleTimeframe, number> = {
  "1mo": 0, "1w": 0, "1d": 1440,
  "12h": 720, "8h": 480, "6h": 360, "4h": 240, "3h": 180,
  "2h": 120, "1h": 60, "30m": 30, "20m": 20, "15m": 15,
  "10m": 10, "5m": 5, "3m": 3, "1m": 1,
};

/**
 * Aggregate a base candle series into a target timeframe.
 * For "1d" we align to UTC midnight. For intraday TFs we align to UTC hour buckets.
 * Returns an empty array if the source candles can't be aggregated (e.g. 1h
 * source can't produce 30m).
 *
 * NOTE: For the HORC opposition test, we typically have 1h source candles and
 * aggregate UP (1h → 4h, 1h → 12h, etc.). Down-sampling (1h → 30m) returns [].
 */
export function aggregateCandles(
  candles: Candle[],
  target: EligibleTimeframe,
): Candle[] {
  if (target === "1mo" || target === "1w") {
    // Aggregate by month or ISO week.
    const buckets = new Map<string, Candle[]>();
    for (const c of candles) {
      const key =
        target === "1mo"
          ? `${c.date.getUTCFullYear()}-${c.date.getUTCMonth()}`
          : `${isoWeekKey(c.date)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(c);
    }
    return [...buckets.values()].map(aggregateBucket).sort((a, b) => a.time - b.time);
  }

  const targetMins = TF_MINUTES[target];
  if (targetMins === 0) return [];

  // For target=1d, targetMins=1440. Bucket start = UTC midnight.
  // For intraday, bucket start = aligned to multiple of targetMins.
  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const unixMin = Math.floor(c.time / 60);
    let bucketStartMin: number;
    if (targetMins === 1440) {
      // Day bucket: UTC midnight.
      const d = new Date(c.time * 1000);
      const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      bucketStartMin = Math.floor(dayStart / 60000);
    } else {
      bucketStartMin = Math.floor(unixMin / targetMins) * targetMins;
    }
    if (!buckets.has(bucketStartMin)) buckets.set(bucketStartMin, []);
    buckets.get(bucketStartMin)!.push(c);
  }

  return [...buckets.values()]
    .map((cs) => aggregateBucket(cs))
    .sort((a, b) => a.time - b.time);
}

function aggregateBucket(cs: Candle[]): Candle {
  return {
    time: cs[0].time,
    date: cs[0].date,
    open: cs[0].open,
    high: Math.max(...cs.map((c) => c.high)),
    low: Math.min(...cs.map((c) => c.low)),
    close: cs[cs.length - 1].close,
    volume: cs.reduce((s, c) => s + c.volume, 0),
  };
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

// ---------------------------------------------------------------------------
// Opposition test for a single interval
// ---------------------------------------------------------------------------

export function testOppositionAt(
  candles: Candle[],
  interval: EligibleTimeframe,
  periodTier: PeriodTier,
  asOf: Date,
): OppositionResult | null {
  // Aggregate candles to the requested interval.
  const aggregated = aggregateCandles(candles, interval);
  if (aggregated.length < 3) return null;

  // Run period-boundary detection at this interval.
  // NOTE: For periodTier=daily, we want period boundaries at the start of each
  // UTC day. Aggregated candles at 1d interval → each candle IS a period.
  // At 12h interval → every 2 candles = 1 day. Etc.
  const cycles = registerAllCycles(aggregated, periodTier);
  if (cycles.length < 2) return null;

  // Find the period that contains `asOf`. If asOf is the latest, use the latest period.
  let targetCycle = cycles.find(
    (c) => asOf >= c.periodStart && asOf <= c.periodEnd,
  );
  if (!targetCycle) targetCycle = cycles[cycles.length - 1];

  const targetIdx = cycles.indexOf(targetCycle);
  if (targetIdx < 1) return null;

  const previousCycle = cycles[targetIdx - 1];

  // Check the gap exception FIRST (Ch 5 gap rule).
  // The gap must (a) exist between previous close and new open, (b) clear ORH/ORL,
  // (c) NOT be repaired by the first opening candle's body or wick.
  // If unrepaired, it registers the initial direction WITHOUT opposition test.
  const gapResult = testGapException(aggregated, previousCycle, targetCycle);
  if (gapResult.qualifies) {
    return {
      interval,
      previousClosing: previousCycle.finalParticipant,
      newRegistered: gapResult.registered,
      opposes: gapResult.registered !== previousCycle.finalParticipant,
      conclusive: true,
    };
  }

  // Standard opposition test
  const newFirst = targetCycle.registered; // first participant registered this period
  const prevClosing = previousCycle.finalParticipant;
  const opposes =
    newFirst !== null && prevClosing !== null && newFirst !== prevClosing;

  return {
    interval,
    previousClosing: prevClosing,
    newRegistered: newFirst,
    opposes,
    conclusive: opposes,
  };
}

// ---------------------------------------------------------------------------
// Gap exception test (Ch 5)
// ---------------------------------------------------------------------------

interface GapTestResult {
  qualifies: boolean;
  registered: Participant;  // "buyers" if gap up + clears ORH, "sellers" if gap down + clears ORL
  unrepaired: boolean;
}

function testGapException(
  aggregated: Candle[],
  prevCycle: { periodEnd: Date; finalParticipant: Participant; orh: number; orl: number },
  newCycle: { periodStart: Date; orh: number; orl: number; registered: Participant },
): GapTestResult {
  // Find the first candle of the new period.
  const firstNewCandle = aggregated.find((c) => c.date >= newCycle.periodStart);
  // Find the last candle of the previous period.
  const lastPrevCandle = [...aggregated]
    .reverse()
    .find((c) => c.date <= prevCycle.periodEnd);

  if (!firstNewCandle || !lastPrevCandle) {
    return { qualifies: false, registered: null, unrepaired: false };
  }

  const prevClose = lastPrevCandle.close;
  const newOpen = firstNewCandle.open;

  // Gap exists?
  const gapUp = newOpen > prevClose;
  const gapDown = newOpen < prevClose;
  if (!gapUp && !gapDown) {
    return { qualifies: false, registered: null, unrepaired: false };
  }

  // Must clear ORH (gap up) or ORL (gap down).
  // Per Ch 5: gap must clear the opening-range high or low of the new period.
  const clearsORH = gapUp && newOpen > newCycle.orh;
  const clearsORL = gapDown && newOpen < newCycle.orl;
  if (!clearsORH && !clearsORL) {
    return { qualifies: false, registered: null, unrepaired: false };
  }

  // Repair test: did the FIRST opening candle (by body OR wick) fill back to prevClose?
  const filledBack =
    firstNewCandle.low <= prevClose || firstNewCandle.high >= prevClose;
  // Specifically for gap up: filled back if firstNewCandle.low <= prevClose
  // For gap down: filled back if firstNewCandle.high >= prevClose
  const repaired = gapUp
    ? firstNewCandle.low <= prevClose
    : firstNewCandle.high >= prevClose;

  if (repaired) {
    return { qualifies: false, registered: null, unrepaired: false };
  }

  return {
    qualifies: true,
    registered: gapUp ? "buyers" : "sellers",
    unrepaired: true,
  };
}

// ---------------------------------------------------------------------------
// Top-level: walk the eligible hierarchy, return the highest conclusive TF
// ---------------------------------------------------------------------------

export interface OppositionHierarchyResult {
  tested: OppositionResult[];
  winner: OppositionResult | null;
}

export function findHighestConclusive(
  candles: Candle[],
  periodTier: PeriodTier,
  asOf: Date,
): OppositionHierarchyResult {
  const hierarchy =
    periodTier === "daily"
      ? ELIGIBLE_TF_HIERARCHY_DAILY
      : periodTier === "weekly"
        ? ELIGIBLE_TF_HIERARCHY_WEEKLY
        : ELIGIBLE_TF_HIERARCHY_MONTHLY;

  const tested: OppositionResult[] = [];
  for (const tf of hierarchy) {
    // Skip TFs shorter than the source candles (can't down-sample).
    // For source candles at 1h, we can only aggregate to ≥1h intervals.
    const result = testOppositionAt(candles, tf, periodTier, asOf);
    if (!result) continue;
    tested.push(result);
    if (result.conclusive) {
      return { tested, winner: result };
    }
  }
  return { tested, winner: null };
}
