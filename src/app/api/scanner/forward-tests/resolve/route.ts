// POST /api/scanner/forward-tests/resolve
// Nightly job: replays subsequent candles for each unresolved ForwardTestSignal
// to determine whether STOP or TARGET hit first, then records the R multiple.
//
// Called by scripts/resolve-forward-tests.ts (which is run by a second
// GitHub Actions cron). Protected by API_SECRET.
//
// Logic per signal:
//   - Fetch candles AFTER signalAt (the bar after the signal bar onwards)
//   - For a LONG: stop hit if low <= stopPrice; target hit if high >= targetPrice
//   - For a SHORT: stop hit if high >= stopPrice; target hit if low <= targetPrice
//   - Whichever hits FIRST wins. If both hit in the same bar, prefer the stop
//     (conservative — assume adverse fill first).
//   - R multiple = (exitPrice - entryPrice) / risk  [risk = |entry - stop|]
//     For a long win: R = (target - entry) / risk  (positive)
//     For a long loss: R = (stop - entry) / risk   (negative)
//   - If neither hit within `maxBars` (default 50 bars), mark as "timeout".

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCandles } from "@/lib/scanner/data";
import type { Timeframe } from "@/lib/scanner/instruments";

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
  const batch = Math.min(parseInt(url.searchParams.get("batch") ?? "100", 10), 500);

  // Find unresolved signals that have entry/stop/target (no point resolving incomplete rows)
  const unresolved = await db.forwardTestSignal.findMany({
    where: {
      resolved: false,
      entryPrice: { gt: 0 },
      stopPrice: { gt: 0 },
      targetPrice: { gt: 0 },
      direction: { in: ["long", "short"] },
    },
    take: batch,
    orderBy: { signalAt: "asc" },
  }).catch((err) => {
    console.error("[resolve] query error:", err);
    return [];
  });

  let resolved = 0;
  let wins = 0;
  let losses = 0;
  let timeouts = 0;
  const errors: string[] = [];

  for (const sig of unresolved) {
    try {
      const tf = sig.timeframe as Timeframe;
      // Fetch candles covering the window after the signal bar.
      // getCandles returns the latest `lookback` bars; we filter to those AFTER signalAt.
      const candles = await getCandles(sig.symbol, tf, 300);
      const signalMs = sig.barTime != null ? sig.barTime * 1000 : sig.signalAt.getTime();
      const after = candles.filter((c) => c.time * 1000 > signalMs);

      let outcome: "win" | "loss" | "timeout" = "timeout";
      let exitPrice: number | null = null;
      let exitAt: Date | null = null;
      let barsToExit = 0;
      const risk = Math.abs(sig.entryPrice - sig.stopPrice);
      if (risk <= 0) {
        // Degenerate — mark as timeout and skip
        await db.forwardTestSignal.update({
          where: { id: sig.id },
          data: { resolved: true, outcome: "timeout", barsToExit: 0 },
        });
        timeouts++;
        resolved++;
        continue;
      }

      for (let i = 0; i < Math.min(after.length, maxBars); i++) {
        const c = after[i];
        barsToExit = i + 1;
        if (sig.direction === "long") {
          const stopHit = c.low <= sig.stopPrice;
          const targetHit = c.high >= sig.targetPrice;
          if (stopHit && targetHit) {
            // Both in same bar — conservative: assume stop first
            outcome = "loss";
            exitPrice = sig.stopPrice;
            exitAt = c.date;
            break;
          } else if (stopHit) {
            outcome = "loss";
            exitPrice = sig.stopPrice;
            exitAt = c.date;
            break;
          } else if (targetHit) {
            outcome = "win";
            exitPrice = sig.targetPrice;
            exitAt = c.date;
            break;
          }
        } else {
          // short
          const stopHit = c.high >= sig.stopPrice;
          const targetHit = c.low <= sig.targetPrice;
          if (stopHit && targetHit) {
            outcome = "loss";
            exitPrice = sig.stopPrice;
            exitAt = c.date;
            break;
          } else if (stopHit) {
            outcome = "loss";
            exitPrice = sig.stopPrice;
            exitAt = c.date;
            break;
          } else if (targetHit) {
            outcome = "win";
            exitPrice = sig.targetPrice;
            exitAt = c.date;
            break;
          }
        }
      }

      // Compute R multiple
      let rMultiple: number | null = null;
      if (exitPrice != null) {
        const sign = sig.direction === "long" ? 1 : -1;
        rMultiple = ((exitPrice - sig.entryPrice) * sign) / risk;
      }

      await db.forwardTestSignal.update({
        where: { id: sig.id },
        data: {
          resolved: true,
          outcome,
          exitPrice: exitPrice ?? undefined,
          exitAt: exitAt ?? undefined,
          rMultiple,
          barsToExit,
        },
      });

      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else timeouts++;
      resolved++;
    } catch (err) {
      errors.push(`${sig.strategyKey}/${sig.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    considered: unresolved.length,
    resolved,
    wins,
    losses,
    timeouts,
    errors: errors.slice(0, 10),
  });
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // Return summary stats grouped by strategyKey + family
  const rows = await db.forwardTestSignal.groupBy({
    by: ["strategyKey", "family"],
    where: { resolved: true },
    _count: { id: true },
    _avg: { rMultiple: true },
    _sum: { rMultiple: true },
    orderBy: { _count: { id: "desc" } },
    take: 50,
  }).catch((err) => {
    console.error("[resolve] GET groupBy error:", err);
    return [];
  });

  return NextResponse.json({
    ok: true,
    strategies: rows.map((r) => ({
      strategyKey: r.strategyKey,
      family: r.family,
      trades: r._count.id,
      avgR: r._avg.rMultiple,
      totalR: r._sum.rMultiple,
    })),
  });
}
