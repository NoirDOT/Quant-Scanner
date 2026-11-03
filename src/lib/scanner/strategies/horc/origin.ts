// src/lib/scanner/strategies/horc/origin.ts
// HORC Chapters 1-2: Structure begins with the origin; permanent vs relative structure.
//
// Per the HORC Visual Study Guide:
//   - "To judge whether a structure is intact, first identify where that particular move actually began."
//   - Origin = the absolute starting point of the selected move (not the first visible candle).
//   - A move can lose intermediate higher lows / lower highs and still remain intact
//     relative to its original starting point.
//   - "Permanent" describes the interaction with the absolute origin (vs "relative" passives RP1/RP2/RP3).
//
// This module:
//   1. Detects swing pivots (Fractal-based, configurable strength)
//   2. Identifies the origin of the most recent directional move
//   3. Tracks relative passives (intermediate swings) before the origin
//   4. Classifies whether the structure is still intact or has been violated (permanent)

import type { Candle } from "../../data";
import type {
  SwingPoint,
  MoveStructure,
  StructureDirection,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Swing pivot detection (fractal-based)
// ---------------------------------------------------------------------------

/**
 * Detect swing pivots in a candle array.
 * A swing high at index i requires highs[i] to be the maximum of
 * highs[i-strength..i+strength]. Mirror for lows.
 *
 * HORC Ch 2 explicitly warns about screen scale: "A visible low can look like
 * the beginning of a move until the chart is inspected at another scale."
 * We use strength=3 (default) for intermediate pivots, strength=5 for major.
 */
export function detectSwingPivots(
  candles: Candle[],
  strength: number = 3,
): SwingPoint[] {
  if (candles.length < strength * 2 + 1) return [];

  const pivots: SwingPoint[] = [];

  for (let i = strength; i < candles.length - strength; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      pivots.push({
        index: i,
        time: c.time,
        date: c.date,
        price: c.high,
        type: "high",
        strength,
      });
    }
    if (isLow) {
      pivots.push({
        index: i,
        time: c.time,
        date: c.date,
        price: c.low,
        type: "low",
        strength,
      });
    }
  }

  return pivots;
}

// ---------------------------------------------------------------------------
// 2. Identify the origin of the most recent move
// ---------------------------------------------------------------------------

/**
 * Find the origin of the most recent directional move, scanning backwards
 * from the last candle.
 *
 * Per HORC Ch 1:
 *   - Bearish sequence: impulse down → low → pullback → trades below earlier low.
 *   - Bullish sequence: impulse up → high → pullback → trades above earlier high.
 *
 * We pick the most recent confirmed directional sequence:
 *   - Find the last swing pivot (high or low) that has been "respected" — i.e.
 *     subsequent price has not crossed it from the direction that would break structure.
 *   - That pivot is the origin.
 *
 * Returns null if there aren't enough pivots to determine structure.
 */
