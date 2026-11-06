import { neighbors, runBacktest, scoreMetrics } from "./engine";
import type { Bar, Candidate, Costs, IndicatorId, Rule, Strategy, WalkWindow } from "./types";

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(1664525, a) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const POOL: IndicatorId[] = [
  "rsi",
  "stoch",
  "zscore",
  "bb",
  "donchian",
  "sma_dist",
  "ema_dist",
  "ret",
  "close_loc",
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randomRule(rng: () => number): Rule {
  const indicator = pick(rng, POOL);
  if (indicator === "rsi" || indicator === "stoch") {
    const fade = rng() < 0.5;
    return {
      indicator,
      period: 2 + Math.floor(rng() * 20),
      op: fade ? "lt" : "gt",
      threshold: fade ? 20 + rng() * 20 : 60 + rng() * 20,
    };
  }
  if (indicator === "ret") {
    const fade = rng() < 0.55;
    return {
      indicator,
      period: 1 + Math.floor(rng() * 4),
      op: fade ? "lt" : "gt",
      threshold: fade ? -(0.15 + rng() * 0.7) : 0.15 + rng() * 0.7,
    };
  }
  if (indicator === "zscore") {
    const fade = rng() < 0.5;
    return {
      indicator,
      period: 8 + Math.floor(rng() * 30),
      op: fade ? "lt" : "gt",
      threshold: fade ? -(0.8 + rng() * 1.4) : 0.8 + rng() * 1.4,
    };
  }
  if (indicator === "bb" || indicator === "donchian" || indicator === "close_loc") {
    const high = rng() < 0.5;
    return {
      indicator,
      period: indicator === "close_loc" ? 1 : 10 + Math.floor(rng() * 30),
      op: high ? "gt" : "lt",
      threshold: high ? 0.7 + rng() * 0.25 : 0.05 + rng() * 0.25,
    };
  }
  const up = rng() < 0.5;
  return {
    indicator,
    period: 8 + Math.floor(rng() * 40),
    op: up ? "gt" : "lt",
    threshold: up ? 0.05 + rng() * 0.6 : -(0.05 + rng() * 0.6),
  };
}

export function archetypeStrategies(): Strategy[] {
  return [
    {
      id: "arch-fade-ret",
      name: "Prior-day fade",
      side: "long",
      entry: [{ indicator: "ret", period: 1, op: "lt", threshold: -0.35 }],
      stopAtr: 2.4,
      targetR: 0,
      maxBars: 1,
      scaler: "off",
      memory: { enabled: false, lookback: 1, op: "lt", threshold: -0.3 },
    },
    {
      id: "arch-trend",
      name: "Trend press",
      side: "long",
      entry: [{ indicator: "sma_dist", period: 20, op: "gt", threshold: 0 }],
      stopAtr: 2,
      targetR: 2.2,
      maxBars: 12,
      scaler: "trend",
      memory: { enabled: false, lookback: 1, op: "gt", threshold: 0 },
    },
    {
      id: "arch-break",
      name: "Channel break",
      side: "long",
      entry: [{ indicator: "donchian", period: 20, op: "gt", threshold: 0.82 }],
      stopAtr: 1.8,
      targetR: 2,
      maxBars: 8,
      scaler: "trend",
      memory: { enabled: false, lookback: 1, op: "gt", threshold: 0 },
    },
    {
      id: "arch-rsi",
      name: "RSI fade",
      side: "long",
      entry: [{ indicator: "rsi", period: 8, op: "lt", threshold: 32 }],
      stopAtr: 1.5,
      targetR: 1.4,
      maxBars: 5,
      scaler: "fade",
      memory: { enabled: false, lookback: 1, op: "lt", threshold: -0.2 },
    },
  ];
}

function randomStrategy(rng: () => number, i: number): Strategy {
  const rules = [randomRule(rng)];
  if (rng() < 0.35) rules.push(randomRule(rng));
  return {
    id: `gen-${i}-${Math.floor(rng() * 1e6)}`,
    name: `Candidate ${i + 1}`,
    side: rng() < 0.7 ? "long" : rng() < 0.85 ? "short" : "both",
    entry: rules,
    stopAtr: 1 + rng() * 2,
    targetR: rng() < 0.25 ? 0 : 1 + rng() * 2,
    maxBars: 3 + Math.floor(rng() * 12),
    scaler: rng() < 0.45 ? "off" : rng() < 0.75 ? "trend" : "fade",
    memory: {
      enabled: rng() < 0.3,
      lookback: 1,
      op: rng() < 0.5 ? "lt" : "gt",
      threshold: rng() < 0.5 ? -0.3 : 0.3,
    },
  };
}

function mutate(strategy: Strategy, rng: () => number, gen: number): Strategy {
  const next: Strategy = {
    ...strategy,
    id: `mut-${gen}-${Math.floor(rng() * 1e6)}`,
    name: strategy.name,
    entry: strategy.entry.map((r) => ({ ...r })),
    memory: { ...strategy.memory },
  };
  const roll = rng();
  if (roll < 0.35 && next.entry[0]) {
    const r = next.entry[0];
    r.threshold = r.threshold * (0.85 + rng() * 0.3) + (rng() - 0.5) * 0.2;
    r.period = Math.max(1, Math.round(r.period + (rng() < 0.5 ? -2 : 2)));
  } else if (roll < 0.55) {
    next.stopAtr = Math.min(4, Math.max(0.7, next.stopAtr + (rng() - 0.5)));
  } else if (roll < 0.7) {
    next.targetR = Math.min(4, Math.max(0, next.targetR + (rng() - 0.5)));
  } else if (roll < 0.8) {
    next.scaler = next.scaler === "off" ? "trend" : next.scaler === "trend" ? "fade" : "off";
  } else if (roll < 0.9) {
    next.memory = { ...next.memory, enabled: !next.memory.enabled };
  } else if (next.entry.length < 3 && rng() < 0.5) {
    next.entry = [...next.entry, randomRule(rng)];
  } else if (next.entry.length > 1) {
    next.entry = next.entry.slice(0, -1);
  }
  return next;
}

export function discover(args: {
  bars: Bar[];
  costs: Costs;
  is: { from: number; to: number };
  val: { from: number; to: number };
  population?: number;
  generations?: number;
  seed?: number;
}): Candidate[] {
  const population = args.population ?? 16;
  const generations = args.generations ?? 3;
  const rng = rngOf(args.seed ?? 99);
  let pool: Strategy[] = [...archetypeStrategies()];
  while (pool.length < population) pool.push(randomStrategy(rng, pool.length));

  const seen = new Set<string>();
  const keyOf = (s: Strategy) =>
    JSON.stringify({
      side: s.side,
      entry: s.entry,
      stopAtr: Math.round(s.stopAtr * 10),
      targetR: Math.round(s.targetR * 10),
      maxBars: s.maxBars,
      scaler: s.scaler,
      memory: s.memory,
    });

  for (let g = 0; g < generations; g++) {
    const ranked = pool
      .map((strategy) => {
        const isMetrics = runBacktest(args.bars, strategy, args.costs, args.is).metrics;
        return { strategy, isMetrics, fit: scoreMetrics(isMetrics) - (strategy.entry.length - 1) * 0.08 };
      })
      .sort((a, b) => b.fit - a.fit);
    const parents = ranked.slice(0, Math.max(4, Math.floor(population / 3))).map((r) => r.strategy);
    const next: Strategy[] = [...parents];
    while (next.length < population) {
      const parent = parents[Math.floor(rng() * parents.length)];
      next.push(mutate(parent, rng, g));
    }
    pool = next;
  }

  const survivors: Candidate[] = [];
  for (const strategy of pool) {
    const k = keyOf(strategy);
    if (seen.has(k)) continue;
    seen.add(k);
    const isMetrics = runBacktest(args.bars, strategy, args.costs, args.is).metrics;
    if (isMetrics.trades < 8 || isMetrics.sharpe <= 0) continue;
    const valMetrics = runBacktest(args.bars, strategy, args.costs, args.val).metrics;
    const score = scoreMetrics(valMetrics);
    survivors.push({ strategy: { ...strategy, name: nameFrom(strategy) }, isMetrics, valMetrics, score });
  }
  survivors.sort((a, b) => b.score - a.score);
  return survivors.slice(0, 8);
}

function nameFrom(strategy: Strategy): string {
  const r = strategy.entry[0];
  if (!r) return "Empty";
  const verb = r.op === "lt" || r.op === "cross_below" ? "fade" : "press";
  return `${r.indicator} ${verb} ${strategy.side}`;
}

export function walkForward(args: {
  bars: Bar[];
  strategy: Strategy;
  costs: Costs;
  from: number;
  to: number;
  windows?: number;
}): WalkWindow[] {
  const windows = args.windows ?? 4;
  const span = args.to - args.from;
  const size = Math.floor(span / windows);
  const out: WalkWindow[] = [];
  if (size < 40) return out;
  for (let w = 0; w < windows; w++) {
    const start = args.from + w * size;
    const end = w === windows - 1 ? args.to : start + size;
    const split = start + Math.floor((end - start) * 0.7);
    let best = args.strategy;
    let bestScore = -Infinity;
    let bestIs = runBacktest(args.bars, args.strategy, args.costs, { from: start, to: split }).metrics;
    for (const variant of neighbors(args.strategy)) {
      const m = runBacktest(args.bars, variant, args.costs, { from: start, to: split }).metrics;
      const sc = scoreMetrics(m);
      if (sc > bestScore) {
        bestScore = sc;
        best = variant;
        bestIs = m;
      }
    }
    const oos = runBacktest(args.bars, best, args.costs, { from: split, to: end }).metrics;
    const decay = Math.abs(bestIs.sharpe) > 0.05 ? oos.sharpe / bestIs.sharpe : oos.sharpe > 0 ? 1 : 0;
    out.push({
      index: w + 1,
      isSharpe: bestIs.sharpe,
      oosSharpe: oos.sharpe,
      isReturn: bestIs.totalReturn,
      oosReturn: oos.totalReturn,
      oosTrades: oos.trades,
      decay,
    });
  }
  return out;
}
