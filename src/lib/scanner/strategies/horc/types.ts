// src/lib/scanner/strategies/horc/types.ts
// HORC (Market Structure & Price Action) — type definitions.
//
// Implements the framework documented in HORC_Visual_Study_Guide.pdf:
//   Ch 1-2: Origin, permanent vs relative structure
//   Ch 3  : Opening-range cycle (ORH/ORL/ORT/flip)
//   Ch 4  : Coordinates (M/W/D participant signs)
//   Ch 5  : Opposition rule + gap exception
//   Ch 6-7: Liquidity tiers (internal/external, premium/discount)
//   Ch 8-9: Zones (active/passive/mitigated, supply/demand)
//   Ch 10 : Areas of interest (source/path/destination)
//   Ch 11 : Intraday liquidity
//   Ch 12 : Chart walkthrough (orchestrator)

import type { Candle } from "../../data";
import type { Timeframe } from "../../instruments";

// ---------- Chapter 1-2: Structure ----------

export type StructureDirection = "bullish" | "bearish" | "neutral";

/** A swing pivot — origin candidate or intermediate reference. */
export interface SwingPoint {
  index: number;          // index into the candle array
  time: number;           // unix seconds
  date: Date;
  price: number;
  type: "high" | "low";
  strength: number;       // how many bars on each side confirm this pivot (1 = weak, 5+ = strong)
}

/** A move's origin + classification. */
export interface MoveStructure {
  origin: SwingPoint;             // the absolute origin (Ch 1)
  direction: StructureDirection;  // bullish (origin=low) or bearish (origin=high)
  externalExtreme: SwingPoint;    // the high at end of buy move (or low at end of sell move)
  relativePassives: SwingPoint[]; // RP1, RP2, RP3 ... (Ch 2) — intermediate swings before origin
  isPermanent: boolean;           // true if origin has been violated
}

// ---------- Chapter 3: Opening-Range Cycle ----------

export type Participant = "buyers" | "sellers" | null;

/** A single period's OR-cycle registration. */
export interface OpeningRangeCycle {
  periodStart: Date;
  periodEnd: Date;
  orh: number;           // opening range high = last closing candle's high before new period
  orl: number;           // opening range low  = last closing candle's low  before new period
  ort: number | null;    // opening range target = first-leg extreme
  firstCleared: "ORH" | "ORL" | null;  // which boundary cleared first → registers participant
  registered: Participant;
  leg1Extreme: number | null;
  leg2Extreme: number | null;
  cycleComplete: boolean;             // true if 3-leg cycle completed (returned to leg1 extreme)
  flipPoint: number | null;           // low created during leg 2 of buyer cycle (or vice versa)
  flipped: boolean;                   // true if flipPoint was crossed before periodEnd
  finalParticipant: Participant;      // registered OR flipped
}

// ---------- Chapter 4: Coordinates ----------

export type CoordTier = "Y" | "M" | "W" | "D";  // year, month, week, day
export type CoordSign = "+" | "-";              // buyers +, sellers -

export interface Coordinate {
  tier: CoordTier;
  sign: CoordSign;
  periodStart: Date;
  periodEnd: Date;
}

/** A passive/aggressor pair with their coordinate comparison. */
export interface CoordinateComparison {
  passive: Coordinate[];
  aggressor: Coordinate[];
  // Highest tier where signs oppose (e.g. W- vs W+ → "W")
  // null if no opposition at any tier
  highestOpposingTier: CoordTier | null;
  // Whether all tiers match (no opposition) — disqualifies liquidity classification
  allMatch: boolean;
}

// ---------- Chapter 5: Opposition Rule ----------

export type EligibleTimeframe =
  | "1mo" | "1w" | "1d"
  | "12h" | "8h" | "6h" | "4h" | "3h" | "2h" | "1h"
  | "30m" | "20m" | "15m" | "10m" | "5m" | "3m" | "1m";

export interface OppositionResult {
  interval: EligibleTimeframe;
  previousClosing: Participant;
  newRegistered: Participant;
  opposes: boolean;       // true if previousClosing !== newRegistered
  conclusive: boolean;    // true if opposes && no gap-exception override needed
}

// ---------- Chapter 6-7: Liquidity ----------

export type LiquidityTier = "monthly" | "weekly" | "daily" | "intraday";
export type LiquidityKind = "internal" | "external";  // permanent vs relative

export interface LiquidityPoint {
  tier: LiquidityTier;
  kind: LiquidityKind;
  price: number;
  date: Date;
  direction: "above" | "below";   // which side of current price
  sponsorZone: Zone | null;       // the valid zone that maps to this liquidity (Ch 10)
  missingLowerCoord: CoordTier | null;  // Ch 6 condition 1: which lower coord still needs delivery
  diagonalDelivered: boolean;     // Ch 6 diagonal rule: has the missing coord been delivered via exhaustive move?
}

