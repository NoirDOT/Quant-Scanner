// /home/z/my-project/src/lib/scanner/ict/ote.ts
// OTE (Optimal Trade Entry) — fib 0.62 / 0.705 / 0.79 retracement zone with FVG confluence

import type { Candle } from "../data";
import { findSwingPoints, type SwingPoint } from "./structure";
import { detectFVGs, type FVG } from "./fvg";

export interface OTESetup {
  index: number;
  direction: "bullish" | "bearish";
  swingLow: number;     // for bullish
  swingHigh: number;    // for bullish
  oteTop: number;       // 0.62 level
  oteMid: number;       // 0.705 level
  oteBottom: number;    // 0.79 level
  fvgConfluence: FVG | null;  // optional FVG inside OTE
  inOTE: boolean;       // price currently inside OTE at `index`
}

export function detectOTE(candles: Candle[]): OTESetup[] {
  const out: OTESetup[] = [];
  const swings = findSwingPoints(candles, 2);
  const fvgs = detectFVGs(candles);
  for (let i = 4; i < candles.length; i++) {
    const c = candles[i];
    const recentSwings = swings.filter((s) => s.index < i).slice(-6);
    if (recentSwings.length < 2) continue;
    // Bullish OTE: swing low → swing high, then price retraces into 0.62–0.79
    let low: SwingPoint | undefined;
    let high: SwingPoint | undefined;
    for (let j = recentSwings.length - 1; j >= 0; j--) {
      const s = recentSwings[j];
      if (s.type === "high" && high === undefined) high = s;
      if (s.type === "low" && low === undefined && high !== undefined) {
        low = s;
        break;
      }
    }
    if (low && high) {
      const range = high.price - low.price;
      const oteTop = high.price - range * 0.62;
      const oteBottom = high.price - range * 0.79;
      const inOTE = c.low <= oteTop && c.low >= oteBottom;
      if (inOTE) {
        const oteMid = high.price - range * 0.705;
        const fvgConfluence = fvgs.find(
          (f) =>
            f.endIndex < i &&
            f.direction === "bullish" &&
            Math.abs(f.midprice - oteMid) / oteMid < 0.01
        ) ?? null;
        out.push({
          index: i,
          direction: "bullish",
          swingLow: low.price,
          swingHigh: high.price,
          oteTop,
          oteMid,
          oteBottom,
          fvgConfluence,
          inOTE,
        });
      }
    }
    // Bearish OTE: swing high → swing low, then price retraces into 0.62–0.79
    let h: SwingPoint | undefined;
    let l: SwingPoint | undefined;
    for (let j = recentSwings.length - 1; j >= 0; j--) {
      const s = recentSwings[j];
      if (s.type === "low" && l === undefined) l = s;
      if (s.type === "high" && h === undefined && l !== undefined) {
        h = s;
        break;
      }
    }
    if (h && l) {
      const range = h.price - l.price;
      const oteTop = l.price + range * 0.79;
      const oteBottom = l.price + range * 0.62;
      const inOTE = c.high >= oteBottom && c.high <= oteTop;
      if (inOTE) {
        const oteMid = l.price + range * 0.705;
        const fvgConfluence = fvgs.find(
          (f) =>
            f.endIndex < i &&
            f.direction === "bearish" &&
            Math.abs(f.midprice - oteMid) / oteMid < 0.01
        ) ?? null;
        out.push({
          index: i,
          direction: "bearish",
          swingLow: l.price,
          swingHigh: h.price,
          oteTop,
          oteMid,
          oteBottom,
          fvgConfluence,
          inOTE,
        });
      }
    }
  }
  return out;
}
