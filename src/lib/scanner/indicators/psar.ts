// /home/z/my-project/src/lib/scanner/indicators/psar.ts
// Parabolic SAR

export interface PSARState {
  psar: number;
  isUp: boolean;     // price above PSAR (uptrend)
  isDown: boolean;   // price below PSAR (downtrend)
  flippedUp: boolean;
  flippedDown: boolean;
}

export function psar(
  highs: number[],
  lows: number[],
  closes: number[],
  step = 0.02,
  maxStep = 0.2
): (PSARState | null)[] {
  const len = highs.length;
  const out: (PSARState | null)[] = [];
  let bull = true;
  let psar = lows[0];
  let ep = highs[0];
  let af = step;
  for (let i = 0; i < len; i++) {
    if (i === 0) {
      out.push({
        psar,
        isUp: bull,
        isDown: !bull,
        flippedUp: false,
        flippedDown: false,
      });
      continue;
    }
    const prev = out[i - 1] as PSARState;
    let prevBull = prev.isUp;
    let newPsar = psar + af * (ep - psar);
    if (prevBull) {
      if (lows[i] < newPsar) {
        // reverse
        bull = false;
        newPsar = ep;
        ep = lows[i];
        af = step;
      } else {
        bull = true;
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      if (highs[i] > newPsar) {
        bull = true;
        newPsar = ep;
        ep = highs[i];
        af = step;
      } else {
        bull = false;
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + step, maxStep);
        }
      }
    }
    out.push({
      psar: newPsar,
      isUp: bull,
      isDown: !bull,
      flippedUp: !prevBull && bull,
      flippedDown: prevBull && !bull,
    });
    psar = newPsar;
  }
  return out;
}
