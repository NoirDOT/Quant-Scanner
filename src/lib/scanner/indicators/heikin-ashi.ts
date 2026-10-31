// /home/z/my-project/src/lib/scanner/indicators/heikin-ashi.ts

export interface HAState {
  open: number;
  high: number;
  low: number;
  close: number;
  trendUp: boolean;
  trendDown: boolean;
  strongBull: boolean;
  strongBear: boolean;
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
    const haClose: number = (opens[i] + highs[i] + lows[i] + closes[i]) / 4;
    let haOpen: number;
    if (prevOpen === null) {
      haOpen = (opens[i] + closes[i]) / 2;
    } else {
      const prevClose: number = out.length > 0 ? out[out.length - 1].close : closes[i];
      haOpen = (prevOpen + prevClose) / 2;
    }
    const haHigh: number = Math.max(highs[i], haOpen, haClose);
    const haLow: number = Math.min(lows[i], haOpen, haClose);
    const isBull: boolean = haClose >= haOpen;
    const lowerWick: boolean = haLow < Math.min(haOpen, haClose);
    const upperWick: boolean = haHigh > Math.max(haOpen, haClose);
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

export function haTrendContinuation(ha: HAState[], lookback = 3): "bull" | "bear" | "none" {
  if (ha.length < lookback) return "none";
  const recent = ha.slice(-lookback);
  const allBull = recent.every((h) => h.trendUp || h.strongBull);
  const allBear = recent.every((h) => h.trendDown || h.strongBear);
  if (allBull) return "bull";
  if (allBear) return "bear";
  return "none";
}
