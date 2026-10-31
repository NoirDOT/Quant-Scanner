// /home/z/my-project/build/hubb-final/HUBB/src/lib/scanner/strategies/horc/scanner.ts
// HORC scanner family — wraps the orchestrator as a ScannerFn.
//
// Per the HORC Visual Study Guide (12 chapters), this scanner:
//   - Detects origin + passive/aggressor structure (Ch 1-2)
//   - Registers participants via opening-range cycle (Ch 3)
//   - Builds coordinates (M/W/D) + opposition rule (Ch 4-5)
//   - Classifies liquidity (Ch 6-7)
//   - Detects zones + mitigation (Ch 8-9)
//   - Identifies areas of interest (Ch 10)
//   - Inspects intraday liquidity if applicable (Ch 11)
//   - Composites into a single signal with confluence count + grade (Ch 12)
//
// This is the 5th strategy family alongside trend/ict/trader/ea.

import type { ScanSignal, ScannerFn, StrategyContext, StrategyInfo } from "../../types";
import { runHorcScan } from "./orchestrator";
import type { Timeframe } from "../../instruments";

// ---------------------------------------------------------------------------
// HORC strategy catalog entries
// ---------------------------------------------------------------------------

export const HORC_STRATEGIES: StrategyInfo[] = [
  {
    key: "horc-composite",
    type: "horc",
    label: "HORC Composite (All 12 Chapters)",
    description:
      "Full HORC framework: origin → OR-cycle → coordinates → opposition → " +
      "liquidity → zones → AOI → intraday → composite signal. Returns one " +
      "A+/A/B+/B-/C-graded signal per symbol/timeframe with confluence count.",
    timeframes: ["1h", "2h", "4h", "1d", "1w"],
    recommendedPairs: [
      { symbol: "EURUSD", timeframe: "4h", reason: "Deep CSV history (15y), clean swing structure" },
      { symbol: "GBPUSD", timeframe: "4h", reason: "High volatility → clear liquidity sweeps" },
      { symbol: "USDJPY", timeframe: "1d", reason: "Strong trends → clean origin detection" },
      { symbol: "XAUUSD", timeframe: "4h", reason: "Aggressive liquidity sweeps → ideal for HORC" },
    ],
    avoidPairs: [
      { symbol: "US500", reason: "Equity index gaps confound OR-cycle registration" },
    ],
  },
  {
    key: "horc-origin-structure",
    type: "horc",
    label: "HORC Origin & Structure (Ch 1-2)",
    description:
      "Reduced HORC: only the origin + passive/aggressor + relative passives " +
      "detection. No coordinates or liquidity. Useful as a structure-only filter.",
    timeframes: ["1h", "4h", "1d", "1w"],
    recommendedPairs: [
      { symbol: "EURUSD", timeframe: "4h", reason: "Clean swing structure" },
      { symbol: "USDJPY", timeframe: "1d", reason: "Strong trends → clear origins" },
    ],
  },
  {
    key: "horc-coordinates",
    type: "horc",
    label: "HORC Coordinates (Ch 4-5)",
    description:
      "Reduced HORC: only the M/W/D coordinate comparison + opposition rule. " +
      "Returns the highest opposing tier as a quality signal.",
    timeframes: ["1h", "4h", "1d"],
    recommendedPairs: [
      { symbol: "EURUSD", timeframe: "1d", reason: "Best for M/W/D coordinate analysis" },
      { symbol: "GBPUSD", timeframe: "1d", reason: "Same as EURUSD" },
    ],
  },
  {
    key: "horc-liquidity",
    type: "horc",
    label: "HORC Liquidity (Ch 6-7)",
    description:
      "Reduced HORC: liquidity classification only (internal/external, " +
      "daily/weekly/monthly) + diagonal rule + premium/discount priority.",
    timeframes: ["4h", "1d", "1w"],
    recommendedPairs: [
      { symbol: "XAUUSD", timeframe: "4h", reason: "Frequent liquidity sweeps" },
      { symbol: "EURUSD", timeframe: "1d", reason: "Clean weekly/monthly liquidity" },
    ],
  },
  {
    key: "horc-zones-aoi",
    type: "horc",
    label: "HORC Zones + AOI (Ch 8-10)",
    description:
      "Reduced HORC: zone detection (supply/demand, mitigation) + AOI " +
      "source-to-target mapping. Skip intraday and coordinate logic.",
    timeframes: ["1h", "4h", "1d"],
    recommendedPairs: [
      { symbol: "EURUSD", timeframe: "4h", reason: "Clean zone formation" },
      { symbol: "BTCUSD", timeframe: "4h", reason: "Volatility creates clear supply/demand" },
    ],
  },
];

