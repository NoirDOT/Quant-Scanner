// /home/z/my-project/build/hubb-final/HUBB/src/app/api/scanner/smt-psp-pro/route.ts
// SMT/PSP PRO dedicated endpoint.
//
// Per Untitled.txt: "create a dedicated API endpoint" for SMT/PSP PRO.

import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";
import { smtPspProScanner, SMT_PSP_PRO_STRATEGY_INFO, autoPairRouter } from "@/lib/scanner/smt-psp-pro";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { symbol, display, assetClass, timeframe = "4h" } = body;
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const tf = timeframe as Timeframe;
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) ??
    { symbol, display: display ?? symbol, assetClass: assetClass ?? "forex" };

  const candles = await getCandles(inst.symbol, tf);
  if (candles.length < 50) {
    return NextResponse.json({ error: "insufficient data" }, { status: 400 });
  }

  const mapping = autoPairRouter(inst.symbol);
  const signal = await smtPspProScanner({
    symbol: inst.symbol,
    display: inst.display,
    assetClass: inst.assetClass,
    timeframe: tf,
    candles,
  });

  return NextResponse.json({
    signal,
    autoPairMapping: mapping,
    meta: { symbol: inst.symbol, timeframe: tf, candleCount: candles.length },
  });
}

export async function GET() {
  return NextResponse.json({
    strategy: SMT_PSP_PRO_STRATEGY_INFO,
    description: "SMT/PSP PRO scanner — Auto Duo/Triad + 4-layer SMT + CISD + PSP",
  });
}
