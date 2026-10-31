// Discord webhook transport — sends signal alerts to one Discord channel.
// No bot needed — just a webhook URL.
// Set DISCORD_WEBHOOK_URL in .env (or Vercel env vars).

import type { ScanSignal } from "../types";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";
const MIN_SCORE = 70; // only send grade A+ / A signals

export async function sendDiscordAlert(signal: ScanSignal): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  if (signal.score < MIN_SCORE) return false;

  const isLong = signal.direction === "long";
  const arrow = isLong ? "🟢" : "🔴";
  const dirText = isLong ? "LONG" : "SHORT";
  const color = isLong ? 0x22c55e : 0xef4444;
  const scannerName = signal.strategyKey.replace(/^(trend|ict|ea|community|horc|channel)-/, "");

  const embed = {
    title: `${arrow} ${dirText} ${signal.display}`,
    description: [
      `**${scannerName}** · Score ${signal.score} · Grade ${signal.grade ?? "—"}`,
      `**Entry:** ${signal.entryPrice?.toFixed(5) ?? "—"}`,
      `**Stop:** ${signal.stopPrice?.toFixed(5) ?? "—"}`,
      `**Target:** ${signal.targetPrice?.toFixed(5) ?? "—"}`,
      signal.reasons?.[0] ?? "",
    ].join("\n"),
    color,
    timestamp: new Date().toISOString(),
    footer: { text: `Quant Scanner · ${signal.timeframe.toUpperCase()}` },
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendDiscordAlerts(signals: ScanSignal[]): Promise<number> {
  let sent = 0;
  for (const sig of signals) {
    const ok = await sendDiscordAlert(sig);
    if (ok) sent++;
  }
  return sent;
}
