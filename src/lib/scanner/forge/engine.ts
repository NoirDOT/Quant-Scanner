import { atr, indicatorSeries } from "./indicators";
import type {
  BacktestResult,
  Bar,
  Comparator,
  Costs,
  EquityPoint,
  IndicatorId,
  MemoryRule,
  Metrics,
  MonteCarloSummary,
  PropSummary,
  Rule,
  Strategy,
  Trade,
} from "./types";

import { CAPITAL } from "./types";

export function emptyMetrics(): Metrics {
  return {
    trades: 0,
    winRate: 0,
    profitFactor: 0,
    expectancy: 0,
    sharpe: 0,
    maxDrawdown: 0,
    totalReturn: 0,
    avgBars: 0,
    net: 0,
  };
}

function signed(id: IndicatorId): boolean {
  return id === "ret" || id === "sma_dist" || id === "ema_dist" || id === "zscore";
}

function bounded100(id: IndicatorId): boolean {
  return id === "rsi" || id === "stoch";
}

function unitInterval(id: IndicatorId): boolean {
  return id === "bb" || id === "donchian" || id === "close_loc";
}

export function mirrorOp(op: Comparator): Comparator {
  if (op === "lt") return "gt";
  if (op === "gt") return "lt";
  if (op === "cross_below") return "cross_above";
  return "cross_below";
}

export function mirrorThreshold(id: IndicatorId, threshold: number): number {
  if (signed(id)) return -threshold;
  if (bounded100(id)) return 100 - threshold;
  if (unitInterval(id)) return 1 - threshold;
  return threshold;
}

function mirrorRule(rule: Rule): Rule {
  return {
    ...rule,
    op: mirrorOp(rule.op),
    threshold: mirrorThreshold(rule.indicator, rule.threshold),
  };
}

function hit(op: Comparator, prev: number, curr: number, threshold: number): boolean {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return false;
  if (op === "lt") return curr < threshold;
  if (op === "gt") return curr > threshold;
  if (op === "cross_below") return prev >= threshold && curr < threshold;
  return prev <= threshold && curr > threshold;
}

interface Cache {
  get(id: IndicatorId, period: number): number[];
  atr: number[];
}

function makeCache(bars: Bar[], strategy: Strategy): Cache {
  const map = new Map<string, number[]>();
  const need: Array<[IndicatorId, number]> = [];
  for (const rule of strategy.entry) need.push([rule.indicator, rule.period]);
  if (strategy.memory.enabled) need.push(["ret", strategy.memory.lookback]);
  need.push(["ema_dist", 20]);
  const get = (id: IndicatorId, period: number) => {
    const key = `${id}:${period}`;
    let s = map.get(key);
    if (!s) {
      s = indicatorSeries(bars, id, period);
      map.set(key, s);
    }
    return s;
  };
  for (const [id, period] of need) get(id, period);
  return { get, atr: atr(bars, 14) };
}

function rulesPass(
  rules: Rule[],
  cache: Cache,
  i: number,
): boolean {
  if (rules.length === 0) return false;
  for (const rule of rules) {
    const series = cache.get(rule.indicator, rule.period);
    if (!hit(rule.op, series[i - 1], series[i], rule.threshold)) return false;
  }
  return true;
}

function memoryPass(memory: MemoryRule, cache: Cache, i: number): boolean {
  if (!memory.enabled) return true;
  const series = cache.get("ret", memory.lookback);
  const v = series[i];
  if (!Number.isFinite(v)) return false;
  return memory.op === "lt" ? v < memory.threshold : v > memory.threshold;
}

function scalerMult(mode: Strategy["scaler"], cache: Cache, i: number, bars: Bar[]): number {
  if (mode === "off") return 1;
  const dist = cache.get("ema_dist", 20)[i];
  const a = cache.atr[i];
  if (!Number.isFinite(dist) || !Number.isFinite(a) || a <= 0) return 1;
  const z = (dist / 100) * bars[i].c / a;
  const raw = mode === "trend" ? 1 + 0.35 * z : 1 - 0.35 * z;
  return Math.min(1.7, Math.max(0.35, raw));
}

