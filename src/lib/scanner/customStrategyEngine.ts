// src/lib/scanner/customStrategyEngine.ts
// Evaluates user-created strategies (stored in the CustomStrategy table) at
// scan time. Each strategy has a rule tree stored as JSON:
//
// {
//   entry: {
//     logic: "and" | "or",
//     conditions: [
//       { indicator: "ema", period: 21, comparator: ">", value: "ema50" },
//       { indicator: "rsi", period: 14, comparator: "<", value: 30 },
//       { indicator: "price", comparator: ">", value: "ema200" },
//       ...
//     ]
//   },
//   exit: {
//     stopType: "atr" | "fixed" | "ema",
//     stopValue: 1.5,        // ATR multiple, or % for fixed, or EMA period
//     targetType: "rr",
//     targetValue: 2,        // R:R ratio
//   },
//   score: 65,               // base score if all conditions pass
//   direction: "long"        // forced direction (or "auto" = infer from conditions)
// }
//
// The engine loads all enabled custom strategies, evaluates each against the
// candles, and returns ScanSignal[] just like the built-in scanners.

import type { Candle } from "./data";
import type { Timeframe } from "./instruments";
import type { ScanSignal, StrategyContext } from "./types";
import { ema } from "./indicators/moving-averages";
import { rsi } from "./indicators/rsi";
import { adx } from "./indicators/adx";
import { atr } from "./indicators/atr";
import { supertrend } from "./indicators/supertrend";
import { macd } from "./indicators/macd";
import { db } from "@/lib/db";

// ─── Rule types ────────────────────────────────────────────────────────────

export interface Condition {
  indicator: "ema" | "rsi" | "adx" | "macd" | "supertrend" | "price" | "volume";
  period?: number;
  comparator: ">" | "<" | ">=" | "<=" | "crosses_above" | "crosses_below" | "between";
  value: string | number;  // "ema50", "close", 30, etc.
  value2?: number;         // for "between"
}

export interface RuleTree {
  entry: {
    logic: "and" | "or";
    conditions: Condition[];
  };
  exit: {
    stopType: "atr" | "fixed" | "ema";
    stopValue: number;
    targetType: "rr";
    targetValue: number;
  };
  score: number;
  direction: "long" | "short" | "auto";
}

export interface CustomStrategyDef {
  id: string;
  key: string;
  name: string;
  description: string;
  family: string;
  timeframes: string[];
  rules: RuleTree;
}

// ─── Load enabled strategies from DB ───────────────────────────────────────

export async function loadCustomStrategies(): Promise<CustomStrategyDef[]> {
  try {
    const rows = await db.customStrategy.findMany({
      where: { enabled: true },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      family: r.family,
      timeframes: JSON.parse(r.timeframesJson || "[]"),
      rules: JSON.parse(r.rulesJson || "{}"),
    }));
  } catch (err) {
    console.error("[customStrategy] load error:", err);
    return [];
  }
}

export async function loadAllCustomStrategies(): Promise<CustomStrategyDef[]> {
  try {
    const rows = await db.customStrategy.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      family: r.family,
      timeframes: JSON.parse(r.timeframesJson || "[]"),
      rules: JSON.parse(r.rulesJson || "{}"),
      enabled: r.enabled,
    } as CustomStrategyDef & { enabled: boolean }));
  } catch (err) {
    console.error("[customStrategy] load all error:", err);
    return [];
  }
}

// ─── Indicator value resolver ───────────────────────────────────────────────

