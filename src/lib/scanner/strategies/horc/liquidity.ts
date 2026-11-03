// src/lib/scanner/strategies/horc/liquidity.ts
// HORC Chapters 6-7: Liquidity — opposite participants and conditions.
//
// Per the HORC Visual Study Guide:
//   Ch 6:
//   - "The highest coordinate must oppose" → name liquidity after that tier.
//   - "If the highest category is monthly, its opposition establishes monthly
//     liquidity instead."
//   - Condition 1 (diagonal rule): the missing lower-coordinate participant must
//     be delivered through an EXHAUSTIVE move beyond the relevant previous extreme.
//     "Merely seeing a D− label somewhere below the last high is not enough."
//   - Condition 2: price must reach a valid zone of the right scale to sponsor
//     the reversal.
//   Ch 7:
//   - Internal/external liquidity: internal = permanent/absolute structure;
//     external = relative/temporary.
//   - "Once its highest coordinate qualifies, its classification is not removed
//     simply because price travels farther away while seeking the remaining conditions."
//   - Premium/discount priority: determined by FORMATION SEQUENCE, not tier size.
//     A daily liquidity point can take priority over a later weekly one.

import type { Candle } from "../../data";
import type {
  Coordinate,
  CoordinateComparison,
  LiquidityPoint,
  LiquidityTier,
  LiquidityKind,
  CoordTier,
  Participant,
  Zone,
} from "./types";
import type { MoveStructure } from "./types";
import { tierToLiquidityName } from "./coordinates";

// ---------------------------------------------------------------------------
// Classify liquidity from a coordinate comparison
// ---------------------------------------------------------------------------

/**
 * Given a passive/aggressor coordinate comparison, classify the liquidity point.
 *
 * Per Ch 6: the highest tier where signs OPPOSE determines the liquidity tier
 * name. If no tier opposes, there is no liquidity classification.
 *
 * The liquidity point lives at the external extreme of the move:
 *   - For a buy move (origin=low, aggressor up): the external HIGH is the liquidity
 *   - For a sell move (origin=high, aggressor down): the external LOW is the liquidity
 */
export function classifyLiquidity(
  move: MoveStructure,
  comparison: CoordinateComparison,
): LiquidityPoint | null {
  if (comparison.allMatch || !comparison.highestOpposingTier) {
    return null;
  }

  const tierName = tierToLiquidityName(comparison.highestOpposingTier);
  if (!tierName) return null;

  const isPermanent = move.isPermanent;
  const kind: LiquidityKind = isPermanent ? "internal" : "external";

  const externalExtreme = move.externalExtreme;
  const lastPrice = move.origin.price; // we'll override below
  // direction: where is the liquidity point relative to current price?
  // For a bullish move (origin=low, externalExtreme=high): liquidity is ABOVE
  // For a bearish move (origin=high, externalExtreme=low): liquidity is BELOW
  const direction: "above" | "below" =
    move.direction === "bullish" ? "above" : "below";

  // Find the missing lower coordinate (Ch 6 condition 1).
  // We have tiers Y/M/W/D in the comparison. The highest OPPOSING tier is set.
  // For tiers BELOW the highest opposing tier, find any tier where signs MATCH
  // between passive and aggressor. That's the "missing lower participant" that
  // needs to be delivered via the diagonal rule.
  const missingTiers: CoordTier[] = [];
  const highestRank = comparison.highestOpposingTier;
  for (const passiveCoord of comparison.passive) {
    if (passiveCoord.tier === highestRank) continue;
    const aggressorCoord = comparison.aggressor.find(
      (c) => c.tier === passiveCoord.tier,
    );
    if (aggressorCoord && aggressorCoord.sign === passiveCoord.sign) {
      missingTiers.push(passiveCoord.tier);
    }
  }
  // Pick the highest-ranking missing tier (e.g. if W and D both match, prefer W).
  const tierRank: Record<CoordTier, number> = { Y: 4, M: 3, W: 2, D: 1 };
  missingTiers.sort((a, b) => tierRank[b] - tierRank[a]);
  const missingLowerCoord = missingTiers[0] ?? null;

  return {
    tier: tierName as LiquidityTier,
    kind,
    price: externalExtreme.price,
    date: externalExtreme.date,
    direction,
    sponsorZone: null,            // populated later by Ch 10 AOI logic
    missingLowerCoord,
    diagonalDelivered: false,     // populated by checkDiagonalRule below
  };
}

// ---------------------------------------------------------------------------
// Diagonal rule (Ch 6 condition 1)
// ---------------------------------------------------------------------------

