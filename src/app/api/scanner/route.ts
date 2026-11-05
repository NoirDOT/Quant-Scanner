// /api/scanner/route.ts
// Unified scanner API — runs the strategy catalog on a set of instruments.
// All signals are passed through the universal A+/A/B+/B-/C grading layer
// before returning.
//
// AUTH MODEL:
//   - GET (catalog): public — anyone can list strategies/instruments.
//   - POST (scan):   public — but `dispatch` and `persist` are FORCED OFF
//     unless the caller provides API_SECRET (admin) or BROWSER_SECRET (UI).
//     This means anonymous attackers can't spam Discord or write DB rows.
//
// For internal cron use, call runScan() directly via /api/scanner/ping
// (no HTTP self-fetch).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TIMEFRAMES } from "@/lib/scanner/instruments";
import { TREND_STRATEGIES } from "@/lib/scanner/strategies/trend";
import { ICT_STRATEGIES } from "@/lib/scanner/strategies/ict";
import { TRADER_STRATEGIES } from "@/lib/scanner/strategies/traders";
import { EA_SCANNERS_INFO, EA_STRATEGIES } from "@/lib/scanner/strategies/eas";
import { HORC_SCANNERS_INFO } from "@/lib/scanner/strategies/horc";
import { runScan } from "@/lib/scanner/runScan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ScanBody = z.object({
  strategyType: z.enum(["trend", "ict", "trader", "ea", "horc", "all"]).optional(),
  strategies: z.array(z.string().max(80)).max(60).optional(),
  traderKeys: z.array(z.string().max(80)).max(20).optional(),
  eaKeys: z.array(z.string().max(80)).max(60).optional(),
  instruments: z.union([z.string().max(20), z.array(z.string().max(20)).max(50)]).optional(),
  assetClasses: z.array(z.string().max(20)).max(10).optional(),
  timeframes: z.array(z.enum(["1h", "2h", "4h", "1d", "1w"])).max(5).optional(),
  minScore: z.number().min(0).max(100).optional(),
  persist: z.boolean().optional(),
  dispatch: z.boolean().optional(),
  filterKeys: z.array(z.string().max(80)).max(20).optional(),
}).strict();

/** Returns true if the caller provided a valid ADMIN secret (API_SECRET or
 *  CRON_SECRET). BROWSER_SECRET is NOT accepted here — it's public in the JS
 *  bundle, so accepting it would let anyone trigger DB writes + Discord sends. */
function isPrivileged(req: NextRequest): boolean {
  const secrets = [
    process.env.API_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  if (secrets.length === 0) return true; // dev mode — no secrets configured
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = ScanBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // Security gate: anonymous callers can scan but CANNOT dispatch or persist.
  // This preserves the browser UX (live scan + see signals) while blocking
  // anonymous attackers from spamming Discord or writing DB rows.
  const privileged = isPrivileged(req);
  const shouldPersist = privileged ? !!body.persist : false;
  const shouldDispatch = privileged ? !!body.dispatch : false;
  if (!privileged && (body.persist || body.dispatch)) {
    // Log so the operator can spot abuse attempts in the function logs.
    console.warn("[scanner] anonymous caller attempted persist/dispatch — stripped");
  }

  try {
    const result = await runScan({
      strategyType: body.strategyType,
      strategies: body.strategies,
      traderKeys: body.traderKeys,
      eaKeys: body.eaKeys,
      instruments: body.instruments,
      assetClasses: body.assetClasses,
      timeframes: body.timeframes,
      minScore: body.minScore,
      persist: shouldPersist,
      dispatch: shouldDispatch,
      filterKeys: body.filterKeys,
    });

    return NextResponse.json({
      count: result.count,
      signals: result.signals,
      setups: result.setups,
      conflictedSetups: result.conflictedSetups,
      meta: {
        ...result.meta,
        dispatchStripped: !privileged && (!!body.dispatch || !!body.persist),
      },
    });
  } catch (err) {
    console.error("[scanner] runScan failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    strategyTypes: ["trend", "ict", "trader", "ea", "horc", "all"],
    trend: TREND_STRATEGIES,
    ict: ICT_STRATEGIES,
    trader: TRADER_STRATEGIES.map((t) => ({
      key: `trader-${t.key}`,
      traderKey: t.key,
      name: t.name,
      description: t.description,
      confidenceLevel: t.confidenceLevel,
      sources: t.sources,
      rules: t.rules,
    })),
    ea: EA_SCANNERS_INFO.map((e) => ({
      ...e,
      strategyKey: e.key,
      eaId: e.key,
      fullDef: EA_STRATEGIES.find((s) => s.id === e.key),
    })),
    horc: HORC_SCANNERS_INFO,
    timeframes: TIMEFRAMES,
    assetClasses: ["forex", "crypto", "commodity", "stock", "index"],
  });
}
