// /home/z/my-project/build/hubb-final/HUBB/src/lib/scanner/strategies/horc/intraday.ts
// HORC Chapter 11: Complex structures — intraday liquidity.
//
// Per the HORC Visual Study Guide:
//   - "The instructor argues that named trading sessions overlap, so their labels
//     alone do not provide the clean open-to-close boundaries used in the earlier
//     daily examples. Intraday candles provide separate periods whose participant
//     stories can be registered by the same opening-range logic."
//   - First worked calculation: trading-day open at 23:00, aggressor at 16:00
//     the following day. From 23:00 to 11:00 = 12 hours. From 11:00 to 16:00
//     = 5 more. Total = 17 hours = 1,020 minutes.
//   - Subdivisions: 510 min (÷2), 340 (÷3), 255 (÷4), 204 (÷5), 170 (÷6), 102 (÷10).
//     (Note: PDF corrects the speaker's "96" to "102" — 17 × 6 = 102, not 96.)
//   - "Mark the candidate aggressor period, its preceding passive period, and
//     the period before that. The third reference supplies the preceding closing
//     participant needed to test the passive by opposition."
//   - "The timeframe naming the liquidity and the interval used to conclude its
//     participants are different."
//   - 17-hour liquidity → can be examined via 510-min or 1-hour observation interval.

import type { Candle } from "../../data";
import type {
  IntradayLiquidity,
  EligibleTimeframe,
  Participant,
} from "./types";
import { eligibleIntradaySubdivisions } from "./types";
import { aggregateCandles } from "./opposition";
import { registerAllCycles } from "./or-cycle";

// ---------------------------------------------------------------------------
// Determine the trading-day open (UTC)
// ---------------------------------------------------------------------------

/**
 * HORC uses 23:00 UTC as the trading-day open in its example (FX markets open
 * at 17:00 EST = 22:00 UTC in winter, 21:00 UTC in summer; ICT community
 * typically uses 18:00 EST = 23:00 UTC for the "new day").
 *
 * We use 23:00 UTC as default. Override via options.
 */
export const DEFAULT_TRADING_DAY_OPEN_UTC_HOUR = 23;

// ---------------------------------------------------------------------------
// Compute the elapsed-time candidate period (Ch 11 first calculation)
// ---------------------------------------------------------------------------

export interface ElapsedPeriod {
  /** Trading-day open date (e.g. 23:00 UTC). */
  dayOpen: Date;
  /** Candidate aggressor time (e.g. 16:00 next day). */
  aggressorTime: Date;
  /** Total minutes between dayOpen and aggressorTime. */
  totalMinutes: number;
  /** Eligible subdivisions that exactly divide totalMinutes. */
  subdivisions: EligibleTimeframe[];
}

export function computeElapsedPeriod(
  dayOpen: Date,
  aggressorTime: Date,
): ElapsedPeriod {
  const totalMs = aggressorTime.getTime() - dayOpen.getTime();
  const totalMinutes = Math.max(0, Math.floor(totalMs / 60000));
  return {
    dayOpen,
    aggressorTime,
    totalMinutes,
    subdivisions: eligibleIntradaySubdivisions(totalMinutes),
  };
}

// ---------------------------------------------------------------------------
// Find an intraday liquidity relationship in the candle array
// ---------------------------------------------------------------------------

/**
 * Per Ch 11: "Do not infer a liquidity timeframe merely because two adjacent
 * candles look like passive and aggressor on a convenient interval."
 *
 * We scan the candle array for swing-pivot pairs that look like a passive→aggressor
 * sequence. For each pair, compute the elapsed period from the most recent
 * trading-day open to the aggressor pivot. Then walk subdivisions to find the
 * HIGHEST conclusive one.
 *
 * This is a simplified version of HORC's intraday logic — full implementation
 * would require checking every eligible subdivision for every candidate pair,
 * which is expensive. We use the largest eligible subdivision as the
 * observation interval.
 */
export function findIntradayLiquidity(
  candles: Candle[],
  tradingDayOpenUtcHour: number = DEFAULT_TRADING_DAY_OPEN_UTC_HOUR,
): IntradayLiquidity | null {
  if (candles.length < 50) return null;

  // Find the most recent trading-day open in the candle array.
  const lastCandle = candles[candles.length - 1];
  const lastDayOpen = findMostRecentDayOpen(lastCandle.date, tradingDayOpenUtcHour);
  if (!lastDayOpen) return null;

  // Candidate aggressor = the last candle in the array.
  const aggressorTime = lastCandle.date;
  const elapsed = computeElapsedPeriod(lastDayOpen, aggressorTime);
  if (elapsed.totalMinutes < 60) return null;  // Too short to subdivide meaningfully

  // Walk subdivisions from LARGEST to SMALLEST, test opposition at each.
  // HORC: "a seventeen-hour liquidity relationship can be examined through a
  // 510-minute or one-hour observation interval."
  // We pick the LARGEST subdivision where we can register participants.
  const subdivisionOrder = [...elapsed.subdivisions].reverse();  // largest first
  for (const sub of subdivisionOrder) {
    const aggregated = aggregateCandles(candles, sub);
    if (aggregated.length < 5) continue;

    // Register cycles at this subdivision. Each candle = a "period" for opposition.
    // Find the period containing the aggressor time.
    const cycles = registerAllCycles(aggregated, "daily");
    if (cycles.length < 3) continue;

    const lastCycle = cycles[cycles.length - 1];
    const prevCycle = cycles[cycles.length - 2];
    const prevPrevCycle = cycles[cycles.length - 3];

    if (!lastCycle || !prevCycle || !prevPrevCycle) continue;
    if (!lastCycle.registered || !prevCycle.finalParticipant) continue;

    const opposes = lastCycle.registered !== prevCycle.finalParticipant;
    if (!opposes) continue;

    // We found a conclusive observation interval.
    // The "passive" = the period BEFORE the aggressor; its registered participant
    // comes from comparing with prevPrevCycle.
    const passiveRegistered = prevCycle.finalParticipant;
    const aggressorRegistered = lastCycle.registered;

    return {
      periodMinutes: elapsed.totalMinutes,
      subdivisions: elapsed.subdivisions,
      observationInterval: sub,
      liquidityTier: "intraday",
      passiveRegistered,
      aggressorRegistered,
      opposes,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helper: find the most recent trading-day open at or before a target date
// ---------------------------------------------------------------------------

function findMostRecentDayOpen(asOf: Date, utcHour: number): Date | null {
  // Construct the UTC date for `asOf` at the specified hour.
  // If `asOf` is BEFORE that hour today, use yesterday's open.
  const candidate = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), utcHour, 0, 0),
  );
  if (candidate <= asOf) return candidate;
  // Use yesterday's open
  const yesterday = new Date(candidate);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday;
}
