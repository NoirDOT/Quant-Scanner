// src/lib/scanner/indicators/ichimoku.ts

export interface IchimokuState {
  tenkan: number;
  kijun: number;
  senkouA: number; // projected 26 bars forward-looking visualization, but stored at the bar where it starts
  senkouB: number;
  chikou: number;
  bullishCross: boolean; // tenkan crosses above kijun
  bearishCross: boolean; // tenkan crosses below kijun
  priceAboveCloud: boolean;
  priceBelowCloud: boolean;
  cloudBullish: boolean; // senkouA > senkouB
  cloudBearish: boolean; // senkouB > senkouA
}

function donchianMid(values: number[], period: number, idx: number): number | null {
  if (idx < period - 1) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = idx - period + 1; j <= idx; j++) {
    hi = Math.max(hi, values[j]);
    lo = Math.min(lo, values[j]);
  }
  return (hi + lo) / 2;
}

function hhllMid(highs: number[], lows: number[], period: number, idx: number): number | null {
  if (idx < period - 1) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = idx - period + 1; j <= idx; j++) {
    hi = Math.max(hi, highs[j]);
    lo = Math.min(lo, lows[j]);
  }
  return (hi + lo) / 2;
}

export function ichimoku(
  highs: number[],
  lows: number[],
  closes: number[]
): (IchimokuState | null)[] {
  const len = closes.length;
  const conversion = 9;
  const base = 26;
  const spanB = 52;
  const displacement = 26;
  const out: (IchimokuState | null)[] = [];
  for (let i = 0; i < len; i++) {
    const tenkan =
      i >= conversion - 1 ? hhllMid(highs, lows, conversion, i) : null;
    const kijun =
      i >= base - 1 ? hhllMid(highs, lows, base, i) : null;
    const senkouB =
      i >= spanB - 1 ? hhllMid(highs, lows, spanB, i) : null;
    // senkou A is computed 26 bars ago (using current tenkan+kijun)
    // For simplicity, we project forward — for state output, we use current tenkan+kijun midpoint
    const senkouA =
      tenkan !== null && kijun !== null ? (tenkan + kijun) / 2 : null;
    const chikou = i + displacement < len ? closes[i + displacement] : null;
    if (
      tenkan === null ||
      kijun === null ||
      senkouA === null ||
      senkouB === null ||
      chikou === null
    ) {
      out.push(null);
      continue;
    }
    const prev = i > 0 ? out[i - 1] : null;
    out.push({
      tenkan: tenkan,
      kijun: kijun,
      senkouA: senkouA,
      senkouB: senkouB,
      chikou: chikou,
      bullishCross:
        prev !== null && prev.tenkan <= prev.kijun && tenkan > kijun,
      bearishCross:
        prev !== null && prev.tenkan >= prev.kijun && tenkan < kijun,
      priceAboveCloud:
        closes[i] > senkouA && closes[i] > senkouB,
      priceBelowCloud:
        closes[i] < senkouA && closes[i] < senkouB,
      cloudBullish: senkouA > senkouB,
      cloudBearish: senkouB > senkouA,
    });
  }
  return out;
}