export function identifyOrigin(
  candles: Candle[],
  pivots: SwingPoint[],
): MoveStructure | null {
  if (pivots.length < 3 || candles.length < 30) return null;

  // Walk pivots from the most recent backwards. We need:
  //   - A candidate origin (high or low)
  //   - A subsequent external extreme (the opposite-type pivot that completed the move)
  //   - The current price relative to the origin
  const lastPrice = candles[candles.length - 1].close;
  const sortedPivots = [...pivots].sort((a, b) => a.index - b.index);

  // Try the most recent N pivots as origin candidates.
  for (let i = sortedPivots.length - 1; i >= 2; i--) {
    const candidate = sortedPivots[i];
    if (candidate.type === "low") {
      // Candidate origin is a low → bullish move from this low.
      // Look forward in pivots for a high (external extreme) after this low.
      const forwardHighs = sortedPivots.filter(
        (p) => p.type === "high" && p.index > candidate.index,
      );
      if (forwardHighs.length === 0) continue;
      const externalExtreme = forwardHighs[0];

      // Relative passives = higher lows after the origin, before current price.
      // (RP1, RP2, RP3 ... in HORC Ch 2)
      const relativePassives = sortedPivots.filter(
        (p) =>
          p.type === "low" &&
          p.index > candidate.index &&
          p.price > candidate.price &&
          p.index < sortedPivots[sortedPivots.length - 1].index,
      );

      // Structure intact if current price > origin (origin not violated).
      // "Permanent" interaction = origin has been violated (price < origin for bullish).
      const isPermanent = lastPrice < candidate.price;

      return {
        origin: candidate,
        direction: isPermanent ? "bearish" : "bullish",
        externalExtreme,
        relativePassives,
        isPermanent,
      };
    } else {
      // Candidate origin is a high → bearish move from this high.
      const forwardLows = sortedPivots.filter(
        (p) => p.type === "low" && p.index > candidate.index,
      );
      if (forwardLows.length === 0) continue;
      const externalExtreme = forwardLows[0];

      const relativePassives = sortedPivots.filter(
        (p) =>
          p.type === "high" &&
          p.index > candidate.index &&
          p.price < candidate.price &&
          p.index < sortedPivots[sortedPivots.length - 1].index,
      );

      const isPermanent = lastPrice > candidate.price;

      return {
        origin: candidate,
        direction: isPermanent ? "bullish" : "bearish",
        externalExtreme,
        relativePassives,
        isPermanent,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. Verify origin via multi-scale inspection (HORC Ch 2 "screen scale" warning)
// ---------------------------------------------------------------------------

/**
 * HORC Ch 2: "Zoom in to distinguish internal swings and zoom out to recover
 * the wider origin. The first visible candle or the lowest point in a cropped
 * view is not automatically the absolute origin."
 *
 * We re-run pivot detection at a wider strength (5 vs 3) and verify the origin
 * is consistent. If a wider-strength pivot supersedes the narrow-strength one,
 * use the wider (more reliable) one.
 */
export function verifyOriginMultiScale(
  candles: Candle[],
  narrow: MoveStructure,
): MoveStructure {
  const widePivots = detectSwingPivots(candles, 5);
  if (widePivots.length < 3) return narrow;

  // Look for a wide pivot near the narrow origin (within ±3 candles).
  const nearbyWide = widePivots.find(
    (p) =>
      p.type === narrow.origin.type &&
      Math.abs(p.index - narrow.origin.index) <= 3,
  );

  if (!nearbyWide) return narrow;

  // If the wide pivot price is more extreme (deeper low or higher high),
  // it's the "truer" origin per HORC Ch 2's screen-scale guidance.
  const isMoreExtreme =
    narrow.origin.type === "low"
      ? nearbyWide.price < narrow.origin.price
      : nearbyWide.price > narrow.origin.price;

  if (!isMoreExtreme) return narrow;

  return {
    ...narrow,
    origin: nearbyWide,
  };
}

// ---------------------------------------------------------------------------
// 4. Top-level entrypoint
// ---------------------------------------------------------------------------

export interface OriginDetectionResult {
  pivots: SwingPoint[];
  move: MoveStructure | null;
  verified: MoveStructure | null;
}

export function detectOrigin(
  candles: Candle[],
  options: { narrowStrength?: number; verifyMultiScale?: boolean } = {},
): OriginDetectionResult {
  const narrowStrength = options.narrowStrength ?? 3;
  const verifyMultiScale = options.verifyMultiScale ?? true;

  const pivots = detectSwingPivots(candles, narrowStrength);
  const move = identifyOrigin(candles, pivots);
  const verified = move && verifyMultiScale ? verifyOriginMultiScale(candles, move) : move;

  return { pivots, move, verified };
}

// ---------------------------------------------------------------------------
// 5. Utility: classify structure direction at a glance
// ---------------------------------------------------------------------------

export function classifyStructure(
  candles: Candle[],
  lookback: number = 200,
): StructureDirection {
  if (candles.length < 20) return "neutral";
  const start = Math.max(0, candles.length - lookback);
  const window = candles.slice(start);
  const { verified } = detectOrigin(window);
  if (!verified) return "neutral";
  return verified.direction;
}
