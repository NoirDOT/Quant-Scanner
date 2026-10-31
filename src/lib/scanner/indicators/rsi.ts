// /home/z/my-project/src/lib/scanner/indicators/rsi.ts
import { sma } from "./moving-averages";

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  // Wilder's smoothing
  let avgGain = sma(gains.slice(0, period + 1), period)[period] as number;
  let avgLoss = sma(losses.slice(0, period + 1), period)[period] as number;
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    if (i > period) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}
