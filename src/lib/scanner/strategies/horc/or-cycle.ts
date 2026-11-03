// src/lib/scanner/strategies/horc/or-cycle.ts
// HORC Chapter 3: Signals — the opening-range cycle.
//
// Per the HORC Visual Study Guide:
//   - "Start from the last closing candle."
//   - For the daily example: ORH = last 1h candle's high before new day opens.
//                          ORL = last 1h candle's low  before new day opens.
//   - It is NOT the first candle of the new period.
//   - "The first boundary cleared registers the first participant."
//   - 3-leg cycle: leg1 clears ORH/ORL → leg2 crosses the other boundary →
//     leg3 returns to clear the first-leg extreme (the ORT).
//   - The day doesn't have to finish all 3 legs.
//   - "A sell move can be sponsored by buyers" — during leg2 of a buyer cycle,
//     price moves down but participant label remains buyers.
//   - Flip point: low created during leg2 of buyer cycle. If crossed before
//     period close, participant flips to sellers. Time boundary is essential.
//
// This module:
//   1. Determines the last closing candle before each period boundary (D/W/M).
//   2. Computes ORH/ORL/ORT for each period.
//   3. Registers participants by walking the new period's candles.
//   4. Tracks leg1/leg2/leg3 extremes, flip points, and final participant.

import type { Candle } from "../../data";
import type {
  Participant,
  OpeningRangeCycle,
} from "./types";

// ---------------------------------------------------------------------------
// Period boundary detection
// ---------------------------------------------------------------------------

export type PeriodTier = "daily" | "weekly" | "monthly";

interface PeriodBoundary {
  periodStart: Date;
  periodEnd: Date;
  /** Index in the candle array of the LAST candle that CLOSED before periodStart. */
  closingCandleIndex: number;
  /** Index of the FIRST candle that belongs to this period. */
  firstCandleIndex: number;
  /** Index of the LAST candle that belongs to this period. */
  lastCandleIndex: number;
}

/** Returns true if two dates fall on the same calendar day (UTC). */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function sameWeek(a: Date, b: Date): boolean {
  // ISO week: week starts Monday. Compare year + week number.
  const aWeek = isoWeek(a);
  const bWeek = isoWeek(b);
  return aWeek.year === bWeek.year && aWeek.week === bWeek.week;
}

function sameMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
  );
}

function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/**
 * Identify all period boundaries in the candle array.
 * For each boundary we record:
 *   - The last candle that closed BEFORE the new period starts (the ORH/ORL source).
 *   - The first/last candles that belong to the new period.
 *
 * Per HORC Ch 3: "The reference is the last one-hour candle that closes
 * immediately before the new day opens." We generalise: the last candle of
 * the OBSERVATION timeframe that closed before the new period opens.
 */
export function detectPeriodBoundaries(
  candles: Candle[],
  tier: PeriodTier,
): PeriodBoundary[] {
  if (candles.length < 2) return [];
  const boundaries: PeriodBoundary[] = [];

  const samePeriod =
    tier === "daily" ? sameDay : tier === "weekly" ? sameWeek : sameMonth;

  // Walk candles. Whenever the period changes vs the previous candle, we have a boundary.
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (!samePeriod(prev.date, curr.date)) {
      // curr is the first candle of a new period.
      // prev is the last candle that closed before the new period.
      const periodStart = new Date(curr.date);
      // Find the end of this period (first candle of NEXT period, or last candle).
      let lastIdx = i;
      for (let j = i + 1; j < candles.length; j++) {
        if (!samePeriod(candles[j].date, curr.date)) break;
        lastIdx = j;
      }
      const periodEnd = new Date(candles[lastIdx].date);
      // For weekly/monthly, "period end" is the close of the last candle of the period.
      boundaries.push({
        periodStart,
        periodEnd,
        closingCandleIndex: i - 1,
        firstCandleIndex: i,
        lastCandleIndex: lastIdx,
      });
    }
  }

  return boundaries;
}

// ---------------------------------------------------------------------------
// OR-cycle registration
// ---------------------------------------------------------------------------

/**
 * Given a period boundary, walk the period's candles and register the
 * opening-range cycle per HORC Ch 3.
 *
 * Returns the OpeningRangeCycle record for that period.
 */
