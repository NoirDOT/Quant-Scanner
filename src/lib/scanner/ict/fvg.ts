// /home/z/my-project/src/lib/scanner/ict/fvg.ts
// Fair Value Gap (FVG) detection — 3-candle imbalance

import type { Candle } from "../data";

export interface FVG {
  startIndex: number;
  endIndex: number;       // start + 2
  direction: "bullish" | "bearish";
  top: number;
  bottom: number;
  midprice: number;
  size: number;           // top - bottom
  // whether price has revisited the FVG since it formed (mitigation)
  mitigated: boolean;
  mitigationIndex?: number;
}

export function detectFVGs(candles: Candle[]): FVG[] {
  const out: FVG[] = [];
  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i];
    const c2 = candles[i + 1];
    const c3 = candles[i + 2];

    // Bullish FVG: c3.low > c1.high (gap up)
    if (c3.low > c1.high) {
      const top = c3.low;
      const bottom = c1.high;
      out.push({
        startIndex: i,
        endIndex: i + 2,
        direction: "bullish",
        top,
        bottom,
        midprice: (top + bottom) / 2,
        size: top - bottom,
        mitigated: false,
      });
    }
    // Bearish FVG: c3.high < c1.low (gap down)
    else if (c3.high < c1.low) {
      const top = c1.low;
      const bottom = c3.high;
      out.push({
        startIndex: i,
        endIndex: i + 2,
        direction: "bearish",
        top,
        bottom,
        midprice: (top + bottom) / 2,
        size: top - bottom,
        mitigated: false,
      });
    }
  }
  // Determine mitigation
  for (const fvg of out) {
    for (let j = fvg.endIndex + 1; j < candles.length; j++) {
      const c = candles[j];
      if (fvg.direction === "bullish") {
        // Price came back down into the bullish FVG
        if (c.low <= fvg.top && c.high >= fvg.bottom) {
          fvg.mitigated = true;
          fvg.mitigationIndex = j;
          break;
        }
      } else {
        if (c.high >= fvg.bottom && c.low <= fvg.top) {
          fvg.mitigated = true;
          fvg.mitigationIndex = j;
          break;
        }
      }
    }
  }
  return out;
}

// Unmitigated FVGs that are still tradable
export function activeFVGsAt(fvgs: FVG[], at: number): FVG[] {
  return fvgs.filter((f) => f.endIndex <= at && !f.mitigated);
}
