// /home/z/my-project/src/app/api/data/[symbol]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { findInstrument } from "@/lib/scanner/instruments";
import { detectStructure, detectFVGs, detectOrderBlocks, detectLiquiditySweeps, detectOTE, premiumDiscount } from "@/lib/scanner/ict";
import { ema, macd, adx, rsi, supertrend, psar, ichimoku, heikinAshi, donchianFromCloses } from "@/lib/scanner/indicators";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const decoded = decodeURIComponent(symbol);
  const tf = (req.nextUrl.searchParams.get("tf") as any) || "1h";
  const includeIndicators = req.nextUrl.searchParams.get("indicators") === "1";
  const includeIct = req.nextUrl.searchParams.get("ict") === "1";

  const instrument = findInstrument(decoded);
  const candles = await getCandles(decoded, tf);
  if (candles.length === 0) {
    return NextResponse.json(
      { error: `No data found for ${decoded}`, symbol: decoded },
      { status: 404 }
    );
  }
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const opens = candles.map((c) => c.open);

  const indicators = includeIndicators
    ? {
        ema8: ema(closes, 8).slice(-200),
        ema21: ema(closes, 21).slice(-200),
        ema50: ema(closes, 50).slice(-200),
        ema200: ema(closes, 200).slice(-200),
        macd: macd(closes).slice(-200),
        adx: adx(highs, lows, closes).slice(-200),
        rsi: rsi(closes, 14).slice(-200),
        supertrend: supertrend(highs, lows, closes).slice(-200),
        psar: psar(highs, lows, closes).slice(-200),
        ichimoku: ichimoku(highs, lows, closes).slice(-200),
        heikinAshi: heikinAshi(opens, highs, lows, closes).slice(-200),
        donchian: donchianFromCloses(highs, lows, closes).slice(-200),
      }
    : null;

  const ictData = includeIct
    ? {
        structure: detectStructure(candles).slice(-50),
        fvgs: detectFVGs(candles).slice(-30),
        orderBlocks: detectOrderBlocks(candles).slice(-30),
        liquiditySweeps: detectLiquiditySweeps(candles).slice(-30),
        ote: detectOTE(candles).slice(-30),
        premiumDiscount: premiumDiscount(candles).slice(-200),
      }
    : null;

  return NextResponse.json({
    instrument,
    timeframe: tf,
    candles: candles.slice(-500),
    indicators,
    ict: ictData,
  });
}
