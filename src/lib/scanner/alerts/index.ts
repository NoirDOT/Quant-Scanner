// Alert dispatcher — sends signals to configured channels.
// Currently supports: Discord (webhook), Telegram (bot), Email (SMTP).

import type { ScanSignal } from "../types";
import { db } from "@/lib/db";
import { sendDiscordAlert } from "./discord";

// Re-export init functions for the alerts API route
export { initTelegram } from "./telegram";
export { initEmail } from "./email";

export async function dispatchAlerts(signals: ScanSignal[]): Promise<void> {
  // 1. Discord — needs DISCORD_WEBHOOK_URL env var. No DB config needed.
  //    A full sweep can produce 600+ raw signals (10 trader models all firing
  //    on the same pair). Flooding Discord with hundreds of embeds also blows
  //    the 30 msg/min webhook rate limit. So:
  //      a) score >= 50 only
  //      b) dedupe: keep the BEST signal per symbol+timeframe+direction
  //         (the 10 trader models collapse into one embed per pair)
  //      c) cap at the top 12 per sweep, sorted by score
  if (process.env.DISCORD_WEBHOOK_URL) {
    const best = new Map<string, ScanSignal>();
    for (const sig of signals) {
      if (sig.score < 50) continue;
      const key = `${sig.symbol}:${sig.timeframe}:${sig.direction}`;
      const prev = best.get(key);
      if (!prev || sig.score > prev.score) best.set(key, sig);
    }
    const toSend = Array.from(best.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    for (const sig of toSend) {
      try {
        await sendDiscordAlert(sig);
        await new Promise((r) => setTimeout(r, 1200)); // stay under 30 msg/min
      } catch (err) {
        console.error("[alerts] discord error:", err);
      }
    }
  }

  // 2. DB-configured alerts (telegram, email) — reads AlertConfigScanner table
  try {
    const configs = await db.alertConfigScanner.findMany({
      where: { enabled: true },
    });

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
}

function formatSignal(sig: ScanSignal): string {
  const arrow = sig.direction === "long" ? "🟢" : "🔴";
  return `${arrow} *${sig.strategyLabel}*\n${sig.symbol} · ${sig.timeframe.toUpperCase()} · ${sig.direction.toUpperCase()} · Score: ${sig.score}`;
}
