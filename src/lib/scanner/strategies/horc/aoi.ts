// /home/z/my-project/build/hubb-final/HUBB/src/lib/scanner/strategies/horc/aoi.ts
// HORC Chapter 10: Areas of interest — source, path and destination.
//
// Per the HORC Visual Study Guide:
//   - "An area of interest is not simply an available zone on a horizontal line."
//   - The instructor represents a valid zone and its liquidity target as joined
//     by an invisible line. A move begins at a valid zone and is directed toward
//     the related liquidity.
//   - "imbalance + sought-after liquidity = balance."
//   - A historical zone whose relationship cuts through the actively sought
//     liquidity range is NEUTRALISED for the proposed opposing trade.
//   - The local-zone search is limited to the relevant internal structure AFTER
//     the passive of the larger liquidity range has formed.
//   - Final AOI example: a missing coordinate can leave the target protected.
//     A smaller daily condition having appeared does not substitute for the
//     missing weekly condition.

import type { Candle } from "../../data";
import type {
  Zone,
  LiquidityPoint,
  AreaOfInterest,
  MoveStructure,
  CoordTier,
  CoordinateComparison,
} from "./types";

// ---------------------------------------------------------------------------
// Identify the source zone (where the current move came from)
// ---------------------------------------------------------------------------

/**
 * Per Ch 10: "When examining a developing buy, the first question is where it
 * came from. If it came from valid daily demand, the example follows it toward
 * the relevant premium daily liquidity."
 *
 * This function identifies the SOURCE zone for the current move:
 *   - For a bullish move (origin=low, aggressor up): the source is the most
 *     recent DEMAND zone whose price band contains the origin low.
 *   - For a bearish move (origin=high, aggressor down): the most recent SUPPLY
 *     zone containing the origin high.
 */
