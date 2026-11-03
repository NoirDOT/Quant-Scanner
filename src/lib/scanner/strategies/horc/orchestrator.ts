// src/lib/scanner/strategies/horc/orchestrator.ts
// HORC Chapter 12: Putting it together — the chart walkthrough.
//
// Per the HORC Visual Study Guide, the repeatable study process:
//   1. Identify the selected move and its true origin (Ch 1-2).
//   2. Mark the passive, aggressor, and external extreme (Ch 1-2).
//   3. Register participants using the opening-range story (Ch 3).
//   4. Conclude them with the opposition hierarchy or the stated gap exception (Ch 5).
//   5. Build the coordinate comparison and test the highest relevant participant
//      opposition (Ch 4, 6).
//   6. Identify missing lower-coordinate conditions, target priority, and the
//      appropriate source zone (Ch 6, 7, 10).
//   7. Check where the incoming move came from, which liquidity is actually sought,
//      and whether the proposed area is in that route (Ch 10).
//   8. Inspect lower intervals where needed to confirm the true swing and zone
//      boundaries (Ch 11).
//   9. Track the target completion before deciding which zone was used (Ch 9).
//
// This orchestrator runs all 12 chapters in sequence and produces a HorcSignal.

import type { Candle } from "../../data";
import type { Timeframe } from "../../instruments";
import type { HorcSignal, Zone, LiquidityPoint } from "./types";
import { detectOrigin, type OriginDetectionResult } from "./origin";
import { buildComparison, type CoordinateResult } from "./coordinates";
import { findHighestConclusive, type OppositionHierarchyResult } from "./opposition";
import { classifyLiquidity, checkDiagonalRule, findSponsorZone } from "./liquidity";
import { detectAndTrackZones } from "./zones";
import { findValidAOIs, identifySourceZone, identifyTargetLiquidity } from "./aoi";
import { findIntradayLiquidity } from "./intraday";

// ---------------------------------------------------------------------------
// Top-level HORC scanner — produces a single HorcSignal for a candle series
// ---------------------------------------------------------------------------

export interface HorcScanOptions {
  /** Period tier to use for opposition hierarchy (default: 'daily'). */
  periodTier?: "daily" | "weekly" | "monthly";
  /** Whether to inspect intraday liquidity (Ch 11). Default: true. */
  inspectIntraday?: boolean;
  /** Narrow swing-pivot strength (default: 3). */
  narrowStrength?: number;
}

