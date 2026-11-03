// src/app/api/csv-data/route.ts
import { NextResponse } from "next/server";
import { listCsvFiles } from "@/lib/scanner/data-csv";

export async function GET() {
  const files = await listCsvFiles();
  // Group by symbol
  const bySymbol: Record<string, any[]> = {};
  for (const f of files) {
    if (!bySymbol[f.symbol]) bySymbol[f.symbol] = [];
    bySymbol[f.symbol].push(f);
  }
  return NextResponse.json({
    totalFiles: files.length,
    totalSymbols: Object.keys(bySymbol).length,
    bySymbol,
    files,
  });
}
