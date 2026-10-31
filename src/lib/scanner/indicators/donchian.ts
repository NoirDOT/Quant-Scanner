// /home/z/my-project/src/lib/scanner/indicators/donchian.ts

export interface DonchianState {
  upper: number;
  lower: number;
  middle: number;
  brokeUp: boolean;
  brokeDown: boolean;
}

export function donchian(
  highs: number[],
  lows: number[],
  period = 20
): (DonchianState | null)[] {
  const out: (DonchianState | null)[] = [];
  let prevUpper = -Infinity;
  let prevLower = Infinity;
  for (let i = 0; i < highs.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, highs[j]);
      lo = Math.min(lo, lows[j]);
    }
    out.push({
      upper: hi,
      lower: lo,
      middle: (hi + lo) / 2,
      brokeUp: i > period && prevUpper !== -Infinity ? closesProxy(highs, i) > prevUpper : false,
      brokeDown: i > period && prevLower !== Infinity ? closesProxyLows(lows, i) < prevLower : false,
    });
    prevUpper = hi;
    prevLower = lo;
  }
  return out;
}

// helper — Donchian "breakout" usually uses close price vs the prior upper/lower bound
function closesProxy(highs: number[], i: number): number {
  return highs[i];
}
function closesProxyLows(lows: number[], i: number): number {
  return lows[i];
}

// Cleaner version using closes
export function donchianFromCloses(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20
): (DonchianState | null)[] {
  const out: (DonchianState | null)[] = [];
  let prevUpper = -Infinity;
  let prevLower = Infinity;
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    // Donchian channel excludes current bar to detect true breakout
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      hi = Math.max(hi, highs[j]);
      lo = Math.min(lo, lows[j]);
    }
    out.push({
      upper: hi,
      lower: lo,
      middle: (hi + lo) / 2,
      brokeUp: closes[i] > prevUpper,
      brokeDown: closes[i] < prevLower,
    });
    prevUpper = hi;
    prevLower = lo;
  }
  return out;
}