// ---------------------------------------------------------------------------
// HORC scanner functions (one per strategy key)
// ---------------------------------------------------------------------------

/**
 * Composite HORC scanner — runs the full 12-chapter orchestrator.
 */
export const horcCompositeScanner: ScannerFn = async (ctx: StrategyContext): Promise<ScanSignal | null> => {
  const signal = runHorcScan(ctx.candles, ctx.symbol, ctx.timeframe);
  if (!signal || signal.direction === "neutral") return null;

  return {
    strategyKey: `horc-composite-${ctx.timeframe}`,
    strategyType: "horc",
    strategyLabel: "HORC Composite",
    symbol: ctx.symbol,
    display: ctx.display,
    assetClass: ctx.assetClass,
    timeframe: ctx.timeframe,
    direction: signal.direction,
    score: signal.rawScore,
    reasons: signal.reasons,
    entryPrice: signal.entryPrice ?? undefined,
    stopPrice: signal.stopPrice ?? undefined,
    targetPrice: signal.targetPrice ?? undefined,
    metadata: {
      horcConfluenceCount: signal.confluenceCount,
      horcLiquidityTier: signal.liquidity?.tier ?? null,
      horcLiquidityKind: signal.liquidity?.kind ?? null,
      horcZoneRole: signal.zone?.role ?? null,
      horcMoveDirection: signal.move.direction,
      horcMoveOrigin: signal.move.origin.date.toISOString(),
      horcIsPermanent: signal.move.isPermanent,
      horcHighestOpposingTier: signal.coordinateComparison.highestOpposingTier,
      horcOppositionInterval: signal.opposition.interval,
    },
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Reduced HORC scanner — origin + structure only (Ch 1-2).
 * Returns a signal when a clear origin is detected and the structure is intact.
 */
export const horcOriginStructureScanner: ScannerFn = async (ctx: StrategyContext): Promise<ScanSignal | null> => {
  const { detectOrigin } = await import("./origin");
  const result = detectOrigin(ctx.candles);
  const move = result.verified;
  if (!move) return null;

  // Direction: trade WITH the structure (continuation)
  const direction = move.direction === "bullish" ? "long" : "short";
  const lastPrice = ctx.candles[ctx.candles.length - 1].close;
  const stop = move.origin.price;
  const risk = Math.abs(lastPrice - stop);
  if (risk <= 0) return null;
  const target = direction === "long" ? lastPrice + 2 * risk : lastPrice - 2 * risk;

  return {
    strategyKey: `horc-origin-structure-${ctx.timeframe}`,
    strategyType: "horc",
    strategyLabel: "HORC Origin & Structure",
    symbol: ctx.symbol,
    display: ctx.display,
    assetClass: ctx.assetClass,
    timeframe: ctx.timeframe,
    direction,
    score: 50 + (move.isPermanent ? 10 : 0) + Math.min(20, move.relativePassives.length * 4),
    reasons: [
      `Origin at ${move.origin.date.toISOString().slice(0, 10)} (${move.origin.price.toFixed(5)})`,
      `Direction: ${move.direction}`,
      `Structure intact: ${!move.isPermanent}`,
      `Relative passives: ${move.relativePassives.length}`,
    ],
    entryPrice: lastPrice,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      horcMoveDirection: move.direction,
      horcMoveOrigin: move.origin.date.toISOString(),
      horcIsPermanent: move.isPermanent,
    },
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Reduced HORC scanner — coordinates only (Ch 4-5).
 * Returns a signal when the highest opposing tier is at least weekly.
 */
export const horcCoordinatesScanner: ScannerFn = async (ctx: StrategyContext): Promise<ScanSignal | null> => {
  const { detectOrigin } = await import("./origin");
  const { buildComparison } = await import("./coordinates");
  const { findHighestConclusive } = await import("./opposition");

  const move = detectOrigin(ctx.candles).verified;
  if (!move) return null;

  const coord = buildComparison(
    ctx.candles,
    move.origin.date,
    ctx.candles[ctx.candles.length - 1].date,
  );
  const opposition = findHighestConclusive(
    ctx.candles,
    "daily",
    ctx.candles[ctx.candles.length - 1].date,
  );

  if (!coord.comparison.highestOpposingTier) return null;

  const tier = coord.comparison.highestOpposingTier;
  // Only return signals for weekly+ opposition (filter out daily-only)
  if (tier === "D") return null;

  const direction: "long" | "short" = move.direction === "bullish" ? "long" : "short";
  const lastPrice = ctx.candles[ctx.candles.length - 1].close;
  const stop = move.origin.price;
  const risk = Math.abs(lastPrice - stop);
  if (risk <= 0) return null;
  const target = direction === "long" ? lastPrice + 3 * risk : lastPrice - 3 * risk;

  return {
    strategyKey: `horc-coordinates-${ctx.timeframe}`,
    strategyType: "horc",
    strategyLabel: "HORC Coordinates",
    symbol: ctx.symbol,
    display: ctx.display,
    assetClass: ctx.assetClass,
    timeframe: ctx.timeframe,
    direction,
    score: tier === "Y" ? 85 : tier === "M" ? 75 : tier === "W" ? 65 : 50,
    reasons: [
      `Highest opposing tier: ${tier}`,
      `Passive: [${coord.passive.map((c) => `${c.tier}${c.sign}`).join(", ")}]`,
      `Aggressor: [${coord.aggressor.map((c) => `${c.tier}${c.sign}`).join(", ")}]`,
      `Opposition interval: ${opposition.winner?.interval ?? "none"}`,
    ],
    entryPrice: lastPrice,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      horcHighestOpposingTier: tier,
      horcOppositionInterval: opposition.winner?.interval ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Reduced HORC scanner — liquidity only (Ch 6-7).
 */
export const horcLiquidityScanner: ScannerFn = async (ctx: StrategyContext): Promise<ScanSignal | null> => {
  const { detectOrigin } = await import("./origin");
  const { buildComparison } = await import("./coordinates");
  const { classifyLiquidity, checkDiagonalRule } = await import("./liquidity");

  const move = detectOrigin(ctx.candles).verified;
  if (!move) return null;

  const coord = buildComparison(
    ctx.candles,
    move.origin.date,
    ctx.candles[ctx.candles.length - 1].date,
  );

  const liquidity = classifyLiquidity(move, coord.comparison);
  if (!liquidity) return null;

  liquidity.diagonalDelivered = checkDiagonalRule(ctx.candles, move, liquidity);
  if (!liquidity.diagonalDelivered && liquidity.missingLowerCoord) return null;

  // Direction: trade TOWARD the liquidity point (continuation, not reversal)
  const direction = liquidity.direction === "above" ? "long" : "short";
  const lastPrice = ctx.candles[ctx.candles.length - 1].close;
  const target = liquidity.price;
  const risk = Math.abs(target - lastPrice);
  if (risk <= 0) return null;
  const stop = direction === "long" ? lastPrice - risk * 0.5 : lastPrice + risk * 0.5;

  return {
    strategyKey: `horc-liquidity-${ctx.timeframe}`,
    strategyType: "horc",
    strategyLabel: "HORC Liquidity",
    symbol: ctx.symbol,
    display: ctx.display,
    assetClass: ctx.assetClass,
    timeframe: ctx.timeframe,
    direction,
    score: 50 + (liquidity.kind === "internal" ? 20 : 10) + (liquidity.tier === "monthly" ? 15 : liquidity.tier === "weekly" ? 10 : 5),
    reasons: [
      `Liquidity tier: ${liquidity.tier}`,
      `Liquidity kind: ${liquidity.kind} (${liquidity.kind === "internal" ? "permanent structure" : "relative/temporary"})`,
      `Liquidity price: ${liquidity.price.toFixed(5)} (${liquidity.direction})`,
      `Diagonal delivered: ${liquidity.diagonalDelivered}`,
      ...(liquidity.missingLowerCoord ? [`Missing lower coord: ${liquidity.missingLowerCoord}`] : []),
    ],
    entryPrice: lastPrice,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      horcLiquidityTier: liquidity.tier,
      horcLiquidityKind: liquidity.kind,
      horcLiquidityPrice: liquidity.price,
      horcDiagonalDelivered: liquidity.diagonalDelivered,
    },
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Reduced HORC scanner — zones + AOI only (Ch 8-10).
 */
export const horcZonesAoiScanner: ScannerFn = async (ctx: StrategyContext): Promise<ScanSignal | null> => {
  const { detectOrigin } = await import("./origin");
  const { buildComparison } = await import("./coordinates");
  const { classifyLiquidity } = await import("./liquidity");
  const { detectAndTrackZones } = await import("./zones");
  const { findValidAOIs } = await import("./aoi");

  const move = detectOrigin(ctx.candles).verified;
  if (!move) return null;

  const coord = buildComparison(
    ctx.candles,
    move.origin.date,
    ctx.candles[ctx.candles.length - 1].date,
  );
  const liquidity = classifyLiquidity(move, coord.comparison);
  const liquidityPoints = liquidity ? [liquidity] : [];
  const zones = detectAndTrackZones(ctx.candles, detectOrigin(ctx.candles).pivots, liquidityPoints);
  const currentPrice = ctx.candles[ctx.candles.length - 1].close;
  const validAOIs = findValidAOIs(move, zones, liquidityPoints, coord.comparison, currentPrice);
  if (validAOIs.length === 0) return null;

  const aoi = validAOIs[0];
  const zone = aoi.zone;
  // Direction = OPPOSITE the move (reversal at the AOI)
  const direction = move.direction === "bullish" ? "short" : "long";
  const entry = (zone.top + zone.bottom) / 2;
  const stop = direction === "long" ? zone.bottom : zone.top;
  const target = liquidity ? liquidity.price : (direction === "long" ? entry * 1.02 : entry * 0.98);

  return {
    strategyKey: `horc-zones-aoi-${ctx.timeframe}`,
    strategyType: "horc",
    strategyLabel: "HORC Zones + AOI",
    symbol: ctx.symbol,
    display: ctx.display,
    assetClass: ctx.assetClass,
    timeframe: ctx.timeframe,
    direction,
    score: 55 + Math.min(25, validAOIs.length * 8) + (zone.state === "active" ? 10 : 0),
    reasons: [
      `Zone: ${zone.role} [${zone.bottom.toFixed(5)} - ${zone.top.toFixed(5)}]`,
      `Zone state: ${zone.state}`,
      `Zone touches: ${zone.touches}`,
      `In path: ${aoi.inPath}`,
      `Pending coord: ${aoi.pendingCoord ?? "none"}`,
      `Valid AOIs found: ${validAOIs.length}`,
    ],
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    metadata: {
      horcZoneRole: zone.role,
      horcZoneState: zone.state,
      horcValidAOIs: validAOIs.length,
    },
    generatedAt: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// HORC scanner registry — all 5 HORC scanners
// ---------------------------------------------------------------------------

export const HORC_SCANNERS: Record<string, ScannerFn> = {
  "horc-composite": horcCompositeScanner,
  "horc-origin-structure": horcOriginStructureScanner,
  "horc-coordinates": horcCoordinatesScanner,
  "horc-liquidity": horcLiquidityScanner,
  "horc-zones-aoi": horcZonesAoiScanner,
};

export const HORC_SCANNERS_INFO = HORC_STRATEGIES;