// ---------- Chapter 8-9: Zones ----------

export type ZoneState = "active" | "passive" | "mitigated";
export type ZoneRole = "supply" | "demand";

export interface Zone {
  id: string;
  role: ZoneRole;
  state: ZoneState;
  top: number;            // upper price boundary
  bottom: number;         // lower price boundary
  startDate: Date;
  endDate: Date | null;   // null = still active
  // The participant takeover that created this zone (Ch 8):
  //   supply = sellers raid buyers → exhausted buyer high → area below
  //   demand = buyers raid sellers → exhausted seller low → area above
  aggressorDirection: "up" | "down";
  // Mitigation tracking (Ch 9): which parent liquidity did this zone sponsor?
  sponsoredLiquidity: LiquidityTier | null;
  mitigationDate: Date | null;
  touches: number;        // number of times price has touched (≠ mitigated)
}

// ---------- Chapter 10: Areas of Interest ----------

export interface AreaOfInterest {
  zone: Zone;
  // The source-to-target mapping (Ch 10):
  //   "An area of interest is an imbalance around an area price is not actively seeking to raid."
  sourceZone: Zone | null;        // where the current move came from
  targetLiquidity: LiquidityPoint | null;  // what the current move is mapped toward
  inPath: boolean;                // is this zone in the path between source and target?
  // The historical-search boundary (Ch 10): zones before this passive are neutralised
  searchBoundaryDate: Date | null;
  // Missing-coordinate condition (Ch 10 final example):
  pendingCoord: CoordTier | null;
}

// ---------- Chapter 11: Intraday Liquidity ----------

export interface IntradayLiquidity {
  // Elapsed-time calculation: trading-day-open to candidate aggressor
  periodMinutes: number;          // e.g. 17h × 60 = 1020 min
  // Subdivision intervals that exactly divide periodMinutes
  subdivisions: EligibleTimeframe[];
  // The conclusive observation interval used to register participants
  observationInterval: EligibleTimeframe;
  // Final classification — still "intraday" tier (lower than daily)
  liquidityTier: "intraday";
  passiveRegistered: Participant;
  aggressorRegistered: Participant;
  opposes: boolean;
}

// ---------- Chapter 12: Composite HORC Signal ----------

export interface HorcSignal {
  // Composite of all 12 chapters
  symbol: string;
  timeframe: Timeframe;
  move: MoveStructure;
  passiveCoordinates: Coordinate[];
  aggressorCoordinates: Coordinate[];
  coordinateComparison: CoordinateComparison;
  opposition: OppositionResult;
  liquidity: LiquidityPoint | null;
  zone: Zone | null;
  aoi: AreaOfInterest | null;
  intraday: IntradayLiquidity | null;
  // Final trade decision
  direction: "long" | "short" | "neutral";
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  // Reasons (human-readable) for each chapter's contribution
  reasons: string[];
  // Confluence count (0-4) for grading: origin + liquidity + zone + AOI
  confluenceCount: number;
  // Raw 0-100 score before grading
  rawScore: number;
}

// ---------- Helper exports ----------

export const COORD_TIER_PRIORITY: Record<CoordTier, number> = {
  Y: 4,
  M: 3,
  W: 2,
  D: 1,
};

export const ELIGIBLE_TF_HIERARCHY_DAILY: EligibleTimeframe[] = [
  "1d", "12h", "8h", "6h", "4h", "3h", "2h", "1h",
];

export const ELIGIBLE_TF_HIERARCHY_WEEKLY: EligibleTimeframe[] = [
  "1w", "1d", "12h", "8h", "6h", "4h", "3h", "2h", "1h",
];

export const ELIGIBLE_TF_HIERARCHY_MONTHLY: EligibleTimeframe[] = [
  "1mo", "1w", "1d", "12h", "8h", "6h", "4h", "3h", "2h", "1h",
];

/** Eligible subdivisions of N minutes (Ch 11). Returns intervals that divide N exactly. */
export function eligibleIntradaySubdivisions(totalMinutes: number): EligibleTimeframe[] {
  const candidates: Array<[EligibleTimeframe, number]> = [
    ["1mo", 0], ["1w", 0], ["1d", 1440],
    ["12h", 720], ["8h", 480], ["6h", 360], ["4h", 240], ["3h", 180],
    ["2h", 120], ["1h", 60], ["30m", 30], ["20m", 20], ["15m", 15],
    ["10m", 10], ["5m", 5], ["3m", 3], ["1m", 1],
  ];
  return candidates
    .filter(([_, mins]) => mins > 0 && totalMinutes % mins === 0)
    .map(([tf]) => tf);
}
