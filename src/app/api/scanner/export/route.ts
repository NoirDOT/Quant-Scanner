// /home/z/my-project/src/app/api/export/route.ts
// Export scan results or backtest results as CSV

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "scan";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "200");
  if (type === "scan") {
    const rows = await db.scanResult.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    const header = [
      "strategyKey", "strategyType", "symbol", "timeframe", "direction",
      "score", "reasons", "entryPrice", "stopPrice", "targetPrice", "createdAt"
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        csvEscape(r.strategyKey),
        csvEscape(r.strategyType),
        csvEscape(r.symbol),
        csvEscape(r.timeframe),
        csvEscape(r.direction),
        csvEscape(r.score),
        csvEscape(r.reasonsJson),
        csvEscape(r.entryPrice),
        csvEscape(r.stopPrice),
        csvEscape(r.targetPrice),
        csvEscape(r.createdAt),
      ].join(","));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="scan-results-${Date.now()}.csv"`,
      },
    });
  }
  if (type === "backtest") {
    const rows = await db.backtestByGrade.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    const header = [
      "totalTrades", "winTrades", "lossTrades", "winRate", "profitFactor",
      "maxDrawdown", "avgRR", "netReturn", "createdAt"
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        csvEscape(r.strategyKey),
        csvEscape(r.symbol),
        csvEscape(r.timeframe),
        csvEscape(r.totalTrades),
        csvEscape(r.winRate),
        csvEscape(r.profitFactor),
        csvEscape(r.maxDrawdown),
        csvEscape(r.avgRR),
        csvEscape(r.createdAt),
      ].join(","));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="backtest-results-${Date.now()}.csv"`,
      },
    });
  }
  return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
}
