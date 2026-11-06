// POST /api/scanner/forge/monte-carlo
// Monte Carlo simulation — shuffles trade order 400 times, reports the
// distribution of final equity + worst-case drawdown.
//
// Body:
//   { trades: Trade[], paths?: number }
//
// Auth: requires API_SECRET or CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { monteCarlo } from "@/lib/scanner/forge/engine";
import type { Trade } from "@/lib/scanner/forge/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return true;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

const BodySchema = z.object({
  trades: z.array(z.object({
    side: z.enum(["long", "short"]),
    entryIndex: z.number(),
    exitIndex: z.number(),
    entryPrice: z.number(),
    exitPrice: z.number(),
    qty: z.number(),
    net: z.number(),
    reason: z.string(),
  })),
  paths: z.number().int().min(100).max(1000).default(400),
});

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { trades, paths } = parsed.data;

  const mc = monteCarlo(trades as Trade[], paths);

  return NextResponse.json({
    ok: true,
    ...mc,
  });
}