export function runBacktest(
  bars: Bar[],
  strategy: Strategy,
  costs: Costs,
  range: { from: number; to: number },
): BacktestResult {
  const cache = makeCache(bars, strategy);
  const from = Math.max(2, range.from);
  const to = Math.min(bars.length - 1, range.to);
  const longRules = strategy.entry;
  const shortRules =
    strategy.side === "short"
      ? strategy.entry
      : strategy.side === "both"
        ? strategy.entry.map(mirrorRule)
        : strategy.entry.map(mirrorRule);

  type Pending = {
    side: "long" | "short";
    stopDist: number;
    mult: number;
    reason: string;
    targetR: number;
  };
  type Pos = Pending & { entry: number; stop: number; target: number; qty: number; entryIndex: number };

  let pending: Pending | null = null;
  let pos: Pos | null = null;
  let equity = CAPITAL;
  let peak = CAPITAL;
  let maxDd = 0;
  const trades: Trade[] = [];
  const curve: EquityPoint[] = [];
  const daily = new Array<number>(bars.length).fill(0);

  const pushEquity = (i: number, delta: number) => {
    equity += delta;
    if (delta !== 0) daily[i] += delta;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);
    curve.push({ index: i, t: bars[i].t, equity });
  };

  const closeTrade = (i: number, exitPrice: number, reason: string) => {
    if (!pos) return;
    const dir = pos.side === "long" ? 1 : -1;
    const gross = dir * (exitPrice - pos.entry) * pos.qty;
    const net = gross - costs.commission;
    trades.push({
      side: pos.side,
      entryIndex: pos.entryIndex,
      exitIndex: i,
      entryPrice: pos.entry,
      exitPrice,
      qty: pos.qty,
      net,
      reason,
    });
    pos = null;
    pushEquity(i, net);
  };

  for (let i = from; i < to; i++) {
    const bar = bars[i];
    if (pending && !pos) {
      const half = costs.spread / 2 + costs.slippage;
      const entry = pending.side === "long" ? bar.o + half : bar.o - half;
      const risk = Math.max(pending.stopDist, entry * 0.002);
      let qty = (CAPITAL * 0.01 * pending.mult) / risk;
      const notional = qty * entry;
      const cap = (equity * 2) / entry;
      if (notional > equity * 2) qty = cap;
      const stop =
        pending.side === "long" ? entry - pending.stopDist : entry + pending.stopDist;
      const rDist = Math.abs(entry - stop);
      const target =
        pending.targetR <= 0
          ? NaN
          : pending.side === "long"
            ? entry + pending.targetR * rDist
            : entry - pending.targetR * rDist;
      pos = {
        ...pending,
        entry,
        stop,
        target,
        qty: Math.max(qty, 0),
        entryIndex: i,
      };
      pending = null;
    }

    if (pos) {
      const held = i - pos.entryIndex;
      let exitPrice: number | null = null;
      let reason = "";
      if (pos.side === "long") {
        const stopHit = bar.l <= pos.stop;
        const tgtHit = Number.isFinite(pos.target) && bar.h >= pos.target;
        if (stopHit) {
          exitPrice = pos.stop - costs.slippage;
          reason = "Stop";
        } else if (tgtHit) {
          exitPrice = pos.target;
          reason = "Target";
        }
      } else {
        const stopHit = bar.h >= pos.stop;
        const tgtHit = Number.isFinite(pos.target) && bar.l <= pos.target;
        if (stopHit) {
          exitPrice = pos.stop + costs.slippage;
          reason = "Stop";
        } else if (tgtHit) {
          exitPrice = pos.target;
          reason = "Target";
        }
      }
      if (exitPrice == null) {
        const timed =
          strategy.maxBars === 1 ? held >= 0 : strategy.maxBars > 0 && held >= strategy.maxBars;
        if (timed) {
          const half = costs.spread / 2 + costs.slippage;
          exitPrice = pos.side === "long" ? bar.c - half : bar.c + half;
          reason = "Time";
        }
      }
      if (exitPrice == null && held >= 1) {
        const flip =
          pos.side === "long"
            ? rulesPass(shortRules, cache, i) && strategy.side !== "long"
            : rulesPass(longRules, cache, i) && strategy.side !== "short";
        const fade =
          pos.side === "long"
            ? strategy.side === "long" && rulesPass(shortRules, cache, i)
            : strategy.side === "short" && rulesPass(longRules, cache, i);
        if (flip || fade) {
          const half = costs.spread / 2 + costs.slippage;
          exitPrice = pos.side === "long" ? bar.c - half : bar.c + half;
          reason = "Opposite";
        }
      }
      if (exitPrice != null) closeTrade(i, exitPrice, reason);
    }

    if (!pos && !pending && i < to - 1) {
      const wantLong =
        (strategy.side === "long" || strategy.side === "both") &&
        rulesPass(longRules, cache, i) &&
        memoryPass(strategy.memory, cache, i);
      const wantShort =
        (strategy.side === "short" || strategy.side === "both") &&
        rulesPass(strategy.side === "short" ? longRules : shortRules, cache, i) &&
        memoryPass(strategy.memory, cache, i);
      const side = wantLong ? "long" : wantShort ? "short" : null;
      if (side) {
        const a = cache.atr[i];
        const stopDist =
          Number.isFinite(a) && strategy.stopAtr > 0 ? strategy.stopAtr * a : bars[i].c * 0.01;
        pending = {
          side,
          stopDist,
          mult: scalerMult(strategy.scaler, cache, i, bars),
          reason: describe(strategy),
          targetR: strategy.targetR,
        };
      }
    }

    if (!pos && curve.length === 0) pushEquity(i, 0);
    else if (!pos && curve[curve.length - 1]?.index !== i && trades.length === 0) {
      /* keep a flat mark */
    } else if (curve[curve.length - 1]?.index !== i) {
      curve.push({ index: i, t: bars[i].t, equity });
      peak = Math.max(peak, equity);
    }
  }

  if (pos) {
    const i = to - 1;
    const half = costs.spread / 2 + costs.slippage;
    const exitPrice = pos.side === "long" ? bars[i].c - half : bars[i].c + half;
    closeTrade(i, exitPrice, "Window end");
  }

  return { trades, equity: curve, metrics: metricsFrom(trades, curve, maxDd), dailyPnl: daily.slice(from, to) };
}