/**
 * Per Ch 6: "The required lower participant must be delivered through an
 * exhaustive move beyond the relevant previous extreme. In the upward
 * aggressor example, merely seeing a D− label somewhere below the last high
 * is not enough: the D− must be associated with a move that trades ABOVE the
 * relevant earlier high."
 *
 * This function checks: after the aggressor move begins, did price make an
 * EXHAUSTIVE move beyond the relevant previous extreme (signalling the missing
 * lower-tier participant has been delivered)?
 *
 * For a bullish aggressor (origin=low, aggressor up):
 *   - missing W+ (for example) must be delivered by price trading above the
 *     relevant earlier high (e.g. previous weekly high).
 *   - We check: has price exceeded the highest high of the N candles before
 *     the aggressor move started?
 *
 * For a bearish aggressor (origin=high, aggressor down): mirror.
 */
export function checkDiagonalRule(
  candles: Candle[],
  move: MoveStructure,
  liquidity: LiquidityPoint,
): boolean {
  if (!liquidity.missingLowerCoord) {
    // No missing lower coordinate → diagonal rule auto-satisfied.
    return true;
  }

  const originIdx = move.origin.index;
  if (originIdx < 2 || originIdx >= candles.length) return false;

  // Look at candles AFTER the origin (the aggressor move).
  const afterOrigin = candles.slice(originIdx + 1);
  if (afterOrigin.length < 5) return false;

  // "Relevant previous extreme" — the highest high (bullish) or lowest low
  // (bearish) in the 50 candles before the origin.
  const lookback = 50;
  const beforeOrigin = candles.slice(Math.max(0, originIdx - lookback), originIdx);
  if (beforeOrigin.length === 0) return false;

  if (move.direction === "bullish") {
    const relevantHigh = Math.max(...beforeOrigin.map((c) => c.high));
    // Has the aggressor move traded above this high?
    const exceeded = afterOrigin.some((c) => c.high > relevantHigh);
    return exceeded;
  } else {
    const relevantLow = Math.min(...beforeOrigin.map((c) => c.low));
    const breached = afterOrigin.some((c) => c.low < relevantLow);
    return breached;
  }
}

// ---------------------------------------------------------------------------
// Premium/discount priority (Ch 7)
// ---------------------------------------------------------------------------

/**
 * Per Ch 7: "An earlier-formed daily liquidity point can take priority over
 * a later weekly one. The timeframe name alone does not make a weekly point
 * the more important target. Read the order and arrangement of the liquidity
 * points."
 *
 * Given multiple liquidity points, sort by formation sequence (earlier first)
 * and return the priority order. The first one is the most premium target.
 */
export function prioritizeLiquidityPoints(
  points: LiquidityPoint[],
): LiquidityPoint[] {
  return [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Per Ch 7: trace which intermediate liquidity points would be cleared on the
 * route from current price to the priority target. These are "consequence"
 * targets, not separate zone-sponsored moves.
 */
export function traceIntermediateTargets(
  currentPrice: number,
  priorityTarget: LiquidityPoint,
  allPoints: LiquidityPoint[],
): LiquidityPoint[] {
  // For a long target (direction="above"): all points between currentPrice
  // and priorityTarget.price, sorted ascending.
  // For a short target (direction="below"): all points between, sorted descending.
  if (priorityTarget.direction === "above") {
    return allPoints
      .filter(
        (p) =>
          p.direction === "above" &&
          p.price > currentPrice &&
          p.price < priorityTarget.price &&
          p !== priorityTarget,
      )
      .sort((a, b) => a.price - b.price);
  } else {
    return allPoints
      .filter(
        (p) =>
          p.direction === "below" &&
          p.price < currentPrice &&
          p.price > priorityTarget.price &&
          p !== priorityTarget,
      )
      .sort((a, b) => b.price - a.price);
  }
}

// ---------------------------------------------------------------------------
// Find sponsor zone for a liquidity point (Ch 7 + Ch 10 link)
// ---------------------------------------------------------------------------

/**
 * Per Ch 7 condition 2: "weekly liquidity requires a valid weekly zone to
 * sponsor the reversal toward it." This function takes a list of candidate
 * zones (from Ch 8 detection) and finds the one that:
 *   1. Matches the liquidity tier (e.g. weekly zone for weekly liquidity)
 *   2. Is in the right direction (supply for short liquidity, demand for long)
 *   3. Is currently ACTIVE (not mitigated)
 */
export function findSponsorZone(
  liquidity: LiquidityPoint,
  candidateZones: Zone[],
): Zone | null {
  const matchingTier = candidateZones.filter(
    (z) =>
      z.sponsoredLiquidity === liquidity.tier &&
      z.state === "active" &&
      // Direction match: bullish liquidity (above) needs demand zone (buyers raid sellers)
      // bearish liquidity (below) needs supply zone (sellers raid buyers)
      liquidity.direction === "above"
        ? z.role === "demand"
        : z.role === "supply",
  );
  // Pick the most recently-formed matching zone
  matchingTier.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return matchingTier[0] ?? null;
}
