// src/lib/scanner/indicators/macd.ts

import { ema } from "./moving-averages";

export interface MACDState {
  macd: number;
  signal: number;
  histogram: number;
  histogramExpansion: boolean; // |hist| increasing for 2 bars
  histogramContraction: boolean;
  crossUp: boolean;   // macd crosses above signal at this bar
  crossDown: boolean;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): (MACDState | null)[] {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] === null || emaSlow[i] === null
      ? null
      : (emaFast[i] as number) - (emaSlow[i] as number)
  );
  // For signal EMA, use only the non-null macd values
  const valid = macdLine.filter((v) => v !== null) as number[];
  const signalValid = ema(valid, signal);
  const signalLine: (number | null)[] = [];
  let validIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
      continue;
    }
    signalLine.push(signalValid[validIdx] ?? null);
    validIdx++;
  }
  const out: (MACDState | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null || signalLine[i] === null) {
      out.push(null);
      continue;
    }
    const macd = macdLine[i] as number;
    const sig = signalLine[i] as number;
    const hist = macd - sig;
    const prevHist =
      i > 0 && out[i - 1] !== null ? (out[i - 1] as MACDState).histogram : null;
    const prevMacd =
      i > 0 && out[i - 1] !== null ? (out[i - 1] as MACDState).macd : null;
    const prevSig =
      i > 0 && out[i - 1] !== null ? (out[i - 1] as MACDState).signal : null;
    out.push({
      macd,
      signal: sig,
      histogram: hist,
      histogramExpansion:
        prevHist !== null ? Math.abs(hist) > Math.abs(prevHist) : false,
      histogramContraction:
        prevHist !== null ? Math.abs(hist) < Math.abs(prevHist) : false,
      crossUp:
        prevMacd !== null && prevSig !== null
          ? prevMacd <= prevSig && macd > sig
          : false,
      crossDown:
        prevMacd !== null && prevSig !== null
          ? prevMacd >= prevSig && macd < sig
          : false,
    });
  }
  return out;
}
