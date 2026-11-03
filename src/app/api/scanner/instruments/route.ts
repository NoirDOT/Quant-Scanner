// src/app/api/instruments/route.ts
import { NextResponse } from "next/server";
import { INSTRUMENTS, TIMEFRAMES, ASSET_CLASS_LABELS, type AssetClass } from "@/lib/scanner/instruments";

export async function GET() {
  return NextResponse.json({
    instruments: INSTRUMENTS,
    timeframes: TIMEFRAMES,
    assetClassLabels: ASSET_CLASS_LABELS,
    assetClasses: Object.keys(ASSET_CLASS_LABELS) as AssetClass[],
  });
}
