// filters/index.ts — Layer 2 filters
import type { Candle } from "../data";
import type { FilterFn, FilterInfo, FilterContext, ScanCandidate } from "../architecture";
import { detectFVGs } from "../ict/fvg";
import { detectOrderBlocks } from "../ict/orderBlocks";
import { detectLiquiditySweeps } from "../ict/liquidity";
import { detectStructure } from "../ict/structure";
import { detectOTE } from "../ict/ote";
import { premiumDiscount } from "../ict/premiumDiscount";
import { activeKillzones } from "../ict/killzones";
import { stackedEma } from "../indicators";
import { detectOrigin } from "../strategies/horc/origin";
import { buildComparison } from "../strategies/horc/coordinates";

export const fvgFilter: FilterFn = (candles, ctx) => {
  const fvgs = detectFVGs(candles);
  const recent = fvgs.slice(-3).filter((f: any) => !f.mitigated);
  if (recent.length === 0) return null;
  const lastFvg = recent[recent.length - 1] as any;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: lastFvg.direction === "up" ? "long" : "short",
    reasons: [`FVG: ${recent.length} unmitigated (last ${lastFvg.direction})`],
    matchedFilters: ["fvg"], detectorData: { fvgs: recent } };
};

export const orderBlockFilter: FilterFn = (candles, ctx) => {
  const obs = detectOrderBlocks(candles);
  const recent = obs.slice(-3).filter((o: any) => !o.mitigated);
  if (recent.length === 0) return null;
  const last = recent[recent.length - 1] as any;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: last.type === "bullish" ? "long" : "short",
    reasons: [`OB: ${recent.length} unmitigated (last ${last.type})`],
    matchedFilters: ["order-block"], detectorData: { orderBlocks: recent } };
};

export const liquiditySweepFilter: FilterFn = (candles, ctx) => {
  const sweeps = detectLiquiditySweeps(candles);
  const recent = sweeps.slice(-2);
  if (recent.length === 0) return null;
  const last = recent[recent.length - 1] as any;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: last.type === "buyside" ? "short" : "long",
    reasons: [`Liquidity sweep: ${last.type} at ${last.price.toFixed(5)}`],
    matchedFilters: ["liquidity-sweep"], detectorData: { sweeps: recent } };
};

export const bosChochFilter: FilterFn = (candles, ctx) => {
  const events = detectStructure(candles);
  const recent = events.slice(-2);
  if (recent.length === 0) return null;
  const last = recent[recent.length - 1] as any;
  const direction = last.type === "BOS" ? (last.direction === "up" ? "long" : "short") : (last.direction === "up" ? "short" : "long");
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction, reasons: [`${last.type}: ${last.direction} at ${last.price.toFixed(5)}`],
    matchedFilters: ["bos-choch"], detectorData: { structureEvents: recent } };
};

export const oteFilter: FilterFn = (candles, ctx) => {
  const otes = detectOTE(candles);
  if (otes.length === 0) return null;
  const last = otes[otes.length - 1] as any;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: last.direction === "up" ? "long" : "short",
    reasons: [`OTE: 62-79% fib zone (${last.direction})`],
    matchedFilters: ["ote"], detectorData: { ote: last } };
};

export const premiumDiscountFilter: FilterFn = (candles, ctx) => {
  const pd = premiumDiscount(candles) as any;
  if (!pd || pd.zone === "equilibrium") return null;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: pd.zone === "discount" ? "long" : "short",
    reasons: [`Premium/Discount: ${pd.zone} (${pd.percent.toFixed(0)}% of range)`],
    matchedFilters: ["premium-discount"], detectorData: { premiumDiscount: pd } };
};

export const killzoneFilter: FilterFn = (_candles, ctx) => {
  const kzs = activeKillzones();
  if (!kzs || kzs.length === 0) return null;
  const kz = kzs[0];
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: "neutral", reasons: [`Killzone active: ${kz.name} (${(kz as any).session})`],
    matchedFilters: ["killzone"], detectorData: { killzone: kz } };
};

export const emaStackFilter: FilterFn = (candles, ctx) => {
  if (candles.length < 200) return null;
  const closes = candles.map((c) => c.close);
  const states = stackedEma(closes);
  const last = states[states.length - 1] as any;
  if (!last) return null;
  if (last.bullishStack) return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe, direction: "long", reasons: ["Bullish EMA stack (8 > 21 > 50 > 200)"], matchedFilters: ["ema-stack"] };
  if (last.bearishStack) return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe, direction: "short", reasons: ["Bearish EMA stack (8 < 21 < 50 < 200)"], matchedFilters: ["ema-stack"] };
  return null;
};

