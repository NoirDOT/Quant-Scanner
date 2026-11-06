// src/lib/scanner/forge/market.ts
// Instrument cost specs + Yahoo candle adapter.

import type { Candle } from "../data";
import type { Bar, Costs } from "./types";

export const INSTRUMENT_COSTS: Record<string, Costs> = {
  "EURUSD=X": { spread: 0.00008, slippage: 0.00003, commission: 0 },
  "GBPUSD=X": { spread: 0.00010, slippage: 0.00003, commission: 0 },
  "USDJPY=X": { spread: 0.010, slippage: 0.003, commission: 0 },
  "AUDUSD=X": { spread: 0.00012, slippage: 0.00004, commission: 0 },
  "USDCAD=X": { spread: 0.00012, slippage: 0.00004, commission: 0 },
  "USDCHF=X": { spread: 0.00012, slippage: 0.00004, commission: 0 },
  "NZDUSD=X": { spread: 0.00014, slippage: 0.00004, commission: 0 },
  "EURJPY=X": { spread: 0.015, slippage: 0.004, commission: 0 },
  "GBPJPY=X": { spread: 0.020, slippage: 0.005, commission: 0 },
  "EURGBP=X": { spread: 0.00012, slippage: 0.00004, commission: 0 },
  "AUDJPY=X": { spread: 0.015, slippage: 0.004, commission: 0 },
  "GC=F": { spread: 0.3, slippage: 0.15, commission: 0 },
  "SI=F": { spread: 0.02, slippage: 0.01, commission: 0 },
  "CL=F": { spread: 0.02, slippage: 0.01, commission: 0 },
  "BTC-USD": { spread: 5, slippage: 2, commission: 0 },
  "ETH-USD": { spread: 0.5, slippage: 0.2, commission: 0 },
  "SOL-USD": { spread: 0.05, slippage: 0.02, commission: 0 },
  "XRP-USD": { spread: 0.0002, slippage: 0.0001, commission: 0 },
  "DOGE-USD": { spread: 0.00002, slippage: 0.00001, commission: 0 },
  "^GSPC": { spread: 0.5, slippage: 0.25, commission: 1.2 },
  "^NDX": { spread: 1.0, slippage: 0.5, commission: 1.2 },
  "^DJI": { spread: 1.0, slippage: 0.5, commission: 1.2 },
};

export function getCosts(symbol: string, assetClass: string): Costs {
  if (INSTRUMENT_COSTS[symbol]) return INSTRUMENT_COSTS[symbol];
  if (assetClass === "forex") return { spread: 0.00015, slippage: 0.00005, commission: 0 };
  if (assetClass === "crypto") return { spread: 0.001, slippage: 0.0005, commission: 0 };
  if (assetClass === "commodity") return { spread: 0.05, slippage: 0.02, commission: 0 };
  if (assetClass === "index") return { spread: 0.5, slippage: 0.25, commission: 1.2 };
  return { spread: 0.01, slippage: 0.005, commission: 0 };
}

export function candlesToBars(candles: Candle[]): Bar[] {
  return candles.map((c) => ({
    t: c.time * 1000,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
  }));
}
