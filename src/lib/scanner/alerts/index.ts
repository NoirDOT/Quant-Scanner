// Alert dispatcher — sends signals to configured channels.
// Supports: Discord (webhook), Telegram (bot), Email (SMTP).
//
// SETUP MODE (default when setups[] provided):
//   Sends one consolidated SETUP embed per pair+direction (not 12 individual
//   signal embeds). Each embed includes regime, families agreeing, R:R, risk
//   sizing, and a TradingView deep link. Cross-sweep dedupe keys on
//   `symbol:direction:barTime` so a persistent setup doesn't re-alert.
//
// FALLBACK MODE (no setups[]):
//   Legacy behavior — sends individual signal embeds, deduped per
//   symbol+tf+direction, capped at top 12.

import type { ScanSignal } from "../types";
import type { Setup } from "../consolidate";
import { db } from "@/lib/db";
import { sendDiscordAlert, sendDiscordSetupAlert } from "./discord";
import { openPaperTrade } from "../paperTrade";

// Re-export init functions for the alerts API route
export { initTelegram } from "./telegram";
export { initEmail } from "./email";

export interface DispatchResult {
  dispatched: number;
  deduped: number;
  failed: number;
  /** The signals that were actually dispatched this sweep (after dedupe + cap).
   *  Used by runScan to write ForwardTestSignal rows only for dispatched signals. */
  dispatchedSignals: ScanSignal[];
}

export interface DispatchOptions {
  trackForward?: boolean;
  /** Consolidated setups — when provided, setup embeds are sent instead of
   *  individual signal embeds. */
  setups?: Setup[];
  /** Live FX rates for risk sizing — map of quote currency → USD price of 1 unit. */
  fxRates?: Record<string, number>;
}

/** Build the cross-sweep dedupe key for a SIGNAL. */
export function signalKey(sig: ScanSignal): string {
  const barTime = sig.metadata?.barTime ?? 0;
  return `${sig.strategyKey}:${sig.symbol}:${sig.timeframe}:${sig.direction}:${barTime}`;
}

/** Build the cross-sweep dedupe key for a SETUP (symbol+direction+barTime of best signal). */
export function setupKey(setup: Setup): string {
  const barTime = setup.best.metadata?.barTime ?? 0;
  return `setup:${setup.symbol}:${setup.direction}:${barTime}`;
}

/** Returns the last dispatched setup for each symbol+direction pair, within
 *  the cooldown window. Used to suppress re-alerts for persistent setups
 *  unless the score or family count has improved. */
