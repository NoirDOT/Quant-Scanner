// /home/z/my-project/build/hubb-final/HUBB/src/app/api/scanner/backtest-all/route.ts
// Backtest ALL scanners across instruments × timeframes.
//
// Reconstructed from Untitled.txt:
//   "Build src/app/api/scanner/backtest-all/route.ts — runs backtests on every
//    scanner × 6 instruments × 3 timeframes (1h/4h/1d) and aggregates"
//
// Calls backtestScannerAll() from src/lib/scanner/strategies/graded-scanner.ts.

import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/scanner/data";
import { INSTRUMENTS, type Timeframe } from "@/lib/scanner/instruments";
import { backtestScannerAll } from "@/lib/scanner/strategies/graded-scanner";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    instruments: requestedInstruments,
    timeframes = ["1h", "4h", "1d"],
  } = body;

  // Default instruments: 6 from Untitled.txt (EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD, US500)
  const defaultInstruments = [
    { symbol: "EURUSD", display: "EUR/USD", assetClass: "forex" },
    { symbol: "GBPUSD", display: "GBP/USD", assetClass: "forex" },
    { symbol: "USDJPY", display: "USD/JPY", assetClass: "forex" },
    { symbol: "XAUUSD", display: "Gold", assetClass: "commodity" },
    { symbol: "BTCUSD", display: "BTC/USD", assetClass: "crypto" },
    { symbol: "US500", display: "S&P 500", assetClass: "index" },
  ];
  const instruments = requestedInstruments ?? defaultInstruments;
  const tfs = timeframes as Timeframe[];

  // Fetch candles for all symbol×TF combos
  const candlesBySymbolTf = new Map<string, import("@/lib/scanner/data").Candle[]>();
  for (const inst of instruments) {
    for (const tf of tfs) {
      try {
        // Map display symbol to Yahoo symbol if needed
        const yahooSymbol = INSTRUMENTS.find(
          (i) => i.display.replace("/", "") === inst.symbol || i.symbol === inst.symbol,
        )?.symbol ?? inst.symbol;
        const candles = await getCandles(yahooSymbol, tf);
        if (candles.length > 0) {
          candlesBySymbolTf.set(`${inst.symbol}:${tf}`, candles);
        }
      } catch (err) {
        console.error(`[backtest-all] getCandles(${inst.symbol}, ${tf}) failed:`, err);
      }
    }
  }

  const results = await backtestScannerAll(candlesBySymbolTf, instruments, tfs);

  return NextResponse.json({
    count: results.length,
    results,
    meta: {
      instrumentsScanned: instruments.length,
      timeframesScanned: tfs,
      candleDataPoints: [...candlesBySymbolTf.values()].reduce((s, cs) => s + cs.length, 0),
    },
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/scanner/backtest-all",
    description: "Runs backtests on every scanner × 6 instruments × 3 timeframes and aggregates",
    defaultInstruments: ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD", "US500"],
    defaultTimeframes: ["1h", "4h", "1d"],
  });
}
