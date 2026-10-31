// /home/z/my-project/build/hubb-final/HUBB/src/lib/scanner/strategies/horc/zones.ts
// HORC Chapters 8-9: Zones — active liquidity becomes a barrier; mitigation.
//
// Per the HORC Visual Study Guide:
//   Ch 8:
//   - Active liquidity = unabsorbed liquidity point (from Ch 6).
//   - When active liquidity is raided/absorbed → becomes PASSIVE liquidity →
//     that passive area is the basis of a ZONE.
//   - When a zone is itself absorbed in the relevant sense → MITIGATION (used zone).
//   - "Supply is a passive-liquidity area where sellers raid buyers."
//   - "Demand is the mirrored relationship: buyers raid sellers."
//   - "A supply area is not selected as demand simply because it lies below
//     current price. A move seeking daily demand needs the appropriate daily
//     buyer-over-seller relationship."
//   Ch 9:
//   - "A zone is described as used when it has sponsored the move to the liquidity
//     related to it." Use is tied to the sponsored target, not touch count.
//   - Layered example: if price falls through daily zone into weekly demand,
//     then rallies through both targets — if WEEKLY is the parent liquidity,
//     weekly zone is the one used; daily zone may remain UNUSED.

import type { Candle } from "../../data";
import type {
  Zone,
  ZoneRole,
  ZoneState,
  LiquidityTier,
  LiquidityPoint,
  MoveStructure,
} from "./types";
import type { SwingPoint } from "./types";

// ---------------------------------------------------------------------------
// Detect zones from a sequence of liquidity sweeps
// ---------------------------------------------------------------------------

export interface ZoneDetectionOptions {
  /** Min candle-body ratio for the displacement candle ( aggressor ). */
  minDisplacementRatio?: number;
  /** Max candles between the opposing extreme and the displacement. */
  maxLookback?: number;
}

/**
 * Detect zones by scanning for the participant-takeover pattern described in Ch 8:
 *   - SUPPLY zone = sellers raid buyers. Pattern: a high is made (exhausted buyers),
 *     then a displacement candle DOWN. The zone = [the high, the high - tolerance]
 *     or [exhausted-buyer-high, displacement-open], depending on convention.
 *   - DEMAND zone = mirror: a low is made (exhausted sellers), then displacement UP.
 *
 * We use a simpler price-band heuristic:
 *   - For supply: zone top = the exhausted high. zone bottom = the close of the
 *     displacement candle (or the low of the displacement candle if even more extreme).
 *   - For demand: zone bottom = the exhausted low. zone top = the close of the
 *     displacement candle (or high if more extreme).
 *
 * Returns zones with state="active" (no mitigation yet).
 */
export function detectZones(
  candles: Candle[],
  pivots: SwingPoint[],
  options: ZoneDetectionOptions = {},
): Zone[] {
  const minDisplacement = options.minDisplacementRatio ?? 0.6;
  const maxLookback = options.maxLookback ?? 10;
  const zones: Zone[] = [];

  // Walk pivots; for each high, check if a downward displacement happened
  // within the next maxLookback candles. If yes, that's a supply zone.
  for (const pivot of pivots) {
    if (pivot.type === "high") {
      const startIdx = pivot.index + 1;
      const endIdx = Math.min(candles.length, startIdx + maxLookback);
      for (let i = startIdx; i < endIdx; i++) {
        const c = candles[i];
        const bodySize = Math.abs(c.close - c.open);
        const range = c.high - c.low || 1e-9;
        const bodyRatio = bodySize / range;
        const isDownDisplacement = c.close < c.open && bodyRatio >= minDisplacement;
        if (isDownDisplacement) {
          const zoneTop = pivot.price;
          const zoneBottom = Math.min(c.close, c.low);
          zones.push({
            id: `supply-${pivot.time}`,
            role: "supply",
            state: "active",
            top: zoneTop,
            bottom: zoneBottom,
            startDate: pivot.date,
            endDate: null as any,
            aggressorDirection: "down",
            sponsoredLiquidity: null as any,
            mitigationDate: null,
            touches: 0,
          });
          break;
        }
      }
    } else {
      // low → demand zone (displacement up)
      const startIdx = pivot.index + 1;
      const endIdx = Math.min(candles.length, startIdx + maxLookback);
      for (let i = startIdx; i < endIdx; i++) {
        const c = candles[i];
        const bodySize = Math.abs(c.close - c.open);
        const range = c.high - c.low || 1e-9;
        const bodyRatio = bodySize / range;
        const isUpDisplacement = c.close > c.open && bodyRatio >= minDisplacement;
        if (isUpDisplacement) {
          const zoneBottom = pivot.price;
          const zoneTop = Math.max(c.close, c.high);
          zones.push({
            id: `demand-${pivot.time}`,
            role: "demand",
            state: "active",
            top: zoneTop,
            bottom: zoneBottom,
            startDate: pivot.date,
            endDate: null as any,
            aggressorDirection: "up",
            sponsoredLiquidity: null as any,
            touches: 0,
          } as any);
          break;
        }
      }
    }
  }

  // Dedupe overlapping zones of the same role.
  return dedupeZones(zones);
}

