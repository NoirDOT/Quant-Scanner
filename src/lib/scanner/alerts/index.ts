// Alert dispatcher — sends signals to configured channels.
// Currently supports: Discord (webhook), Telegram (bot), Email (SMTP).

import type { ScanSignal } from "../types";
import { db } from "@/lib/db";
import { sendDiscordAlert } from "./discord";

// Re-export init functions for the alerts API route
export { initTelegram } from "./telegram";
export { initEmail } from "./email";

export async function dispatchAlerts(signals: ScanSignal[]): Promise<void> {
  // 1. Discord — fires for every signal with score >= 70 (grade A+ / A)
  // Just needs DISCORD_WEBHOOK_URL env var. No DB config needed.
  if (process.env.DISCORD_WEBHOOK_URL) {
    for (const sig of signals) {
      try {
        await sendDiscordAlert(sig);
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
