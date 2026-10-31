// /home/z/my-project/src/lib/scanner/alerts/index.ts
export * from "./telegram";
export * from "./email";

import { db } from "@/lib/db";

// Public-facing alert dispatcher
export async function dispatchAlerts(signals: import("../types").ScanSignal[]) {
  for (const sig of signals) {
    if (sig.score < 70) continue; // default min score for alerts
    const configs = await db.alertConfigScanner.findMany({
      where: { enabled: true, minScore: { lte: sig.score } },
    });
    for (const cfg of configs) {
      const keys = cfg.strategyTypes.split(",").map((k) => k.trim());
      if (!keys.includes(sig.strategyKey)) continue;
      try {
        if (cfg.channel === "telegram") {
          const { sendTelegram, signalToTelegramMessage } = await import("./telegram");
          await sendTelegram(cfg.destination, signalToTelegramMessage(sig));
        } else if (cfg.channel === "email") {
          const { sendEmail, signalToEmailHtml } = await import("./email");
          await sendEmail(cfg.destination, `[Scanner] ${sig.strategyLabel} — ${sig.display}`, signalToEmailHtml(sig));
        }
        await db.alertLogScanner.create({
          data: {
            channel: cfg.channel,
            destination: cfg.destination,
            subject: sig.strategyKey,
            body: `${sig.direction} ${sig.symbol} (${sig.timeframe}) score=${sig.score.toFixed(0)}`,
            status: "sent",
          },
        });
      } catch (err) {
        console.error("[alerts] dispatch failed:", err);
      }
    }
  }
}
