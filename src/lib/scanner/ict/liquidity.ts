// src/lib/scanner/ict/liquidity.ts
// Liquidity sweeps: stops above equal highs / below equal lows

import type { Candle } from "../data";
import { findSwingPoints } from "./structure";

export interface LiquidityEvent {
  index: number;
  price: number;
  direction: "buy-side" | "sell-side"; // buy-side = equal highs swept; sell-side = equal lows
  swept: boolean;
  sweepIndex: number;       // bar where price returned through the level
  displacementIndex: number; // bar showing strong rejection
}

export function detectLiquiditySweeps(
  candles: Candle[],
  equalLevelWindow = 3,    // bars within which two swing highs/lows are considered "equal"
  tolerancePct = 0.0008     // 0.08% within counts as equal
): LiquidityEvent[] {
  const out: LiquidityEvent[] = [];
  const swings = findSwingPoints(candles, 2);
  const swingHighs = swings.filter((s) => s.type === "high");
  const swingLows = swings.filter((s) => s.type === "low");
  // Equal highs
  for (let i = 1; i < swingHighs.length; i++) {
    const a = swingHighs[i - 1];
    const b = swingHighs[i];
    if (b.index - a.index <= 30) {
      const avg = (a.price + b.price) / 2;
      if (Math.abs(a.price - b.price) / avg < tolerancePct) {
        // Find a sweep: any bar after b.index that wicks above avg and closes back below
        for (let j = b.index + 1; j < candles.length; j++) {
          const c = candles[j];
          if (c.high > avg && c.close < avg) {
            out.push({
              index: j,
              price: avg,
              direction: "buy-side",
              swept: true,
              sweepIndex: j,
              displacementIndex: j + 1 < candles.length ? j + 1 : j,
            });
            break;
          }
        }
      }
    }
  }
  // Equal lows
  for (let i = 1; i < swingLows.length; i++) {
    const a = swingLows[i - 1];
    const b = swingLows[i];
    if (b.index - a.index <= 30) {
      const avg = (a.price + b.price) / 2;
      if (Math.abs(a.price - b.price) / avg < tolerancePct) {
        for (let j = b.index + 1; j < candles.length; j++) {
          const c = candles[j];
          if (c.low < avg && c.close > avg) {
            out.push({
              index: j,
              price: avg,
              direction: "sell-side",
              swept: true,
              sweepIndex: j,
              displacementIndex: j + 1 < candles.length ? j + 1 : j,
            });
            break;
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