function metricsFrom(trades: Trade[], curve: EquityPoint[], maxDd: number): Metrics {
  if (trades.length === 0) return emptyMetrics();
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let barsHeld = 0;
  let net = 0;
  for (const t of trades) {
    net += t.net;
    barsHeld += t.exitIndex - t.entryIndex;
    if (t.net > 0) {
      wins += 1;
      grossWin += t.net;
    } else {
      grossLoss += -t.net;
    }
  }
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    if (prev > 0) rets.push((curve[i].equity - prev) / prev);
  }
  const mean = rets.reduce((s, v) => s + v, 0) / Math.max(rets.length, 1);
  let varr = 0;
  for (const r of rets) varr += (r - mean) * (r - mean);
  const sd = Math.sqrt(varr / Math.max(rets.length, 1));
  const sharpe = sd > 1e-12 ? (mean / sd) * Math.sqrt(252) : 0;
  const end = curve.length ? curve[curve.length - 1].equity : CAPITAL;
  return {
    trades: trades.length,
    winRate: wins / trades.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0,
    expectancy: net / trades.length,
    sharpe,
    maxDrawdown: maxDd,
    totalReturn: (end - CAPITAL) / CAPITAL,
    avgBars: barsHeld / trades.length,
    net,
  };
}

export function describe(strategy: Strategy): string {
  const rules = strategy.entry
    .map((r) => `${r.indicator}(${r.period}) ${r.op.replaceAll("_", " ")} ${trimNum(r.threshold)}`)
    .join(" and ");
  const mem = strategy.memory.enabled
    ? `, only if return(${strategy.memory.lookback}) ${strategy.memory.op} ${trimNum(strategy.memory.threshold)}`
    : "";
  const scale = strategy.scaler === "off" ? "" : `, size scales with ${strategy.scaler}`;
  return `${strategy.side} when ${rules}${mem}. Stop ${trimNum(strategy.stopAtr)} ATR, target ${trimNum(strategy.targetR)}R, max ${strategy.maxBars} bars${scale}.`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

export function scoreMetrics(m: Metrics): number {
  if (m.trades < 8) return -5 + m.trades * 0.05;
  const pf = Math.min(m.profitFactor, 3);
  const complexityPenalty = 0;
  return m.sharpe * Math.min(1, m.trades / 20) * (0.65 + 0.35 * Math.min(pf, 2) / 2) - complexityPenalty;
}

function nudge(n: number, amount: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n + amount));
}

