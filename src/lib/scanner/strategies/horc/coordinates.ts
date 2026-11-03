// src/lib/scanner/strategies/horc/coordinates.ts
// HORC Chapter 4: Coordinates — compare passive and aggressor across time.
//
// Per the HORC Visual Study Guide:
//   - "The video first imagines writing the signals at one high from the year
//     down through the month, week and day, and potentially a session."
//   - Coordinates narrow that list to the relationship between TWO points:
//     the passive (origin) and the aggressor (move that violates it).
//   - "+" = buyers, "−" = sellers. M, W, D = month, week, day.
//   - "The same selected categories appear on both sides of the comparison
//     so that like is compared with like."
//   - Year is OMITTED only if yearly participant did NOT flip between the two
//     points. (Calendar membership and participant continuity are separate checks.)
//
// This module:
//   1. Given a passive date and an aggressor date, builds their coordinate lists.
//   2. Compares them tier-by-tier (highest tier first).
//   3. Returns the highest tier where signs oppose (the "qualifying" tier for
//      liquidity classification in Ch 6).

import type { Candle } from "../../data";
import type {
  Coordinate,
  CoordinateComparison,
  CoordTier,
  CoordSign,
  Participant,
} from "./types";
import {
  registerAllCycles,
  participantAt,
  type PeriodTier,
} from "./or-cycle";

// ---------------------------------------------------------------------------
// Build a coordinate list at a single point in time
// ---------------------------------------------------------------------------

interface CycleCache {
  daily: ReturnType<typeof registerAllCycles>;
  weekly: ReturnType<typeof registerAllCycles>;
  monthly: ReturnType<typeof registerAllCycles>;
}

function buildCycleCache(candles: Candle[]): CycleCache {
  return {
    daily: registerAllCycles(candles, "daily"),
    weekly: registerAllCycles(candles, "weekly"),
    monthly: registerAllCycles(candles, "monthly"),
  };
}

function signFor(participant: Participant): CoordSign | null {
  if (participant === "buyers") return "+";
  if (participant === "sellers") return "-";
  return null;
}

/**
 * Build the coordinate list at a given date.
 * Walks M, W, D and records the participant sign for each tier at that date.
 * The year tier is included if we want to test the unchanged-year condition
 * (Ch 4 explicit qualification).
 */
export function buildCoordinates(
  date: Date,
  cache: CycleCache,
  includeYear: boolean = false,
): Coordinate[] {
  const coords: Coordinate[] = [];

  if (includeYear) {
    // Yearly participant = the participant at the END of the year (Dec 31 23:59 UTC).
    // We approximate by using the monthly cycle for December of that year.
    const decCycles = cache.monthly.filter(
      (c) =>
        c.periodStart.getUTCFullYear() === date.getUTCFullYear() &&
        c.periodStart.getUTCMonth() === 11,
    );
    if (decCycles.length > 0) {
      const lastDec = decCycles[decCycles.length - 1];
      const sign = signFor(lastDec.finalParticipant);
      if (sign) {
        coords.push({
          tier: "Y",
          sign,
          periodStart: lastDec.periodStart,
          periodEnd: lastDec.periodEnd,
        });
      }
    }
  }

  // Monthly
  const monthCycle = cache.monthly.find(
    (c) => date >= c.periodStart && date <= c.periodEnd,
  );
  if (monthCycle && monthCycle.finalParticipant) {
    const sign = signFor(monthCycle.finalParticipant);
    if (sign) {
      coords.push({
        tier: "M",
        sign,
        periodStart: monthCycle.periodStart,
        periodEnd: monthCycle.periodEnd,
      });
    }
  }

  // Weekly
  const weekCycle = cache.weekly.find(
    (c) => date >= c.periodStart && date <= c.periodEnd,
  );
  if (weekCycle && weekCycle.finalParticipant) {
    const sign = signFor(weekCycle.finalParticipant);
    if (sign) {
      coords.push({
        tier: "W",
        sign,
        periodStart: weekCycle.periodStart,
        periodEnd: weekCycle.periodEnd,
      });
    }
  }

  // Daily
  const dayCycle = cache.daily.find(
    (c) => date >= c.periodStart && date <= c.periodEnd,
  );
  if (dayCycle && dayCycle.finalParticipant) {
    const sign = signFor(dayCycle.finalParticipant);
    if (sign) {
      coords.push({
        tier: "D",
        sign,
        periodStart: dayCycle.periodStart,
        periodEnd: dayCycle.periodEnd,
      });
    }
  }

  return coords;
}