export function registerCycle(
  candles: Candle[],
  boundary: PeriodBoundary,
): OpeningRangeCycle {
  const closingCandle = candles[boundary.closingCandleIndex];
  const orh = closingCandle.high;
  const orl = closingCandle.low;

  // Walk the new period's candles in order.
  let firstCleared: "ORH" | "ORL" | null = null;
  let registered: Participant = null;
  let leg1Extreme: number | null = null;
  let leg2Extreme: number | null = null;
  let cycleComplete = false;
  let flipPoint: number | null = null;
  let flipped = false;
  let ort: number | null = null;

  const periodCandles = candles.slice(
    boundary.firstCandleIndex,
    boundary.lastCandleIndex + 1,
  );

  // Phase 1: detect which boundary was cleared first → registers participant.
  for (let i = 0; i < periodCandles.length; i++) {
    const c = periodCandles[i];
    if (firstCleared === null) {
      if (c.high > orh) {
        firstCleared = "ORH";
        registered = "buyers";
        leg1Extreme = c.high;
        ort = c.high; // first-leg extreme = ORT (Ch 3)
        break;
      }
      if (c.low < orl) {
        firstCleared = "ORL";
        registered = "sellers";
        leg1Extreme = c.low;
        ort = c.low;
        break;
      }
    }
  }

  if (firstCleared === null) {
    // No boundary cleared during the period — no participant registered.
    return {
      periodStart: boundary.periodStart,
      periodEnd: boundary.periodEnd,
      orh,
      orl,
      ort: null,
      firstCleared: null,
      registered: null,
      leg1Extreme: null,
      leg2Extreme: null,
      cycleComplete: false,
      flipPoint: null,
      flipped: false,
      finalParticipant: null,
    };
  }

  // Phase 2: continue walking to find leg 2 (crosses the OTHER boundary).
  // For a buyer cycle (first cleared ORH):
  //   leg 2 = price drops below ORL
  //   leg 2 extreme = the lowest low reached
  //   flip point = leg2Extreme (if crossed back down before periodEnd, flips to sellers)
  //   leg 3 = price returns above leg1Extreme (ORT)
  if (firstCleared === "ORH") {
    for (let i = 0; i < periodCandles.length; i++) {
      const c = periodCandles[i];
      if (leg2Extreme === null && c.low < orl) {
        leg2Extreme = c.low;
        flipPoint = c.low;
      }
      if (leg2Extreme !== null) {
        // Update leg2 extreme if price keeps dropping
        if (c.low < leg2Extreme) {
          leg2Extreme = c.low;
          flipPoint = c.low;
        }
        // Check cycle completion: returns above leg1Extreme (ORT)
        if (c.high > (leg1Extreme as number)) {
          cycleComplete = true;
          break;
        }
        // Check flip: drops below flipPoint again (after leg2)
        // Note: flipPoint IS leg2Extreme here, so "drops below flipPoint" means
        // a NEW low below the previous leg2 low. We treat each new low as a
        // potential flip confirmation if it occurs AFTER the cycle tried to
        // complete. For simplicity, we only confirm a flip if cycle was complete
        // AND price then drops below flipPoint.
        if (cycleComplete && c.low < (flipPoint as number)) {
          flipped = true;
          break;
        }
      }
    }
  } else {
    // firstCleared === "ORL" → seller cycle
    for (let i = 0; i < periodCandles.length; i++) {
      const c = periodCandles[i];
      if (leg2Extreme === null && c.high > orh) {
        leg2Extreme = c.high;
        flipPoint = c.high;
      }
      if (leg2Extreme !== null) {
        if (c.high > leg2Extreme) {
          leg2Extreme = c.high;
          flipPoint = c.high;
        }
        if (c.low < (leg1Extreme as number)) {
          cycleComplete = true;
          break;
        }
        if (cycleComplete && c.high > (flipPoint as number)) {
          flipped = true;
          break;
        }
      }
    }
  }

  const finalParticipant: Participant = flipped
    ? registered === "buyers"
      ? "sellers"
      : "buyers"
    : registered;

  return {
    periodStart: boundary.periodStart,
    periodEnd: boundary.periodEnd,
    orh,
    orl,
    ort,
    firstCleared,
    registered,
    leg1Extreme,
    leg2Extreme,
    cycleComplete,
    flipPoint,
    flipped,
    finalParticipant,
  };
}

// ---------------------------------------------------------------------------
// Batch: register cycles for ALL periods in the candle array
// ---------------------------------------------------------------------------

export function registerAllCycles(
  candles: Candle[],
  tier: PeriodTier,
): OpeningRangeCycle[] {
  const boundaries = detectPeriodBoundaries(candles, tier);
  return boundaries.map((b) => registerCycle(candles, b));
}

// ---------------------------------------------------------------------------
// Convenience: get the participant sign at a specific date
// ---------------------------------------------------------------------------

export function participantAt(
  cycles: OpeningRangeCycle[],
  date: Date,
): Participant {
  // Find the cycle whose period contains `date`.
  for (const cyc of cycles) {
    if (date >= cyc.periodStart && date <= cyc.periodEnd) {
      return cyc.finalParticipant;
    }
  }
  return null;
}
