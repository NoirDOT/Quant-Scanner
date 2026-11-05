// POST /api/scanner/paper-trades/close
// Nightly job — closes open paper trades by replaying candles.
// Updates account balance + P&L stats.
//
// Query params:
//   ?maxBars=50   Max bars to wait before declaring timeout
//
// Auth: requires API_SECRET (or CRON_SECRET).

import { NextRequest, NextResponse } from "next/server";
import { closeOpenPaperTrades } from "@/lib/scanner/paperTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const maxBars = parseInt(url.searchParams.get("maxBars") ?? "50", 10);

  try {
    const result = await closeOpenPaperTrades(maxBars);
    return NextResponse.json({
      ok: true,
      closed: result.closed,
      wins: result.wins,
      losses: result.losses,
      timeouts: result.timeouts,
      totalPnl: result.totalPnl,
      totalR: result.totalR,
      errors: result.errors.slice(0, 5),
    });
  } catch (err) {
    console.error("[paper-trades/close] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