// ---------------------------------------------------------------------------
// Compare passive vs aggressor coordinates
// ---------------------------------------------------------------------------

const TIER_RANK: Record<CoordTier, number> = { Y: 4, M: 3, W: 2, D: 1 };

/**
 * Given two coordinate lists (passive + aggressor), compare them tier by tier.
 *
 * Returns:
 *   - highestOpposingTier: the highest tier where signs differ (e.g. W- vs W+ → "W")
 *   - allMatch: true if every shared tier has the same sign on both sides
 *
 * If the year tier matches on both sides AND no flip occurred in between
 * (verified separately), we can OMIT the year from the comparison per Ch 4.
 * If year signs differ, year is the highest opposing tier.
 */
export function compareCoordinates(
  passive: Coordinate[],
  aggressor: Coordinate[],
  opts: { omitYearIfMatch?: boolean } = {},
): CoordinateComparison {
  const omitYearIfMatch = opts.omitYearIfMatch ?? true;

  // Filter the passive + aggressor to shared tiers.
  const passiveTiers = new Set(passive.map((c) => c.tier));
  const aggressorTiers = new Set(aggressor.map((c) => c.tier));
  const sharedTiers = [...passiveTiers].filter((t) => aggressorTiers.has(t));

  let filteredPassive = passive.filter((c) => sharedTiers.includes(c.tier));
  let filteredAggressor = aggressor.filter((c) => sharedTiers.includes(c.tier));

  // Optional year omission: if year signs MATCH on both sides, omit year.
  if (omitYearIfMatch && sharedTiers.includes("Y")) {
    const yPassive = filteredPassive.find((c) => c.tier === "Y");
    const yAggressor = filteredAggressor.find((c) => c.tier === "Y");
    if (yPassive && yAggressor && yPassive.sign === yAggressor.sign) {
      filteredPassive = filteredPassive.filter((c) => c.tier !== "Y");
      filteredAggressor = filteredAggressor.filter((c) => c.tier !== "Y");
    }
  }

  // Find highest opposing tier.
  let highestOpposingTier: CoordTier | null = null;
  let highestRank = 0;
  let allMatch = true;

  for (const tier of filteredPassive.map((c) => c.tier)) {
    const p = filteredPassive.find((c) => c.tier === tier);
    const a = filteredAggressor.find((c) => c.tier === tier);
    if (!p || !a) continue;
    if (p.sign !== a.sign) {
      allMatch = false;
      const rank = TIER_RANK[tier];
      if (rank > highestRank) {
        highestRank = rank;
        highestOpposingTier = tier;
      }
    }
  }

  return {
    passive: filteredPassive,
    aggressor: filteredAggressor,
    highestOpposingTier,
    allMatch,
  };
}

// ---------------------------------------------------------------------------
// Top-level: build comparison between two dates
// ---------------------------------------------------------------------------

export interface CoordinateResult {
  passive: Coordinate[];
  aggressor: Coordinate[];
  comparison: CoordinateComparison;
}

export function buildComparison(
  candles: Candle[],
  passiveDate: Date,
  aggressorDate: Date,
): CoordinateResult {
  const cache = buildCycleCache(candles);
  const passive = buildCoordinates(passiveDate, cache, true);
  const aggressor = buildCoordinates(aggressorDate, cache, true);
  const comparison = compareCoordinates(passive, aggressor);
  return { passive, aggressor, comparison };
}

// ---------------------------------------------------------------------------
// Convenience: convert a CoordTier to a LiquidityTier name (Ch 6 mapping)
// ---------------------------------------------------------------------------

export function tierToLiquidityName(tier: CoordTier | null): "monthly" | "weekly" | "daily" | null {
  if (tier === "Y" || tier === "M") return "monthly";
  if (tier === "W") return "weekly";
  if (tier === "D") return "daily";
  return null;
}
