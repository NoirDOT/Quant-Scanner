// Alert dispatcher — sends signals to configured channels.
// Supports: Discord (webhook), Telegram (bot), Email (SMTP).
//
// CROSS-SWEEP DEDUPE: a signalKey = `${strategyKey}:${symbol}:${tf}:${direction}:${barTime}`
// is recorded in the DispatchedSignal table when first alerted. Subsequent
// sweeps with the same key are silently skipped — so a 4h bar that takes 12
// hours to invalidate won't re-alert every 6 hours. Entries >7d old are pruned.

import type { ScanSignal } from "../types";
import { db } from "@/lib/db";
import { sendDiscordAlert } from "./discord";

// Re-export init functions for the alerts API route
export { initTelegram } from "./telegram";
export { initEmail } from "./email";

export interface DispatchResult {
  dispatched: number;
  deduped: number;
  failed: number;
}

/** Build the cross-sweep dedupe key. barTime comes from signal.metadata.barTime. */
export function signalKey(sig: ScanSignal): string {
  const barTime = sig.metadata?.barTime ?? 0;
  return `${sig.strategyKey}:${sig.symbol}:${sig.timeframe}:${sig.direction}:${barTime}`;
}

/** Read already-dispatched keys from the DB so we can skip them. */
async function loadDispatchedKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  try {
    // Prisma doesn't support `IN` with thousands of items safely; chunk it.
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += 500) chunks.push(keys.slice(i, i + 500));
    const found = await Promise.all(
      chunks.map((c) =>
        db.dispatchedSignal.findMany({
          where: { signalKey: { in: c } },
          select: { signalKey: true },
        })
      )
    );
    return new Set(found.flat().map((r: { signalKey: string }) => r.signalKey));
  } catch (err) {
    console.error("[alerts] loadDispatchedKeys error:", err);
    return new Set();
  }
}

/** Record newly-dispatched keys so the next sweep skips them. */
async function recordDispatched(rows: Array<{ signalKey: string; signal: ScanSignal; channel: string }>): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.dispatchedSignal.createMany({
      data: rows.map((r) => ({
        signalKey: r.signalKey,
        strategyKey: r.signal.strategyKey,
        symbol: r.signal.symbol,
        timeframe: r.signal.timeframe,
        direction: r.signal.direction,
        score: r.signal.score,
        channel: r.channel,
      })),
    });
  } catch (err) {
    console.error("[alerts] recordDispatched error:", err);
  }
}

/** Best-effort prune of dispatched-signal entries older than 7 days. */
async function pruneOldDispatched(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db.dispatchedSignal.deleteMany({ where: { dispatchedAt: { lt: cutoff } } });
  } catch (err) {
    console.error("[alerts] pruneOldDispatched error:", err);
  }
}

export async function dispatchAlerts(
  signals: ScanSignal[],
  opts: { trackForward?: boolean } = {}
): Promise<DispatchResult> {
  const trackForward = opts.trackForward ?? false;
  let dispatched = 0;
  let deduped = 0;
  let failed = 0;

  // ── 1. Discord (env-driven, no DB config required) ──
  if (process.env.DISCORD_WEBHOOK_URL) {
    // Per-sweep dedupe: keep the BEST signal per symbol+tf+direction
    const best = new Map<string, ScanSignal>();
    for (const sig of signals) {
      if (sig.score < 50) continue;
      const key = `${sig.symbol}:${sig.timeframe}:${sig.direction}`;
      const prev = best.get(key);
      if (!prev || sig.score > prev.score) best.set(key, sig);
    }
    const candidates = Array.from(best.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    // Cross-sweep dedupe: skip signals already dispatched for this bar
    const keys = candidates.map(signalKey);
    const alreadyDispatched = await loadDispatchedKeys(keys);

    const toSend: ScanSignal[] = [];
    for (const sig of candidates) {
      const key = signalKey(sig);
      // barTime = 0 means we don't know the bar time — fall back to always-send
      // (legacy behavior) so signals aren't silently dropped if metadata is missing.
      const hasBarTime = sig.metadata?.barTime != null && sig.metadata.barTime > 0;
      if (hasBarTime && alreadyDispatched.has(key)) {
        deduped++;
        continue;
      }
      toSend.push(sig);
    }

    const newDispatched: Array<{ signalKey: string; signal: ScanSignal; channel: string }> = [];
    for (const sig of toSend) {
      try {
        await sendDiscordAlert(sig);
        await new Promise((r) => setTimeout(r, 1200)); // stay under 30 msg/min
        dispatched++;
        newDispatched.push({ signalKey: signalKey(sig), signal: sig, channel: "discord" });
      } catch (err) {
        console.error("[alerts] discord error:", err);
        failed++;
      }
    }
    await recordDispatched(newDispatched);
    await pruneOldDispatched();
  }

  // ── 2. DB-configured alerts (telegram, email) ──
  try {
    const configs = await db.alertConfigScanner.findMany({ where: { enabled: true } });
    for (const sig of signals) {
      if (sig.score < 50) continue;
      for (const cfg of configs) {
        if (sig.score < cfg.minScore) continue;
        try {
          if (cfg.channel === "telegram") {
            const { sendTelegram } = await import("./telegram");
            await sendTelegram(cfg.destination, formatSignal(sig));
          } else if (cfg.channel === "email") {
            const { sendEmail, signalToEmailHtml } = await import("./email");
            await sendEmail(cfg.destination, `[Scanner] ${sig.strategyLabel}`, signalToEmailHtml(sig));
          }
        } catch (err) {
          console.error(`[alerts] ${cfg.channel} failed:`, err);
        }
      }
    }
  } catch (e) {
    // DB might not be set up — Discord still works without it
  }

  // ── 3. Forward-test tracking ──
  // ForwardTestSignal rows are written by runScan() (one per dispatched signal)
  // so a nightly job can replay subsequent candles to compute R multiples.
  // Nothing to do here — dispatchAlerts just signals whether to track.

  return { dispatched, deduped, failed };
}

function formatSignal(sig: ScanSignal): string {
  const arrow = sig.direction === "long" ? "🟢" : "🔴";
  return `${arrow} *${sig.strategyLabel}*\n${sig.symbol} · ${sig.timeframe.toUpperCase()} · ${sig.direction.toUpperCase()} · Score: ${sig.score}`;
}