export const horcOriginFilter: FilterFn = (candles, ctx) => {
  if (candles.length < 100) return null;
  const { verified: move } = detectOrigin(candles);
  if (!move) return null;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: move.direction === "bullish" ? "long" : "short",
    reasons: [`HORC origin at ${move.origin.date.toISOString().slice(0, 10)} (${move.origin.price.toFixed(5)})`, `Direction: ${move.direction}`, `Structure intact: ${!move.isPermanent}`, `Relative passives: ${move.relativePassives.length}`],
    matchedFilters: ["horc-origin"], detectorData: { horcMove: move } };
};

export const horcCoordinatesFilter: FilterFn = (candles, ctx) => {
  if (candles.length < 100) return null;
  const { verified: move } = detectOrigin(candles);
  if (!move) return null;
  const coord = buildComparison(candles, move.origin.date, candles[candles.length - 1].date);
  if (!coord.comparison.highestOpposingTier) return null;
  if (coord.comparison.highestOpposingTier === "D") return null;
  return { symbol: ctx.symbol, display: ctx.display, assetClass: ctx.assetClass, timeframe: ctx.timeframe,
    direction: move.direction === "bullish" ? "long" : "short",
    reasons: [`HORC highest opposing tier: ${coord.comparison.highestOpposingTier}`, `Passive: [${coord.passive.map((c) => `${c.tier}${c.sign}`).join(", ")}]`, `Aggressor: [${coord.aggressor.map((c) => `${c.tier}${c.sign}`).join(", ")}]`],
    matchedFilters: ["horc-coordinates"], detectorData: { horcCoordinates: coord } };
};

export const FILTERS: Record<string, FilterFn> = {
  "fvg": fvgFilter, "order-block": orderBlockFilter, "liquidity-sweep": liquiditySweepFilter,
  "bos-choch": bosChochFilter, "ote": oteFilter, "premium-discount": premiumDiscountFilter,
  "killzone": killzoneFilter, "ema-stack": emaStackFilter,
  "horc-origin": horcOriginFilter, "horc-coordinates": horcCoordinatesFilter,
};

export const FILTERS_INFO: FilterInfo[] = [
  { key: "fvg", label: "Fair Value Gap", description: "Unmitigated 3-candle imbalance with price retracing toward it", detectorKey: "detectFVGs", category: "ict" },
  { key: "order-block", label: "Order Block", description: "Last opposing candle before displacement — unmitigated", detectorKey: "detectOrderBlocks", category: "ict" },
  { key: "liquidity-sweep", label: "Liquidity Sweep", description: "Buyside/sellside raid + close back inside the range", detectorKey: "detectLiquiditySweeps", category: "ict" },
  { key: "bos-choch", label: "BOS / CHoCH", description: "Break of structure (continuation) or change of character (reversal)", detectorKey: "detectStructure", category: "structure" },
  { key: "ote", label: "Optimal Trade Entry", description: "Price in 62-79% Fibonacci retracement zone", detectorKey: "detectOTE", category: "ict" },
  { key: "premium-discount", label: "Premium / Discount", description: "Price in upper half (premium) or lower half (discount) of dealing range", detectorKey: "premiumDiscount", category: "ict" },
  { key: "killzone", label: "Killzone Active", description: "Current time is inside London, NY, Silver Bullet, or Asia killzone", detectorKey: "activeKillzones", category: "session" },
  { key: "ema-stack", label: "EMA Stack (8/21/50/200)", description: "Bullish or bearish stacked EMAs (continuation bias)", category: "trend" },
  { key: "horc-origin", label: "HORC Origin Detected", description: "Origin of current move detected with intact structure (Ch 1-2)", detectorKey: "detectOrigin", category: "horc" },
  { key: "horc-coordinates", label: "HORC Weekly+ Opposition", description: "Highest opposing coordinate tier is weekly or higher (Ch 4-5)", detectorKey: "buildComparison", category: "horc" },
];

export function runFilters(candles: Candle[], ctx: FilterContext, filterKeys: string[]): ScanCandidate[] {
  const candidates: ScanCandidate[] = [];
  for (const key of filterKeys) {
    const fn = FILTERS[key];
    if (!fn) continue;
    try { const c = fn(candles, ctx); if (c) candidates.push(c); }
    catch (err) { console.error(`[filters] ${key} on ${ctx.symbol}:${ctx.timeframe} failed:`, err); }
  }
  return candidates;
}

export function anyFilterMatches(candles: Candle[], ctx: FilterContext, filterKeys: string[]): boolean {
  for (const key of filterKeys) {
    const fn = FILTERS[key];
    if (!fn) continue;
    try { if (fn(candles, ctx)) return true; } catch { /* ignore */ }
  }
  return false;
}
