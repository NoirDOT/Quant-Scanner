// app/api/detectors/route.ts
import { NextResponse } from "next/server";

const DETECTORS = [
  { key: "detectFVGs", label: "Fair Value Gaps", category: "ict", outputType: "FVG[]", description: "3-candle imbalance patterns with mitigation status" },
  { key: "detectOrderBlocks", label: "Order Blocks", category: "ict", outputType: "OrderBlock[]", description: "Last opposing candle before displacement" },
  { key: "detectLiquiditySweeps", label: "Liquidity Sweeps", category: "ict", outputType: "LiquiditySweep[]", description: "Buyside/sellside raids with close-back-inside" },
  { key: "detectStructure", label: "BOS / CHoCH", category: "structure", outputType: "StructureEvent[]", description: "Break of structure + change of character events" },
  { key: "detectOTE", label: "Optimal Trade Entry", category: "ict", outputType: "OTE[]", description: "62-79% Fibonacci retracement zones" },
  { key: "premiumDiscount", label: "Premium/Discount", category: "ict", outputType: "PremiumDiscount", description: "Dealing range upper/lower half location" },
  { key: "activeKillzones", label: "Active Killzones", category: "session", outputType: "ActiveKillzone[]", description: "London / NY / Silver Bullet / Asia sessions" },
  { key: "detectOrigin", label: "HORC Origin", category: "horc", outputType: "MoveStructure", description: "Origin + passive/aggressor + relative passives (Ch 1-2)" },
  { key: "buildComparison", label: "HORC Coordinates", category: "horc", outputType: "CoordinateComparison", description: "M/W/D participant sign comparison (Ch 4)" },
  { key: "findHighestConclusive", label: "HORC Opposition", category: "horc", outputType: "OppositionResult[]", description: "Opposition rule across eligible timeframes (Ch 5)" },
  { key: "classifyLiquidity", label: "HORC Liquidity", category: "horc", outputType: "LiquidityPoint | null", description: "Internal/external + tier classification (Ch 6-7)" },
  { key: "detectAndTrackZones", label: "HORC Zones", category: "horc", outputType: "Zone[]", description: "Supply/demand zones with mitigation tracking (Ch 8-9)" },
  { key: "findValidAOIs", label: "HORC AOIs", category: "horc", outputType: "AreaOfInterest[]", description: "Valid areas of interest via source-to-target mapping (Ch 10)" },
  { key: "findIntradayLiquidity", label: "HORC Intraday", category: "horc", outputType: "IntradayLiquidity | null", description: "17-hour elapsed-time calculation (Ch 11)" },
  { key: "stackedEma", label: "EMA Stack", category: "indicator", outputType: "EMAState[]", description: "8/21/50/200 EMA stack states" },
  { key: "macd", label: "MACD", category: "indicator", outputType: "MACDState[]", description: "MACD line + signal + histogram" },
  { key: "adx", label: "ADX", category: "indicator", outputType: "ADXState[]", description: "ADX trend strength + +DI/-DI" },
  { key: "rsi", label: "RSI", category: "indicator", outputType: "number[]", description: "Relative Strength Index" },
  { key: "atr", label: "ATR", category: "indicator", outputType: "number[]", description: "Average True Range" },
  { key: "supertrend", label: "Supertrend", category: "indicator", outputType: "SupertrendState[]", description: "Supertrend direction + flips" },
  { key: "psar", label: "PSAR", category: "indicator", outputType: "PSARState[]", description: "Parabolic SAR with flips" },
  { key: "ichimoku", label: "Ichimoku", category: "indicator", outputType: "IchimokuState[]", description: "Tenkan/Kijun/Senkou cloud" },
  { key: "heikinAshi", label: "Heikin-Ashi", category: "indicator", outputType: "HACandle[]", description: "Heikin-Ashi OHLC conversion" },
  { key: "donchianFromCloses", label: "Donchian", category: "indicator", outputType: "DonchianState[]", description: "N-period high/low channel" },
];

export async function GET() {
  return NextResponse.json({
    layer: 1,
    description: "Atomic pattern recognizers — extract data, don't make trade decisions",
    count: DETECTORS.length,
    detectors: DETECTORS,
  });
}