export function neighbors(strategy: Strategy): Strategy[] {
  const base = strategy;
  const out: Strategy[] = [base];
  const rule = base.entry[0];
  if (!rule) return out;
  const periodStep = rule.indicator === "ret" ? 1 : 4;
  const thrStep = rule.indicator === "rsi" || rule.indicator === "stoch" ? 4 : rule.threshold > 2 ? 0.4 : 0.15;
  const variants: Strategy[] = [
    { ...base, stopAtr: nudge(base.stopAtr, -0.4, 0.6, 4) },
    { ...base, stopAtr: nudge(base.stopAtr, 0.4, 0.6, 4) },
    { ...base, targetR: nudge(base.targetR, -0.5, 0, 5) },
    { ...base, targetR: nudge(base.targetR, 0.5, 0, 5) },
    {
      ...base,
      entry: base.entry.map((r, i) =>
        i === 0 ? { ...r, period: Math.round(nudge(r.period, -periodStep, 2, 80)) } : r,
      ),
    },
    {
      ...base,
      entry: base.entry.map((r, i) =>
        i === 0 ? { ...r, period: Math.round(nudge(r.period, periodStep, 2, 80)) } : r,
      ),
    },
    {
      ...base,
      entry: base.entry.map((r, i) =>
        i === 0 ? { ...r, threshold: nudge(r.threshold, -thrStep, -5, 95) } : r,
      ),
    },
    {
      ...base,
      entry: base.entry.map((r, i) =>
        i === 0 ? { ...r, threshold: nudge(r.threshold, thrStep, -5, 95) } : r,
      ),
    },
  ];
  for (const v of variants) out.push({ ...v, id: `${base.id}-n${out.length}` });
  return out;
}

export function monteCarlo(trades: Trade[], paths = 400, seed = 7): MonteCarloSummary {
  if (trades.length < 2) {
    return {
      paths: 0,
      p5: CAPITAL,
      p50: CAPITAL,
      p95: CAPITAL,
      p5Return: 0,
      worstDecileDrawdown: 0,
      percentProfitable: 0,
    };
  }
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const finals: number[] = [];
  const dds: number[] = [];
  let profitable = 0;
  for (let p = 0; p < paths; p++) {
    let eq = CAPITAL;
    let peak = CAPITAL;
    let dd = 0;
    for (let i = 0; i < trades.length; i++) {
      const sample = trades[Math.floor(rnd() * trades.length)];
      eq += sample.net;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak > 0 ? (peak - eq) / peak : 0);
    }
    finals.push(eq);
    dds.push(dd);
    if (eq > CAPITAL) profitable += 1;
  }
  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const q = (arr: number[], pct: number) => arr[Math.min(arr.length - 1, Math.floor(pct * (arr.length - 1)))];
  const p5 = q(finals, 0.05);
  return {
    paths,
    p5,
    p50: q(finals, 0.5),
    p95: q(finals, 0.95),
    p5Return: (p5 - CAPITAL) / CAPITAL,
    worstDecileDrawdown: q(dds, 0.9),
    percentProfitable: profitable / paths,
  };
}

export interface PropRules {
  target: number;
  trailing: number;
  consistency: number;
  fee: number;
  maxDays: number;
}

export function propSim(dailyPnl: number[], rules: PropRules, paths = 400, seed = 11): PropSummary {
  const series = dailyPnl.filter((v) => Number.isFinite(v));
  if (series.length < 10) {
    return {
      passes: 0,
      paths: 0,
      passRate: 0,
      medianDays: 0,
      expectedNet: -rules.fee,
      target: rules.target,
      trailing: rules.trailing,
      fee: rules.fee,
    };
  }
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const daysToPass: number[] = [];
  let passes = 0;
  for (let p = 0; p < paths; p++) {
    let cum = 0;
    let peak = 0;
    let best = 0;
    let passed = false;
    for (let d = 1; d <= rules.maxDays; d++) {
      const x = series[Math.floor(rnd() * series.length)];
      cum += x;
      peak = Math.max(peak, cum);
      best = Math.max(best, x);
      if (peak - cum >= rules.trailing) break;
      if (cum >= rules.target && best <= rules.consistency * cum) {
        passes += 1;
        daysToPass.push(d);
        passed = true;
        break;
      }
    }
    void passed;
  }
  daysToPass.sort((a, b) => a - b);
  const passRate = passes / paths;
  const payout = rules.target * 0.8;
  const expectedNet = passRate * (payout - rules.fee) + (1 - passRate) * -rules.fee;
  return {
    passes,
    paths,
    passRate,
    medianDays: daysToPass.length ? daysToPass[Math.floor(daysToPass.length / 2)] : 0,
    expectedNet,
    target: rules.target,
    trailing: rules.trailing,
    fee: rules.fee,
  };
}

export function freeParamCount(strategy: Strategy): number {
  let n = 2;
  n += strategy.entry.length * 2;
  if (strategy.stopAtr > 0) n += 1;
  if (strategy.targetR > 0) n += 1;
  if (strategy.maxBars > 0) n += 1;
  if (strategy.memory.enabled) n += 2;
  if (strategy.scaler !== "off") n += 1;
  return n;
}
