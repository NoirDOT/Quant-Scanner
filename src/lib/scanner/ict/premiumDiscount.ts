// /home/z/my-project/src/lib/scanner/ict/premiumDiscount.ts
// Premium / Discount zones — above 50% of dealing range = premium, below = discount

import type { Candle } from "../data";
import { findSwingPoints } from "./structure";

export interface PremiumDiscountState {
  index: number;
  rangeHigh: number;
  rangeLow: number;
  equilibrium: number;       // 50%
  premiumZone: boolean;      // close > 50%
  discountZone: boolean;     // close < 50%
  inPremiumExtreme: boolean; // close in top 25% (overbought premium)
  inDiscountExtreme: boolean;// close in bottom 25% (oversold discount)
}

export function premiumDiscount(candles: Candle[]): PremiumDiscountState[] {
  const out: PremiumDiscountState[] = [];
  const swings = findSwingPoints(candles, 2);
  for (let i = 0; i < candles.length; i++) {
    const priorSwings = swings.filter((s) => s.index <= i).slice(-10);
    if (priorSwings.length < 2) {
      out.push({
        index: i,
        rangeHigh: candles[i].high,
        rangeLow: candles[i].low,
        equilibrium: candles[i].close,
        premiumZone: false,
        discountZone: false,
        inPremiumExtreme: false,
        inDiscountExtreme: false,
      });
      continue;
    }
    const rangeHigh = Math.max(...priorSwings.map((s) => s.price));
    const rangeLow = Math.min(...priorSwings.map((s) => s.price));
    const eq = (rangeHigh + rangeLow) / 2;
    const c = candles[i].close;
    out.push({
      index: i,
      rangeHigh,
      rangeLow,
      equilibrium: eq,
      premiumZone: c > eq,
      discountZone: c < eq,
      inPremiumExtreme: c > rangeHigh - (rangeHigh - rangeLow) * 0.25,
      inDiscountExtreme: c < rangeLow + (rangeHigh - rangeLow) * 0.25,
    });
  }
  return out;
}
