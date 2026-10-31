// /home/z/my-project/src/lib/scanner/ict/structure.ts
// Market structure detection — swing highs, swing lows, BOS, CHoCH
import type { Candle } from "../data";

export interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
  time: number;
}

export function findSwingPoints(
  candles: Candle[],
  lookback = 2
): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const slice = candles.slice(i - lookback, i + lookback + 1);
    const pivot = candles[i];
    if (
      slice.every((c) => c.high <= pivot.high) &&
      slice.filter((c) => c.high === pivot.high).length === 1
    ) {
      out.push({ index: i, price: pivot.high, type: "high", time: pivot.time });
    } else if (
      slice.every((c) => c.low >= pivot.low) &&
      slice.filter((c) => c.low === pivot.low).length === 1
    ) {
      out.push({ index: i, price: pivot.low, type: "low", time: pivot.time });
    }
  }
  return out;
}

export type StructureEventKind = "BOS" | "CHoCH";

export interface StructureEvent {
  index: number;
  price: number;
  kind: StructureEventKind;
  direction: "bullish" | "bearish";
  // BOS = continuation (price breaks prior SH/SL in trend direction)
  // CHoCH = reversal (price breaks SH/SL against prior trend)
}

export function detectStructure(
  candles: Candle[],
  swingLookback = 2
): StructureEvent[] {
  const swings = findSwingPoints(candles, swingLookback);
  const events: StructureEvent[] = [];
  let lastTrend: "bullish" | "bearish" | null = null;
  let lastSwingHigh: SwingPoint | null = null;
  let lastSwingLow: SwingPoint | null = null;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const recentHigh = swings
      .filter((s) => s.type === "high" && s.index < i)
      .slice(-1)[0];
    const recentLow = swings
      .filter((s) => s.type === "low" && s.index < i)
      .slice(-1)[0];
    if (recentHigh && c.close > recentHigh.price) {
      const kind = lastTrend === "bearish" ? "CHoCH" : "BOS";
      events.push({
        index: i,
        price: recentHigh.price,
        kind,
        direction: "bullish",
      });
      lastTrend = "bullish";
      lastSwingHigh = recentHigh;
    }
    if (recentLow && c.close < recentLow.price) {
      const kind = lastTrend === "bullish" ? "CHoCH" : "BOS";
      events.push({
        index: i,
        price: recentLow.price,
        kind,
        direction: "bearish",
      });
      lastTrend = "bearish";
      lastSwingLow = recentLow;
    }
  }
  return events;
}

// Return latest structure event at index <= i
export function latestStructureAt(
  events: StructureEvent[],
  i: number
): StructureEvent | null {
  for (let j = events.length - 1; j >= 0; j--) {
    if (events[j].index <= i) return events[j];
  }
  return null;
}
