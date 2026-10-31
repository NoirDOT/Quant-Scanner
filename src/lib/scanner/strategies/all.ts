// strategies/all.ts — unified strategy catalog (45 strategies across 6 families)
import type { StrategyFn, StrategyInfo } from "../architecture";
import { TREND_STRATEGIES, TREND_SCANNERS } from "./trend";
import { ICT_STRATEGIES, ICT_SCANNERS } from "./ict";
import { TRADER_STRATEGIES, runTraderScan, traderResultToSignal } from "./traders";
import { EA_SCANNERS_INFO, EA_SCANNERS } from "./eas";
import { HORC_SCANNERS_INFO, HORC_SCANNERS } from "./horc";
import { COMMUNITY_STRATEGIES, COMMUNITY_STRATEGY_FNS } from "./community";

export interface UnifiedStrategyEntry extends StrategyInfo { strategyFn?: StrategyFn; }

export async function listAllStrategies(): Promise<UnifiedStrategyEntry[]> {
  const entries: UnifiedStrategyEntry[] = [];

  for (const s of TREND_STRATEGIES) {
    const fn = (TREND_SCANNERS as any)[s.key];
    if (fn) entries.push({ ...s, family: "trend", strategyFn: fn,
      usesDetectors: ["stackedEma", "macd", "adx", "supertrend", "psar", "ichimoku", "heikinAshi", "donchian"].slice(0, 2) });
  }
  for (const s of ICT_STRATEGIES) {
    const fn = (ICT_SCANNERS as any)[s.key];
    if (fn) entries.push({ ...s, family: "ict", strategyFn: fn,
      usesDetectors: ["detectFVGs", "detectOrderBlocks", "detectLiquiditySweeps", "detectStructure"] });
  }
  for (const t of TRADER_STRATEGIES) {
    const traderKey = t.key;
    entries.push({
      key: `trader-${traderKey}`, family: "trader", label: t.name, description: t.description,
      timeframes: ["1h", "4h", "1d"],
      strategyFn: async (ctx) => {
        const result = await runTraderScan(traderKey, ctx.symbol, ctx.display, ctx.assetClass);
        return result ? traderResultToSignal(result) : null;
      },
      usesDetectors: ["detectLiquiditySweeps", "detectFVGs", "detectOrderBlocks"],
    });
  }
  for (const e of EA_SCANNERS_INFO) {
    const fn = (EA_SCANNERS as any)[e.key];
    if (fn) entries.push({ ...e, key: e.key, family: "ea", strategyFn: fn, backtestStats: (e as any).backtestStats });
  }
  for (const h of HORC_SCANNERS_INFO) {
    const fn = HORC_SCANNERS[h.key];
    if (fn) entries.push({ ...h, family: "horc", strategyFn: fn,
      usesDetectors: ["detectOrigin", "buildComparison", "classifyLiquidity", "detectAndTrackZones", "findValidAOIs"] });
  }
  for (const c of COMMUNITY_STRATEGIES) {
    const fn = COMMUNITY_STRATEGY_FNS[c.key];
    if (fn) entries.push({ ...c, strategyFn: fn });
  }

  return entries;
}

export const listAllScanners = listAllStrategies;
export type ScannerCatalogEntry = UnifiedStrategyEntry;
