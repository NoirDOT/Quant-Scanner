// POST /api/scanner/paper-trades/post-summary
// Fetches the paper trading summary and posts it to Discord via the bot.
// Called nightly after the close job finishes.
//
// Auth: requires API_SECRET (or CRON_SECRET).

import { NextRequest, NextResponse } from "next/server";
import { getPaperTradeSummary } from "@/lib/scanner/paperTrade";
import { postDailySummary } from "@/lib/scanner/bot";

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

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getPaperTradeSummary();
    if (!summary) {
      return NextResponse.json({ ok: false, error: "No account found" }, { status: 404 });
    }

    const posted = await postDailySummary(summary);
    return NextResponse.json({
      ok: posted,
      balance: summary.account.currentBalance,
      roi: summary.account.roi,
      openTrades: summary.openTrades.length,
      todayClosed: summary.todayClosed.length,
    });
  } catch (err) {
    console.error("[paper-trades/post-summary] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