function getIndicatorValue(
  condition: Condition,
  candles: Candle[],
  ctx: { symbol: string; tf: string },
): { current: number | null; previous: number | null; raw: any } {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const last = closes.length - 1;

  switch (condition.indicator) {
    case "ema": {
      const period = condition.period ?? 21;
      const arr = ema(closes, period);
      return {
        current: arr[last] ?? null,
        previous: arr[last - 1] ?? null,
        raw: arr,
      };
    }
    case "rsi": {
      const period = condition.period ?? 14;
      const arr = rsi(closes, period);
      return {
        current: arr[last] ?? null,
        previous: arr[last - 1] ?? null,
        raw: arr,
      };
    }
    case "adx": {
      const period = condition.period ?? 14;
      const arr = adx(highs, lows, closes, period);
      const lastState = arr[last];
      const prevState = arr[last - 1];
      return {
        current: lastState?.adx ?? null,
        previous: prevState?.adx ?? null,
        raw: arr,
      };
    }
    case "macd": {
      const arr = macd(closes);
      const lastState = arr[last];
      const prevState = arr[last - 1];
      return {
        current: lastState?.histogram ?? null,
        previous: prevState?.histogram ?? null,
        raw: arr,
      };
    }
    case "supertrend": {
      const arr = supertrend(highs, lows, closes, 10, 3);
      const lastState = arr[last];
      const prevState = arr[last - 1];
      return {
        current: lastState?.direction ?? null, // 1 or -1
        previous: prevState?.direction ?? null,
        raw: arr,
      };
    }
    case "price": {
      return {
        current: closes[last],
        previous: closes[last - 1] ?? null,
        raw: closes,
      };
    }
    case "volume": {
      const vols = candles.map((c) => c.volume);
      return {
        current: vols[last],
        previous: vols[last - 1] ?? null,
        raw: vols,
      };
    }
    default:
      return { current: null, previous: null, raw: null };
  }
}

// ─── Value resolver (what to compare against) ───────────────────────────────

function resolveValue(
  value: string | number,
  candles: Candle[],
  ctx: { symbol: string; tf: string },
): number | null {
  if (typeof value === "number") return value;
  const closes = candles.map((c) => c.close);
  const last = closes.length - 1;

  // "close" = current close price
  if (value === "close") return closes[last];

  // "ema50" = current EMA 50 value
  if (value.startsWith("ema")) {
    const period = parseInt(value.replace("ema", ""), 10);
    if (!isNaN(period)) {
      const arr = ema(closes, period);
      return arr[last] ?? null;
    }
  }

  // "open" = current bar open
  if (value === "open") return candles[last]?.open ?? null;

  // "high" / "low"
  if (value === "high") return candles[last]?.high ?? null;
  if (value === "low") return candles[last]?.low ?? null;

  // "volume_avg20" = average volume of last 20 bars
  if (value === "volume_avg20") {
    const vols = candles.slice(-21, -1).map((c) => c.volume);
    return vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
  }

  return null;
}

// ─── Condition evaluator ────────────────────────────────────────────────────

function evaluateCondition(
  condition: Condition,
  candles: Candle[],
  ctx: { symbol: string; tf: string },
): boolean {
  const indVal = getIndicatorValue(condition, candles, ctx);
  if (indVal.current == null) return false;

  // For comparators that need a target value
  const targetVal = typeof condition.value === "number"
    ? condition.value
    : resolveValue(condition.value, candles, ctx);

  const current = indVal.current;
  const previous = indVal.previous;

  switch (condition.comparator) {
    case ">":
      return targetVal != null && current > targetVal;
    case "<":
      return targetVal != null && current < targetVal;
    case ">=":
      return targetVal != null && current >= targetVal;
    case "<=":
      return targetVal != null && current <= targetVal;
    case "crosses_above":
      // Current is above target, previous was below
      return targetVal != null && previous != null
        && current > targetVal && previous <= targetVal;
    case "crosses_below":
      return targetVal != null && previous != null
        && current < targetVal && previous >= targetVal;
    case "between":
      return condition.value2 != null && targetVal != null
        && current >= Math.min(targetVal, condition.value2)
        && current <= Math.max(targetVal, condition.value2);
    default:
      return false;
  }
}

// ─── Strategy evaluator ────────────────────────────────────────────────────

function inferDirection(conditions: Condition[], candles: Candle[], ctx: { symbol: string; tf: string }): "long" | "short" {
  // Heuristic: if more conditions use ">" → long, more "<" → short
  let longScore = 0;
  let shortScore = 0;
  for (const c of conditions) {
    if (c.comparator === ">" || c.comparator === ">=" || c.comparator === "crosses_above") {
      longScore++;
    } else if (c.comparator === "<" || c.comparator === "<=" || c.comparator === "crosses_below") {
      shortScore++;
    }
  }
  return longScore >= shortScore ? "long" : "short";
}

