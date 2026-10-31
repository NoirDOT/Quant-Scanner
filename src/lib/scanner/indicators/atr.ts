// /home/z/my-project/src/lib/scanner/indicators/atr.ts

export function trueRange(
  highs: number[],
  lows: number[],
  closes: number[]
): number[] {
  const out: number[] = [0];
  for (let i = 1; i < highs.length; i++) {
    out.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  return out;
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): (number | null)[] {
  const tr = trueRange(highs, lows, closes);
  const out: (number | null)[] = [];
  let sum = 0;
  let prev: number | null = null;
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      out.push(null);
      continue;
    }
    if (i <= period) {
      sum += tr[i];
      if (i === period) {
        prev = sum / period;
        out.push(prev);
      } else {
        out.push(null);
      }
      continue;
    }
    prev = (prev! * (period - 1) + tr[i]) / period;
    out.push(prev);
  }
  return out;
}