function dedupeZones(zones: Zone[]): Zone[] {
  const sorted = [...zones].sort((a, b) => a.top - b.top);
  const result: Zone[] = [];
  for (const z of sorted) {
    const overlap = result.find(
      (r) => r.role === z.role && zonesOverlap(r, z),
    );
    if (overlap) {
      // Merge: keep the wider zone
      overlap.top = Math.max(overlap.top, z.top);
      overlap.bottom = Math.min(overlap.bottom, z.bottom);
      overlap.startDate = overlap.startDate < z.startDate ? overlap.startDate : z.startDate;
    } else {
      result.push({ ...z });
    }
  }
  return result;
}

function zonesOverlap(a: Zone, b: Zone): boolean {
  return a.top >= b.bottom && b.top >= a.bottom;
}

// ---------------------------------------------------------------------------
// Track zone touches (≠ mitigation)
// ---------------------------------------------------------------------------

/**
 * Walk candles and count how many times each zone has been touched (price
 * entered the zone's price band) WITHOUT being mitigated.
 *
 * Per Ch 9: "Touching a zone does not by itself establish its mitigation."
 */
export function trackTouches(candles: Candle[], zones: Zone[]): Zone[] {
  return zones.map((z) => {
    let touches = 0;
    for (const c of candles) {
      if (c.date < z.startDate) continue;
      // Touch = price entered the zone band
      if (c.low <= z.top && c.high >= z.bottom) {
        touches++;
      }
    }
    return { ...z, touches };
  });
}

// ---------------------------------------------------------------------------
// Determine mitigation (Ch 9 — sponsored target completion)
// ---------------------------------------------------------------------------

/**
 * Per Ch 9: a zone is MITIGATED when it has sponsored the move to its related
 * liquidity target. Mitigation is tied to the sponsored target, not touch count.
 *
 * Heuristic: if a zone is associated with a parent liquidity tier T, and price
 * subsequently reached a T-tier liquidity point in the expected direction
 * (above for demand, below for supply), then the zone is mitigated.
 *
 *   - For a demand zone (buyers raid sellers, expecting price UP):
 *     mitigated when price reaches a liquidity point ABOVE the zone's top.
 *   - For a supply zone (sellers raid buyers, expecting price DOWN):
 *     mitigated when price reaches a liquidity point BELOW the zone's bottom.
 */
export function checkMitigation(
  zones: Zone[],
  liquidityPoints: LiquidityPoint[],
  candles: Candle[],
): Zone[] {
  const lastPrice = candles[candles.length - 1]?.close ?? 0;

  return zones.map((z) => {
    if (z.state === "mitigated") return z;

    // Find a liquidity point this zone could be sponsoring.
    // Match by tier (if z.sponsoredLiquidity is set) or any tier.
    const matchingLiquidity = liquidityPoints.find((lp) => {
      if (z.sponsoredLiquidity && lp.tier !== z.sponsoredLiquidity) return false;
      if (z.role === "demand") {
        // Demand zone sponsors UP moves → liquidity ABOVE
        return lp.direction === "above" && lp.price > z.top;
      } else {
        return lp.direction === "below" && lp.price < z.bottom;
      }
    });

    if (!matchingLiquidity) return z;

    // Did price actually reach that liquidity point?
    const reached =
      z.role === "demand"
        ? candles.some((c) => c.high >= matchingLiquidity.price)
        : candles.some((c) => c.low <= matchingLiquidity.price);

    if (!reached) return z;

    return {
      ...z,
      state: "mitigated",
      mitigationDate: matchingLiquidity.date,
      endDate: matchingLiquidity.date,
    };
  });
}

// ---------------------------------------------------------------------------
// Layered mitigation (Ch 9 — parent liquidity decides which zone was used)
// ---------------------------------------------------------------------------

/**
 * Per Ch 9 layered example: if price touches multiple zones, only the one
 * sponsoring the PARENT (controlling) liquidity is mitigated. Others remain
 * available for future use.
 *
 *   parentLiquidityTier = the tier of the controlling liquidity point.
 *   zones = all zones touched.
 *
 * Returns: which zone was actually mitigated (if any).
 */
export function resolveLayeredMitigation(
  zonesTouched: Zone[],
  parentLiquidityTier: LiquidityTier,
): Zone | null {
  // Find the zone whose sponsoredLiquidity matches the parent tier.
  const matching = zonesTouched.find(
    (z) => z.sponsoredLiquidity === parentLiquidityTier,
  );
  if (matching) return matching;
  // If no zone explicitly sponsors the parent tier, pick the most recent
  // active zone of the matching role.
  return zonesTouched[zonesTouched.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Convenience: full pipeline
// ---------------------------------------------------------------------------

export function detectAndTrackZones(
  candles: Candle[],
  pivots: SwingPoint[],
  liquidityPoints: LiquidityPoint[],
): Zone[] {
  const detected = detectZones(candles, pivots);
  const withTouches = trackTouches(candles, detected);
  const withMitigation = checkMitigation(withTouches, liquidityPoints, candles);
  return withMitigation;
}
