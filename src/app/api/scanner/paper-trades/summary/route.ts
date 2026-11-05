// GET /api/scanner/paper-trades/summary
// Returns the paper trading account summary — balance, win rate, open trades,
// today's closed trades. Used by the daily P&L Discord embed.
//
// Auth: requires API_SECRET (or CRON_SECRET).

import { NextRequest, NextResponse } from "next/server";
import { getPaperTradeSummary } from "@/lib/scanner/paperTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getPaperTradeSummary();
    if (!summary) {
      return NextResponse.json({ ok: false, error: "No account found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[paper-trades/summary] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
