// POST /api/scanner/cleanup
// Nightly job — deletes old signal messages from the Discord channel so it
// doesn't get cluttered. Uses the Discord bot token (not the webhook).
//
// Query params:
//   ?maxAgeHours=24   Delete messages older than this (default 24)
//
// Auth: requires API_SECRET (or CRON_SECRET) as Bearer token.

import { NextRequest, NextResponse } from "next/server";
import { deleteOldMessages } from "@/lib/scanner/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const maxAgeHours = parseInt(url.searchParams.get("maxAgeHours") ?? "24", 10);

  try {
    const result = await deleteOldMessages(maxAgeHours);
    return NextResponse.json({
      ok: true,
      deleted: result.deleted,
      total: result.total,
      maxAgeHours,
    });
  } catch (err) {
    console.error("[cleanup] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Preview mode — fetch messages without deleting
  const { fetchRecentMessages } = await import("@/lib/scanner/bot");
  const messages = await fetchRecentMessages(100);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const oldCount = messages.filter((m) => new Date(m.timestamp).getTime() < cutoff).length;

  return NextResponse.json({
    ok: true,
    total: messages.length,
    olderThan24h: oldCount,
    wouldDelete: oldCount,
  });
}