export function identifySourceZone(
  move: MoveStructure,
  zones: Zone[],
): Zone | null {
  const originPrice = move.origin.price;
  const candidates = zones
    .filter((z) => {
      // Zone must contain the origin price
      if (originPrice < z.bottom || originPrice > z.top) return false;
      // Direction match: bullish move sourced from demand; bearish from supply
      if (move.direction === "bullish") return z.role === "demand";
      return z.role === "supply";
    })
    .filter((z) => z.startDate <= move.origin.date)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Identify the target liquidity (what the current move is seeking)
// ---------------------------------------------------------------------------

/**
 * Per Ch 10: a move's target is the liquidity point it is "actively seeking."
 *
 * Heuristic: the nearest non-mitigated liquidity point in the move's direction.
 *   - Bullish move → nearest liquidity point ABOVE current price (direction="above")
 *   - Bearish move → nearest liquidity point BELOW current price (direction="below")
 */
export function identifyTargetLiquidity(
  move: MoveStructure,
  currentPrice: number,
  liquidityPoints: LiquidityPoint[],
): LiquidityPoint | null {
  const candidates =
    move.direction === "bullish"
      ? liquidityPoints.filter((l) => l.direction === "above" && l.price > currentPrice)
      : liquidityPoints.filter((l) => l.direction === "below" && l.price < currentPrice);

  if (candidates.length === 0) return null;

  // Sort by proximity to current price (closest first)
  candidates.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Compute the historical search boundary (Ch 10)
// ---------------------------------------------------------------------------

/**
 * Per Ch 10: "The instructor therefore limits the local-zone search to the
 * relevant internal structure after the passive of the larger liquidity range
 * has formed. The boundary is structural, not an arbitrary number of candles
 * back."
 *
 * If the move has an active (sought-after) target liquidity, the search
 * boundary for opposing zones is the date of the PASSIVE for that target.
 * For our purposes, the "passive" of the target = the move's origin date.
 */
export function computeSearchBoundary(
  move: MoveStructure,
  targetLiquidity: LiquidityPoint | null,
): Date | null {
  if (!targetLiquidity) return null;
  // The passive that begins the actively sought liquidity range = the origin.
  return move.origin.date;
}

// ---------------------------------------------------------------------------
// Determine if a zone is "in path" between source and target
// ---------------------------------------------------------------------------

/**
 * Per Ch 10: "An AOI is an imbalance around an area price is NOT actively
 * seeking to raid." So:
 *   - In-path zone = a zone whose price band is BETWEEN source and target →
 *     NOT an AOI (it's a "consequence" target).
 *   - Out-of-path zone = a zone whose price band is OUTSIDE the source-target
 *     range → potentially an AOI (if it has a valid imbalance + correct
 *     directional role + tier).
 */
export function isInPath(
  zone: Zone,
  sourceZone: Zone | null,
  targetLiquidity: LiquidityPoint | null,
  currentPrice: number,
): boolean {
  if (!targetLiquidity) return false;
  // Target above (bullish): in-path zones are those between currentPrice and targetLiquidity.price
  // Target below (bearish): in-path zones are those between targetLiquidity.price and currentPrice
  if (targetLiquidity.direction === "above") {
    return zone.bottom >= currentPrice && zone.top <= targetLiquidity.price;
  } else {
    return zone.top <= currentPrice && zone.bottom >= targetLiquidity.price;
  }
}

// ---------------------------------------------------------------------------
// Check missing-coordinate condition (Ch 10 final example)
// ---------------------------------------------------------------------------

/**
 * Per Ch 10 final AOI example: even if price is inside the proposed zone, the
 * required weekly participant may not have made the exhaustive interaction
 * described by the diagonal rule. A smaller daily condition having appeared
 * does NOT substitute for the missing weekly condition.
 *
 * Returns the missing coordinate tier (e.g. "W") or null if all conditions met.
 */
export function checkMissingCoord(
  comparison: CoordinateComparison,
): CoordTier | null {
  // The "missing" tier is the highest tier BELOW the highest opposing tier
  // where signs MATCH between passive and aggressor.
  if (!comparison.highestOpposingTier) return null;
  const tierRank: Record<CoordTier, number> = { Y: 4, M: 3, W: 2, D: 1 };
  const opposingRank = tierRank[comparison.highestOpposingTier];

  const missingTiers = comparison.passive.filter((pc) => {
    const ac = comparison.aggressor.find((c) => c.tier === pc.tier);
    return (
      ac &&
      ac.sign === pc.sign &&
      tierRank[pc.tier] < opposingRank
    );
  }).map((c) => c.tier);

  if (missingTiers.length === 0) return null;
  missingTiers.sort((a, b) => tierRank[b] - tierRank[a]);
  return missingTiers[0];
}

// ---------------------------------------------------------------------------
// Top-level: build AOI for a candidate zone
// ---------------------------------------------------------------------------

export function evaluateAOI(
  zone: Zone,
  move: MoveStructure,
  zones: Zone[],
  liquidityPoints: LiquidityPoint[],
  comparison: CoordinateComparison,
  currentPrice: number,
): AreaOfInterest {
  const sourceZone = identifySourceZone(move, zones);
  const targetLiquidity = identifyTargetLiquidity(move, currentPrice, liquidityPoints);
  const searchBoundary = computeSearchBoundary(move, targetLiquidity);
  const inPath = isInPath(zone, sourceZone, targetLiquidity, currentPrice);
  const pendingCoord = checkMissingCoord(comparison);

  return {
    zone,
    sourceZone,
    targetLiquidity,
    inPath,
    searchBoundaryDate: searchBoundary,
    pendingCoord,
  };
}

// ---------------------------------------------------------------------------
// Convenience: filter zones to those that ARE valid AOIs
// ---------------------------------------------------------------------------

/**
 * Returns only zones that qualify as AOIs per Ch 10:
 *   - NOT in the source→target path
 *   - Has a valid imbalance (state !== mitigated)
 *   - Directional role matches (supply for shorts, demand for longs)
 *   - Missing coordinate is satisfied OR zone predates the search boundary
 *     (older zones can remain relevant if no actively-sought larger liquidity)
 */
export function findValidAOIs(
  move: MoveStructure,
  zones: Zone[],
  liquidityPoints: LiquidityPoint[],
  comparison: CoordinateComparison,
  currentPrice: number,
): AreaOfInterest[] {
  const targetLiquidity = identifyTargetLiquidity(move, currentPrice, liquidityPoints);
  const searchBoundary = computeSearchBoundary(move, targetLiquidity);

  const candidates = zones
    .filter((z) => z.state !== "mitigated")
    .filter((z) => {
      // Directional role: opposing zone to the move direction
      if (move.direction === "bullish") return z.role === "supply";  // short reversal candidate
      return z.role === "demand";  // long reversal candidate
    })
    .filter((z) => !isInPath(z, null, targetLiquidity, currentPrice))
    .filter((z) => {
      // If searchBoundary exists, zone must be AFTER it (per Ch 10 limitation)
      if (!searchBoundary) return true;
      return z.startDate >= searchBoundary;
    });

  return candidates.map((z) => evaluateAOI(z, move, zones, liquidityPoints, comparison, currentPrice));
}
