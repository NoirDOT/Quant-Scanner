// /home/z/my-project/src/lib/scanner/indicators/heikin-ashi.ts

export interface HAState {
  open: number;
  high: number;
  low: number;
  close: number;
  trendUp: boolean;     // bull candle, no lower wick
  trendDown: boolean;   // bear candle, no upper wick
  strongBull: boolean;  // body, no lower wick, close == high
  strongBear: boolean;  // body, no upper wick, close == low
}

export function heikinAshi(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[]
): HAState[] {
  const out: HAState[] = [];
  let prevOpen: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const haClose = (opens[i] + highs[i] + lows[i] + closes[i]) / 4;
    const haOpen = prevOpen === null ? (opens[i] + closes[i]) / 2 : (prevOpen + (out[i - 1]?.close ?? closes[i])) / 2;
    const haHigh = Math.max(highs[i], haOpen, haClose);
    const haLow = Math.min(lows[i], haOpen, haClose);
    const isBull = haClose >= haOpen;
    const lowerWick = haLow < Math.min(haOpen, haClose);
    const upperWick = haHigh > Math.max(haOpen, haClose);
    out.push({
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      trendUp: isBull && !lowerWick,
      trendDown: !isBull && !upperWick,
      strongBull: isBull && !lowerWick && Math.abs(haClose - haHigh) < (haHigh - haLow) * 0.05,
      strongBear: !isBull && !upperWick && Math.abs(haClose - haLow) < (haHigh - haLow) * 0.05,
    });
    prevOpen = haOpen;
  }
  return out;
}

// Detect trend continuation: 3 consecutive HA candles with no opposite wick
export function haTrendContinuation(ha: HAState[], lookback = 3): "bull" | "bear" | "none" {
  if (ha.length < lookback) return "none";
  const recent = ha.slice(-lookback);
  const allBull = recent.every((h) => h.trendUp || h.strongBull);
  const allBear = recent.every((h) => h.trendDown || h.strongBear);
  if (allBull) return "bull";
  if (allBear) return "bear";
  return "none";
}
