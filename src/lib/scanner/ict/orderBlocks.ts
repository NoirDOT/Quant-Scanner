// src/lib/scanner/ict/orderBlocks.ts
// Order Block detection — last opposing candle before BOS/displacement

import type { Candle } from "../data";
import { findSwingPoints } from "./structure";

export interface OrderBlock {
  startIndex: number;
  endIndex: number;        // bar where OB is invalidated
  direction: "bullish" | "bearish";
  high: number;
  low: number;
  mitigated: boolean;
  mitigationIndex?: number;
}

// Simple heuristic: scan for the last opposite-color candle before a strong move
// that breaks the prior swing high/low (displacement candle)
export function detectOrderBlocks(candles: Candle[]): OrderBlock[] {
  const out: OrderBlock[] = [];
  const swings = findSwingPoints(candles, 2);
  const swingHighs = swings.filter((s) => s.type === "high");
  const swingLows = swings.filter((s) => s.type === "low");
  for (let i = 5; i < candles.length - 1; i++) {
    // Bullish OB: find last bearish candle before bullish displacement break of prior swing high
    const lastSwingHighBefore = swingHighs
      .filter((s) => s.index < i && s.price < candles[i].close)
      .slice(-1)[0];
    if (lastSwingHighBefore) {
      // Look for displacement: this candle's body should break above that swing high
      const displacement = candles[i].close > lastSwingHighBefore.price &&
        candles[i].close - candles[i].open > (candles[i].high - candles[i].low) * 0.4;
      if (displacement) {
        // Find last bearish (down-close) candle before i
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          if (candles[j].close < candles[j].open) {
            out.push({
              startIndex: j,
              endIndex: i,
              direction: "bullish",
              high: candles[j].high,
              low: candles[j].low,
              mitigated: false,
            });
            break;
          }
        }
      }
    }
    // Bearish OB: symmetric
    const lastSwingLowBefore = swingLows
      .filter((s) => s.index < i && s.price > candles[i].close)
      .slice(-1)[0];
    if (lastSwingLowBefore) {
      const displacement = candles[i].close < lastSwingLowBefore.price &&
        candles[i].open - candles[i].close > (candles[i].high - candles[i].low) * 0.4;
      if (displacement) {
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          if (candles[j].close > candles[j].open) {
            out.push({
              startIndex: j,
              endIndex: i,
              direction: "bearish",
              high: candles[j].high,
              low: candles[j].low,
              mitigated: false,
            });
            break;
          }
        }
      }
    }
  }
  // Deduplicate
  const seen = new Set<string>();
  const unique = out.filter((o) => {
    const k = `${o.startIndex}:${o.direction}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Determine mitigation
  for (const ob of unique) {
    for (let j = ob.endIndex + 1; j < candles.length; j++) {
      const c = candles[j];
      if (ob.direction === "bullish") {
        if (c.low < ob.low) {
          ob.mitigated = true;
          ob.mitigationIndex = j;
          break;
        }
      } else {
        if (c.high > ob.high) {
          ob.mitigated = true;
          ob.mitigationIndex = j;
          break;
        }
      }
    }
  }
  return unique;
}

export function activeOrderBlocksAt(obs: OrderBlock[], at: number): OrderBlock[] {
  return obs.filter((o) => o.endIndex <= at && !o.mitigated);
}