export function runHorcScan(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  options: HorcScanOptions = {},
): HorcSignal | null {
  if (candles.length < 100) return null;

  const periodTier = options.periodTier ?? "daily";
  const inspectIntraday = options.inspectIntraday ?? true;

  // -------- Chapter 1-2: Origin --------
  const originDetection: OriginDetectionResult = detectOrigin(candles, {
    narrowStrength: options.narrowStrength ?? 3,
    verifyMultiScale: true,
  });
  const move = originDetection.verified;
  if (!move) {
    return null;
  }

  const reasons: string[] = [];
  reasons.push(
    `Ch 1-2: Origin detected at ${move.origin.date.toISOString().slice(0, 10)} (${move.origin.price.toFixed(5)}), ` +
    `direction=${move.direction}, isPermanent=${move.isPermanent}`,
  );
  if (move.relativePassives.length > 0) {
    reasons.push(
      `Ch 2: ${move.relativePassives.length} relative passives (RP1..RP${move.relativePassives.length}) before origin`,
    );
  }

  // -------- Chapter 3 + 4: Coordinates --------
  // The passive = the origin date. The aggressor = the most recent candle date.
  const passiveDate = move.origin.date;
  const aggressorDate = candles[candles.length - 1].date;
  const coordResult: CoordinateResult = buildComparison(candles, passiveDate, aggressorDate);
  const comparison = coordResult.comparison;

  reasons.push(
    `Ch 4: Passive coords = [${coordResult.passive.map((c) => `${c.tier}${c.sign}`).join(", ")}], ` +
    `Aggressor coords = [${coordResult.aggressor.map((c) => `${c.tier}${c.sign}`).join(", ")}]`,
  );
  if (comparison.highestOpposingTier) {
    reasons.push(
      `Ch 4: Highest opposing tier = ${comparison.highestOpposingTier}`,
    );
  } else if (comparison.allMatch) {
    reasons.push(
      `Ch 4: All shared tiers match — no liquidity classification possible`,
    );
  }

  // -------- Chapter 5: Opposition rule --------
  const opposition: OppositionHierarchyResult = findHighestConclusive(
    candles,
    periodTier,
    aggressorDate,
  );
  if (opposition.winner) {
    reasons.push(
      `Ch 5: Highest conclusive interval = ${opposition.winner.interval} ` +
      `(prev=${opposition.winner.previousClosing}, new=${opposition.winner.newRegistered}, ` +
      `opposes=${opposition.winner.opposes})`,
    );
  } else {
    reasons.push(
      `Ch 5: No conclusive interval found across ${opposition.tested.length} tested TFs`,
    );
  }

  // -------- Chapter 6-7: Liquidity --------
  let liquidity: LiquidityPoint | null = null;
  if (comparison.highestOpposingTier) {
    liquidity = classifyLiquidity(move, comparison);
    if (liquidity) {
      const diagonalDelivered = checkDiagonalRule(candles, move, liquidity);
      liquidity.diagonalDelivered = diagonalDelivered;
      reasons.push(
        `Ch 6: Liquidity classified as ${liquidity.tier} ${liquidity.kind} ` +
        `at ${liquidity.price.toFixed(5)} (${liquidity.direction})`,
      );
      if (liquidity.missingLowerCoord) {
        reasons.push(
          `Ch 6: Missing lower coord = ${liquidity.missingLowerCoord}, ` +
          `diagonal delivered = ${diagonalDelivered}`,
        );
      }
    }
  }

  // -------- Chapter 8-9: Zones --------
  let zones: Zone[] = [];
  let zone: Zone | null = null;
  if (liquidity) {
    zones = detectAndTrackZones(candles, originDetection.pivots, [liquidity]);
    if (zones.length > 0) {
      // Find the most relevant zone for this liquidity (Ch 8-9 link)
      zone = findSponsorZone(liquidity, zones) ?? zones[0];
      reasons.push(
        `Ch 8-9: ${zones.length} zones detected, ` +
        `${zones.filter((z) => z.state === "mitigated").length} mitigated. ` +
        `Primary zone = ${zone.role} [${zone.bottom.toFixed(5)} - ${zone.top.toFixed(5)}]`,
      );
      if (zone.state === "mitigated") {
        reasons.push(`Ch 9: Zone mitigated on ${zone.mitigationDate?.toISOString().slice(0, 10)}`);
      }
    }
  } else {
    // No liquidity → still detect zones for AOI evaluation
    zones = detectAndTrackZones(candles, originDetection.pivots, []);
  }

  // Link the sponsor zone back to the liquidity (Ch 10 source-to-target mapping)
  if (zone && liquidity) {
    liquidity.sponsorZone = zone;
    if (!zone.sponsoredLiquidity) {
      zone.sponsoredLiquidity = liquidity.tier;
    }
  }

  // -------- Chapter 10: AOI --------
  const currentPrice = candles[candles.length - 1].close;
  const sourceZone = identifySourceZone(move, zones);
  const targetLiquidity = identifyTargetLiquidity(move, currentPrice, liquidity ? [liquidity] : []);

  if (sourceZone) {
    reasons.push(
      `Ch 10: Source zone = ${sourceZone.role} [${sourceZone.bottom.toFixed(5)} - ${sourceZone.top.toFixed(5)}]`,
    );
  }
  if (targetLiquidity) {
    reasons.push(
      `Ch 10: Target liquidity = ${targetLiquidity.tier} at ${targetLiquidity.price.toFixed(5)}`,
    );
  }

  const validAOIs = findValidAOIs(move, zones, liquidity ? [liquidity] : [], comparison, currentPrice);
  if (validAOIs.length > 0) {
    reasons.push(`Ch 10: ${validAOIs.length} valid AOI(s) for reversal entry`);
  }

  // -------- Chapter 11: Intraday --------
  let intraday: any = null;
  if (inspectIntraday && (timeframe === "1h" || timeframe === "2h")) {
    intraday = findIntradayLiquidity(candles);
    if (intraday) {
      reasons.push(
        `Ch 11: Intraday liquidity found — period=${intraday?.periodMinutes}min, ` +
        `observation=${intraday?.observationInterval}, ` +
        `passive=${intraday?.passiveRegistered}, aggressor=${intraday?.aggressorRegistered}`,
      );
    }
  }

  // -------- Chapter 12: Composite decision --------
  const direction = decideDirection(move, liquidity, zone, validAOIs);
  const prices = computeEntryStopTarget(move, liquidity, zone, direction, currentPrice);

  // Confluence count (0-4): origin + liquidity + zone + AOI alignment
  let confluenceCount = 0;
  if (move) confluenceCount++;
  if (liquidity) confluenceCount++;
  if (zone && zone.state === "active") confluenceCount++;
  if (validAOIs.length > 0) confluenceCount++;

  const rawScore = computeRawScore(confluenceCount, liquidity, zone, validAOIs, intraday);

  return {
    symbol,
    timeframe,
    move,
    passiveCoordinates: coordResult.passive,
    aggressorCoordinates: coordResult.aggressor,
    coordinateComparison: comparison,
    opposition: opposition.winner ?? {
      interval: "1d" as const,
      previousClosing: null,
      newRegistered: null,
      opposes: false,
      conclusive: false,
    },
    liquidity,
    zone,
    aoi: validAOIs[0] ?? null,
    intraday,
    direction,
    entryPrice: prices.entry,
    stopPrice: prices.stop,
    targetPrice: prices.target,
    reasons,
    confluenceCount,
    rawScore,
  };
}

