import type { Bar, IndicatorId } from "./types";

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      seed += values[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function stdev(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let m = 0;
    for (let k = i - period + 1; k <= i; k++) m += values[k];
    m /= period;
    let v = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const d = values[k] - m;
      v += d * d;
    }
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

export function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (period < 2) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= period) {
      gain += g;
      loss += l;
      if (i === period) {
        gain /= period;
        loss /= period;
        const rs = loss === 0 ? 100 : gain / loss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      const rs = loss === 0 ? 100 : gain / loss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

export function atr(bars: Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < bars.length; i++) {
    const tr =
      i === 0
        ? bars[i].h - bars[i].l
        : Math.max(
            bars[i].h - bars[i].l,
            Math.abs(bars[i].h - bars[i - 1].c),
            Math.abs(bars[i].l - bars[i - 1].c),
          );
    if (i < period) {
      seed += tr;
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function indicatorSeries(bars: Bar[], id: IndicatorId, period: number): number[] {
  const p = Math.max(2, Math.round(period));
  const closes = bars.map((b) => b.c);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);

  if (id === "rsi") return rsi(closes, p);
  if (id === "atr_pct") {
    const a = atr(bars, p);
    for (let i = 0; i < n; i++) out[i] = (a[i] / closes[i]) * 100;
    return out;
  }
  if (id === "ret") {
    for (let i = p; i < n; i++) out[i] = ((closes[i] - closes[i - p]) / closes[i - p]) * 100;
    return out;
  }
  if (id === "sma_dist" || id === "ema_dist") {
    const m = id === "sma_dist" ? sma(closes, p) : ema(closes, p);
    for (let i = 0; i < n; i++) out[i] = ((closes[i] - m[i]) / closes[i]) * 100;
    return out;
  }
  if (id === "zscore") {
    const m = sma(closes, p);
    const s = stdev(closes, p);
    for (let i = 0; i < n; i++) out[i] = s[i] > 0 ? (closes[i] - m[i]) / s[i] : NaN;
    return out;
  }
  if (id === "bb") {
    const m = sma(closes, p);
    const s = stdev(closes, p);
    for (let i = 0; i < n; i++) {
      const width = 4 * s[i];
      out[i] = width > 0 ? (closes[i] - (m[i] - 2 * s[i])) / width : NaN;
    }
    return out;
  }
  if (id === "donchian" || id === "stoch") {
    for (let i = p - 1; i < n; i++) {
      let hi = -Infinity;
      let lo = Infinity;
      const start = id === "stoch" ? i - p + 1 : i - p + 1;
      for (let k = start; k <= i; k++) {
        hi = Math.max(hi, bars[k].h);
        lo = Math.min(lo, bars[k].l);
      }
      const span = hi - lo;
      const price = id === "stoch" ? closes[i] : closes[i];
      out[i] = span > 0 ? ((price - lo) / span) * (id === "stoch" ? 100 : 1) : NaN;
    }
    return out;
  }
  if (id === "close_loc") {
    for (let i = p; i < n; i++) {
      const b = bars[i - p];
      const span = b.h - b.l;
      out[i] = span > 0 ? (b.c - b.l) / span : NaN;
    }
    return out;
  }
  return out;
}

export const INDICATOR_LABEL: Record<IndicatorId, string> = {
  rsi: "RSI",
  stoch: "Stochastic",
  zscore: "Z-score",
  bb: "Bollinger position",
  donchian: "Donchian position",
  sma_dist: "Distance from SMA",
  ema_dist: "Distance from EMA",
  ret: "Return",
  atr_pct: "ATR %",
  close_loc: "Prior close location",
};