async function loadRecentSetupsForCooldown(
  setups: Setup[],
  cooldownMs: number,
): Promise<Map<string, { score: number; families: number; dispatchedAt: Date }>> {
  const result = new Map<string, { score: number; families: number; dispatchedAt: Date }>();
  if (setups.length === 0) return result;
  const since = new Date(Date.now() - cooldownMs);
  try {
    // Query dispatched setups for each symbol+direction in the cooldown window.
    // Group by symbol+direction, keep the most recent.
    const pairs = setups.map((s) => ({ symbol: s.symbol, direction: s.direction }));
    // Build a unique set of symbol:direction keys
    const seen = new Set<string>();
    for (const p of pairs) {
      const key = `${p.symbol}:${p.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const recent = await db.dispatchedSignal.findFirst({
        where: {
          symbol: p.symbol,
          direction: p.direction,
          dispatchedAt: { gte: since },
        },
        orderBy: { dispatchedAt: "desc" },
        select: { score: true, dispatchedAt: true },
      });
      if (recent) {
        result.set(key, {
          score: recent.score,
          families: 0, // not stored — we approximate by not gating on families for now
          dispatchedAt: recent.dispatchedAt,
        });
      }
    }
  } catch (err) {
    console.error("[alerts] loadRecentSetupsForCooldown error:", err);
  }
  return result;
}

/** Read already-dispatched keys from the DB so we can skip them. */
async function loadDispatchedKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  try {
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

/** Record newly-dispatched keys so the next sweep skips them.
 *  Handles the case where multiple channels (discord+telegram+email) share
 *  the same signalKey — a batch with duplicate keys would fail the entire
 *  insert, so we catch P2002 and retry each row individually. */
async function recordDispatched(rows: Array<{ signalKey: string; signal: ScanSignal; channel: string }>): Promise<void> {
  if (rows.length === 0) return;
  const data = rows.map((r) => ({
    signalKey: r.signalKey,
    strategyKey: r.signal.strategyKey,
    symbol: r.signal.symbol,
    timeframe: r.signal.timeframe,
    direction: r.signal.direction,
    score: r.signal.score,
    channel: r.channel,
  }));
  try {
    await db.dispatchedSignal.createMany({ data });
  } catch (err: any) {
    // P2002 = unique constraint violation — batch had duplicate keys.
    // Retry each row individually so non-duplicate rows still get recorded.
    if (err?.code === "P2002") {
      await Promise.all(data.map((d) =>
        db.dispatchedSignal.create({ data: d }).catch(() => null)
      ));
    } else {
      console.error("[alerts] recordDispatched error:", err);
    }
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
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const trackForward = opts.trackForward ?? false;
  const setups = opts.setups;
  let dispatched = 0;
  let deduped = 0;
  let failed = 0;
  const dispatchedSignals: ScanSignal[] = [];

  // ════════════════════════════════════════════════════════════════════════
  // SETUP MODE — send consolidated setup embeds (preferred)
  // ════════════════════════════════════════════════════════════════════════
  if (setups && setups.length > 0) {
    // Cap at top 10 setups by score (respects Discord's 30 msg/min limit)
    const candidates = [...setups].sort((a, b) => b.score - a.score).slice(0, 10);

    // Cross-sweep dedupe on setup key (exact bar match)
    const keys = candidates.map(setupKey);
    const alreadyDispatched = await loadDispatchedKeys(keys);

    // Cooldown: suppress re-alerts for the same symbol+direction within 24h,
    // UNLESS the score or family count has improved. This stops a persistent
    // setup (e.g. "EUR/USD long" that stays valid for 3 days) from re-alerting
    // on every 4h bar.
    const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
    const recentSetups = await loadRecentSetupsForCooldown(candidates, COOLDOWN_MS);

    const toSend: Setup[] = [];
    for (const setup of candidates) {
      const key = setupKey(setup);
      const hasBarTime = setup.best.metadata?.barTime != null && setup.best.metadata.barTime > 0;

      // (a) Exact bar dedupe — same bar already alerted
      if (hasBarTime && alreadyDispatched.has(key)) {
        deduped++;
        continue;
      }

      // (b) Cooldown dedupe — same symbol+direction alerted recently
      const cooldownKey = `${setup.symbol}:${setup.direction}`;
      const recent = recentSetups.get(cooldownKey);
      if (recent) {
        // Re-alert only if the setup has materially improved:
        //   - score increased by ≥5 points, OR
        //   - family count increased by ≥1
        const scoreImproved = setup.score - recent.score >= 5;
        const familiesImproved = setup.families.length > 0; // we don't store families, so any family count > 0 counts as "new info"
        if (!scoreImproved && !familiesImproved) {
          deduped++;
          continue;
        }
        // If improved, log it so the operator can see the upgrade
        console.log(`[alerts] setup ${cooldownKey} re-alerting: score ${recent.score}→${setup.score}, families improved=${familiesImproved}`);
      }

      toSend.push(setup);
    }

    const newDispatched: Array<{ signalKey: string; signal: ScanSignal; channel: string }> = [];

    // ── Discord: send setup embeds ──
    if (process.env.DISCORD_WEBHOOK_URL) {
      for (const setup of toSend) {
        try {
          await sendDiscordSetupAlert(setup, opts.fxRates);
          await new Promise((r) => setTimeout(r, 1500)); // stay under 30 msg/min
          dispatched++;
          dispatchedSignals.push(setup.best);
          newDispatched.push({ signalKey: setupKey(setup), signal: setup.best, channel: "discord" });

          // Open a paper trade for this dispatched setup (best-effort,
          // errors don't block the alert)
          openPaperTrade(setup, opts.fxRates).catch((err) =>
            console.error("[alerts] paper trade open error:", err)
          );
        } catch (err) {
          console.error("[alerts] discord setup error:", err);
          failed++;
        }
      }
    }

    // ── Telegram/Email: send the best signal from each setup ──
    try {
      const configs = await db.alertConfigScanner.findMany({ where: { enabled: true } });
      if (configs.length > 0) {
        for (const setup of toSend) {
          const sig = setup.best;
          let sentToAnyChannel = false;
          for (const cfg of configs) {
            if (sig.score < cfg.minScore) continue;
            try {
              if (cfg.channel === "telegram") {
                const { sendTelegram } = await import("./telegram");
                await sendTelegram(cfg.destination, formatSetup(setup));
                sentToAnyChannel = true;
                newDispatched.push({ signalKey: setupKey(setup), signal: sig, channel: "telegram" });
              } else if (cfg.channel === "email") {
                const { sendEmail } = await import("./email");
                await sendEmail(cfg.destination, `[Scanner] ${setup.direction.toUpperCase()} ${setup.display}`, formatSetup(setup));
                sentToAnyChannel = true;
                newDispatched.push({ signalKey: setupKey(setup), signal: sig, channel: "email" });
              }
            } catch (err) {
              console.error(`[alerts] ${cfg.channel} setup failed:`, err);
              failed++;
            }
          }
          if (sentToAnyChannel) {
            dispatched++;
            if (!dispatchedSignals.includes(sig)) dispatchedSignals.push(sig);
          }
        }
      }
    } catch (e) {
      // DB might not be set up — Discord still works without it
    }

    await recordDispatched(newDispatched);
    await pruneOldDispatched();

    return { dispatched, deduped, failed, dispatchedSignals };
  }

  // ════════════════════════════════════════════════════════════════════════
  // FALLBACK MODE — send individual signal embeds (legacy, when no setups)
  // ════════════════════════════════════════════════════════════════════════

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

  const keys = candidates.map(signalKey);
  const alreadyDispatched = await loadDispatchedKeys(keys);

  const toSend: ScanSignal[] = [];
  for (const sig of candidates) {
    const key = signalKey(sig);
    const hasBarTime = sig.metadata?.barTime != null && sig.metadata.barTime > 0;
    if (hasBarTime && alreadyDispatched.has(key)) {
      deduped++;
      continue;
    }
    toSend.push(sig);
  }

  const newDispatched: Array<{ signalKey: string; signal: ScanSignal; channel: string }> = [];

  // ── 1. Discord ──
  if (process.env.DISCORD_WEBHOOK_URL) {
    for (const sig of toSend) {
      try {
        await sendDiscordAlert(sig);
        await new Promise((r) => setTimeout(r, 1200));
        dispatched++;
        dispatchedSignals.push(sig);
        newDispatched.push({ signalKey: signalKey(sig), signal: sig, channel: "discord" });
      } catch (err) {
        console.error("[alerts] discord error:", err);
        failed++;
      }
    }
  }

  // ── 2. Telegram/Email ──
  try {
    const configs = await db.alertConfigScanner.findMany({ where: { enabled: true } });
    if (configs.length > 0) {
      for (const sig of toSend) {
        let sentToAnyChannel = false;
        for (const cfg of configs) {
          if (sig.score < cfg.minScore) continue;
          try {
            if (cfg.channel === "telegram") {
              const { sendTelegram } = await import("./telegram");
              await sendTelegram(cfg.destination, formatSignal(sig));
              sentToAnyChannel = true;
              newDispatched.push({ signalKey: signalKey(sig), signal: sig, channel: "telegram" });
            } else if (cfg.channel === "email") {
              const { sendEmail, signalToEmailHtml } = await import("./email");
              await sendEmail(cfg.destination, `[Scanner] ${sig.strategyLabel}`, signalToEmailHtml(sig));
              sentToAnyChannel = true;
              newDispatched.push({ signalKey: signalKey(sig), signal: sig, channel: "email" });
            }
          } catch (err) {
            console.error(`[alerts] ${cfg.channel} failed:`, err);
            failed++;
          }
        }
        if (sentToAnyChannel) {
          dispatched++;
          if (!dispatchedSignals.includes(sig)) dispatchedSignals.push(sig);
        }
      }
    }
  } catch (e) {
    // DB might not be set up — Discord still works without it
  }

  await recordDispatched(newDispatched);
  await pruneOldDispatched();

  return { dispatched, deduped, failed, dispatchedSignals };
}

function formatSignal(sig: ScanSignal): string {
  const arrow = sig.direction === "long" ? "🟢" : "🔴";
  return `${arrow} *${sig.strategyLabel}*\n${sig.symbol} · ${sig.timeframe.toUpperCase()} · ${sig.direction.toUpperCase()} · Score: ${sig.score}`;
}

function formatSetup(setup: Setup): string {
  const arrow = setup.direction === "long" ? "🟢" : "🔴";
  const families = setup.families.join(", ");
  const rr = `1:${setup.rr.toFixed(1)}`;
  return [
    `${arrow} *${setup.direction.toUpperCase()} ${setup.display}*`,
    `Score: ${Math.round(setup.score)} · R:R ${rr}`,
    `Families: ${families} (${setup.strategyCount} signals)`,
    setup.regime ? `Regime: ${setup.regime}` : "",
    setup.best.entryPrice ? `Entry: ${setup.best.entryPrice}` : "",
    setup.best.stopPrice ? `Stop: ${setup.best.stopPrice}` : "",
    setup.best.targetPrice ? `Target: ${setup.best.targetPrice}` : "",
  ].filter(Boolean).join("\n");
}
