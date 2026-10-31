// /home/z/my-project/src/lib/scanner/indicators/adx.ts
// Wilder's ADX (Average Directional Index) with +DI / -DI

export interface ADXState {
  adx: number;
  plusDI: number;
  minusDI: number;
  trendStrength: "none" | "weak" | "strong" | "very_strong";
  bullishDI: boolean;   // +DI > -DI
  bearishDI: boolean;   // -DI > +DI
}

export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): (ADXState | null)[] {
  const len = closes.length;
  if (len < period * 2) return closes.map(() => null);
  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  // Wilder's smoothing
  const atrArr: number[] = [0];
  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i];
    plusDMSum += plusDM[i];
    minusDMSum += minusDM[i];
  }
  let prevATR = trSum / period;
  atrArr.push(prevATR);
  let prevPlusDI = (plusDMSum / trSum) * 100;
  let prevMinusDI = (minusDMSum / trSum) * 100;
  let dx = Math.abs(prevPlusDI - prevMinusDI) / (prevPlusDI + prevMinusDI || 1) * 100;
  const dxArr: number[] = [dx];
  for (let i = period + 1; i < len; i++) {
    prevATR = (prevATR * (period - 1) + tr[i]) / period;
    atrArr.push(prevATR);
    prevPlusDI = (prevPlusDI * (period - 1) + plusDM[i]) / period;
    prevMinusDI = (prevMinusDI * (period - 1) + minusDM[i]) / period;
    dx = Math.abs(prevPlusDI - prevMinusDI) / (prevPlusDI + prevMinusDI || 1) * 100;
    dxArr.push(dx);
  }
  const adxArr: number[] = [];
  let adxSum = 0;
  const startADX = period * 2;
  for (let i = 0; i < dxArr.length; i++) {
    if (i < period) {
      adxSum += dxArr[i];
      adxArr.push(NaN);
    } else if (i === period) {
      const firstADX = adxSum / period;
      adxArr.push(firstADX);
    } else {
      adxArr.push((adxArr[adxArr.length - 1] * (period - 1) + dxArr[i]) / period);
    }
  }
  // Build output aligned to closes
  const out: (ADXState | null)[] = [];
  let dxIdx = 0;
  for (let i = 0; i < len; i++) {
    if (i < startADX || isNaN(adxArr[dxIdx])) {
      out.push(null);
      if (i >= period) dxIdx++;
      continue;
    }
    const a = adxArr[dxIdx];
    const pdi = prevPlusDI;
    const mdi = prevMinusDI;
    const trendStrength =
      a < 20 ? "none" : a < 30 ? "weak" : a < 50 ? "strong" : "very_strong";
    out.push({
      adx: a,
      plusDI: pdi,
      minusDI: mdi,
      trendStrength,
      bullishDI: pdi > mdi,
      bearishDI: mdi > pdi,
    });
    dxIdx++;
  }
  return out;
}
