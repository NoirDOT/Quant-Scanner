// /home/z/my-project/src/lib/scanner/indicators/supertrend.ts

import { atr } from "./atr";

export interface SupertrendState {
  value: number;
  direction: 1 | -1;   // 1 = uptrend (green), -1 = downtrend (red)
  justFlippedUp: boolean;   // this bar changed from -1 to 1
  justFlippedDown: boolean; // this bar changed from 1 to -1
}

export function supertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  multiplier = 3
): (SupertrendState | null)[] {
  const atrArr = atr(highs, lows, closes, period);
  const out: (SupertrendState | null)[] = [];
  let prevUpper: number | null = null;
  let prevLower: number | null = null;
  let prevDir: 1 | -1 = 1;
  let prevSuper: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const a = atrArr[i];
    if (a === null) {
      out.push(null);
      continue;
    }
    const hl2 = (highs[i] + lows[i]) / 2;
    let upper = hl2 + multiplier * a;
    let lower = hl2 - multiplier * a;
    if (prevUpper !== null && prevLower !== null) {
      upper = upper < prevUpper || closes[i - 1] > prevUpper ? upper : prevUpper;
      lower = lower > prevLower || closes[i - 1] < prevLower ? lower : prevLower;
    }
    let dir: 1 | -1 = prevDir;
    if (prevSuper === null) {
      dir = closes[i] > upper ? 1 : -1;
    } else if (prevSuper === prevUpper) {
      dir = closes[i] > upper ? 1 : -1;
    } else {
      dir = closes[i] < lower ? -1 : 1;
    }
    const superVal = dir === 1 ? lower : upper;
    const justFlippedUp = prevDir === -1 && dir === 1;
    const justFlippedDown = prevDir === 1 && dir === -1;
    out.push({
      value: superVal,
      direction: dir,
      justFlippedUp,
      justFlippedDown,
    });
    prevUpper = upper;
    prevLower = lower;
    prevDir = dir;
    prevSuper = superVal;
  }
  return out;
}
