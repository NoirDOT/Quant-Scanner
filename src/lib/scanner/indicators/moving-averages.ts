// /home/z/my-project/src/lib/scanner/indicators/moving-averages.ts
// EMA, SMA, and stacked EMA detector.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      // seed with SMA of the first `period` values
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
      out.push(prev);
    } else {
      prev = values[i] * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}

export interface StackedEMAState {
  ema8: number;
  ema21: number;
  ema50: number;
  ema200: number;
  bullishStack: boolean;   // 8 > 21 > 50 > 200
  bearishStack: boolean;   // 8 < 21 < 50 < 200
  priceAboveAll: boolean;
  priceBelowAll: boolean;
}

export function stackedEma(closes: number[]): (StackedEMAState | null)[] {
  const e8 = ema(closes, 8);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const out: (StackedEMAState | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (e200[i] === null || e50[i] === null) {
      out.push(null);
      continue;
    }
    const s: StackedEMAState = {
      ema8: e8[i] as number,
      ema21: e21[i] as number,
      ema50: e50[i] as number,
      ema200: e200[i] as number,
      bullishStack:
        (e8[i] as number) > (e21[i] as number) &&
        (e21[i] as number) > (e50[i] as number) &&
        (e50[i] as number) > (e200[i] as number),
      bearishStack:
        (e8[i] as number) < (e21[i] as number) &&
        (e21[i] as number) < (e50[i] as number) &&
        (e50[i] as number) < (e200[i] as number),
      priceAboveAll:
        closes[i] > (e8[i] as number) &&
        closes[i] > (e21[i] as number) &&
        closes[i] > (e50[i] as number) &&
        closes[i] > (e200[i] as number),
      priceBelowAll:
        closes[i] < (e8[i] as number) &&
        closes[i] < (e21[i] as number) &&
        closes[i] < (e50[i] as number) &&
        closes[i] < (e200[i] as number),
    };
    out.push(s);
  }
  return out;
}