// ---------------------------------------------------------------------------
// Decision: direction
// ---------------------------------------------------------------------------

function decideDirection(
  move: HorcSignal["move"],
  liquidity: LiquidityPoint | null,
  zone: Zone | null,
  validAOIs: any[],
): "long" | "short" | "neutral" {
  if (!liquidity || !zone) return "neutral";

  // Strong signal: active zone + valid AOI + diagonal delivered + missing coord satisfied
  const diagonalOk = !liquidity.missingLowerCoord || liquidity.diagonalDelivered;
  if (!diagonalOk) return "neutral";

  // Direction = OPPOSITE the move (we're seeking a REVERSAL into the active zone
  // → toward the liquidity target).
  // Bullish move (origin=low, aggressor up, liquidity above) → expect reversal
  // DOWN at a supply zone → SHORT.
  // Bearish move (origin=high, aggressor down, liquidity below) → expect reversal
  // UP at a demand zone → LONG.
  if (move.direction === "bullish" && zone.role === "supply") return "short";
  if (move.direction === "bearish" && zone.role === "demand") return "long";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Entry / Stop / Target
// ---------------------------------------------------------------------------

function computeEntryStopTarget(
  move: HorcSignal["move"],
  liquidity: LiquidityPoint | null,
  zone: Zone | null,
  direction: "long" | "short" | "neutral",
  currentPrice: number,
): { entry: number | null; stop: number | null; target: number | null } {
  if (direction === "neutral" || !zone || !liquidity) {
    return { entry: null, stop: null, target: null };
  }

  // Entry = middle of the zone
  const entry = (zone.top + zone.bottom) / 2;
  // Stop = beyond the zone (opposite side from entry direction)
  // Target = the liquidity price
  const stop = direction === "long" ? zone.bottom : zone.top;
  const target = liquidity.price;
  return { entry, stop, target };
}

// ---------------------------------------------------------------------------
// Raw score (0-100, before grading)
// ---------------------------------------------------------------------------

function computeRawScore(
  confluenceCount: number,
  liquidity: LiquidityPoint | null,
  zone: Zone | null,
  validAOIs: any[],
  intraday: any,
): number {
  let score = 0;
  // Confluence: 0-4 → 0-60 points
  score += confluenceCount * 15;
  // Liquidity quality
  if (liquidity) {
    if (liquidity.kind === "internal") score += 10;  // permanent structure bonus
    if (liquidity.diagonalDelivered) score += 10;
    if (liquidity.tier === "monthly") score += 8;
    else if (liquidity.tier === "weekly") score += 6;
    else if (liquidity.tier === "daily") score += 4;
  }
  // Zone quality
  if (zone && zone.state === "active") score += 6;
  // AOI count
  score += Math.min(validAOIs.length, 3) * 2;
  // Intraday bonus
  if (intraday) score += 4;
  return Math.min(100, Math.max(0, score));
}