function buildReasons(conditions: Condition[], candles: Candle[], ctx: { symbol: string; tf: string }): string[] {
  const reasons: string[] = [];
  for (const c of conditions) {
    const indVal = getIndicatorValue(c, candles, ctx);
    const valStr = typeof c.value === "number" ? String(c.value) : c.value;
    const curStr = indVal.current != null ? indVal.current.toFixed(2) : "?";
    reasons.push(`${c.indicator}${c.period ? `(${c.period})` : ""} ${c.comparator} ${valStr} (current: ${curStr})`);
  }
  return reasons;
}

function evaluateStrategy(
  def: CustomStrategyDef,
  ctx: StrategyContext,
): ScanSignal | null {
  const { candles, symbol, display, assetClass, timeframe } = ctx;
  const rules = def.rules;

  if (!rules.entry || !rules.entry.conditions || rules.entry.conditions.length === 0) {
    return null;
  }
  if (candles.length < 200) return null;

  const indicatorCtx = { symbol, tf: timeframe };

  // Evaluate all conditions
  const results = rules.entry.conditions.map((c) => evaluateCondition(c, candles, indicatorCtx));

  // Apply logic (and = all must pass, or = any must pass)
  const passed = rules.entry.logic === "or"
    ? results.some((r) => r)
    : results.every((r) => r);

  if (!passed) return null;

  // Determine direction
  const direction = rules.direction === "auto"
    ? inferDirection(rules.entry.conditions, candles, indicatorCtx)
    : rules.direction;

  if (direction !== "long" && direction !== "short") return null;

  // Build reasons
  const reasons = buildReasons(rules.entry.conditions, candles, indicatorCtx);

  // Compute entry/stop/target
  const lastClose = candles[candles.length - 1].close;
  const entry = lastClose;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  let stopPrice: number;
  if (rules.exit.stopType === "atr") {
    const atrArr = atr(highs, lows, closes, 14);
    const lastAtr = atrArr[atrArr.length - 1] ?? 0;
    stopPrice = direction === "long"
      ? entry - lastAtr * rules.exit.stopValue
      : entry + lastAtr * rules.exit.stopValue;
  } else if (rules.exit.stopType === "ema") {
    const emaArr = ema(closes, Math.round(rules.exit.stopValue));
    stopPrice = emaArr[emaArr.length - 1] ?? entry;
  } else {
    // fixed %
    stopPrice = direction === "long"
      ? entry * (1 - rules.exit.stopValue / 100)
      : entry * (1 + rules.exit.stopValue / 100);
  }

  const risk = Math.abs(entry - stopPrice);
  if (risk <= 0) return null;
  const targetPrice = direction === "long"
    ? entry + rules.exit.targetValue * risk
    : entry - rules.exit.targetValue * risk;

  return {
    strategyKey: `${def.key}-${timeframe}`,
    strategyType: def.family as any,
    strategyLabel: `${def.name} · ${timeframe.toUpperCase()}`,
    symbol, display, assetClass, timeframe,
    direction,
    score: rules.score ?? 65,
    reasons,
    entryPrice: entry,
    stopPrice,
    targetPrice,
    metadata: { customStrategyId: def.id, custom: true },
  };
}

// ─── Main entry — run all enabled custom strategies ─────────────────────────

export async function runCustomStrategies(ctx: StrategyContext): Promise<ScanSignal[]> {
  const defs = await loadCustomStrategies();
  if (defs.length === 0) return [];

  const signals: ScanSignal[] = [];
  for (const def of defs) {
    // Check if this strategy applies to the current timeframe
    if (def.timeframes.length > 0 && !def.timeframes.includes(ctx.timeframe)) {
      continue;
    }
    try {
      const signal = evaluateStrategy(def, ctx);
      if (signal) signals.push(signal);
    } catch (err) {
      console.error(`[customStrategy] ${def.key} error:`, err);
    }
  }
  return signals;
}
