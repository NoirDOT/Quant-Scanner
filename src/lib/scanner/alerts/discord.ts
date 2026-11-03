// Discord webhook transport — sends signal alerts to one Discord channel.
// No bot needed — just a webhook URL.
// Set DISCORD_WEBHOOK_URL in .env (or Vercel env vars).

import type { ScanSignal } from "../types";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";
const MIN_SCORE = 50; // only send grade A+ / A signals

// ── Family emojis ──────────────────────────────────────────
const FAMILY_EMOJIS: Record<string, string> = {
  trend: "📈",
  ict: "🎯",
  trader: "👁️",
  ea: "🤖",
  horc: "🌊",
  community: "👥",
  channel: "📊",
};

function getFamily(strategyKey: string, strategyType: string): string {
  const match = strategyKey.match(/^(trend|ict|trader|ea|horc|community|channel)-/);
  if (match) return match[1];
  return strategyType;
}

function fmtPrice(price: number | undefined, assetClass: string): string {
  if (price === undefined || price === null) return "—";
  if (assetClass === "crypto") return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (assetClass === "commodity") return price.toFixed(2);
  if (assetClass === "index") return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  // forex — JPY pairs have 3 decimals, others 5
  return price.toFixed(5);
}

// ── Build a single signal embed ─────────────────────────────
export function buildSignalEmbed(signal: ScanSignal) {
  const isLong = signal.direction === "long";
  const arrow = isLong ? "🟢" : "🔴";
  const dirText = isLong ? "LONG" : "SHORT";
  const color = isLong ? 0x22c55e : 0xef4444;

  const family = getFamily(signal.strategyKey, signal.strategyType);
  const familyEmoji = FAMILY_EMOJIS[family] ?? "📊";
  const familyName = family.charAt(0).toUpperCase() + family.slice(1);
  const scannerName = signal.strategyLabel ||
    signal.strategyKey.replace(/^(trend|ict|trader|ea|horc|community|channel)-/, "");

  // Risk / Reward
  const risk = signal.entryPrice !== undefined && signal.stopPrice !== undefined
    ? Math.abs(signal.entryPrice - signal.stopPrice) : 0;
  const reward = signal.entryPrice !== undefined && signal.targetPrice !== undefined
    ? Math.abs(signal.targetPrice - signal.entryPrice) : 0;
  const rr = risk > 0 ? `1:${(reward / risk).toFixed(1)}` : "—";

  const fields = [
    { name: "Strategy", value: scannerName, inline: true },
    { name: "Family", value: `${familyEmoji} ${familyName}`, inline: true },
    { name: "Grade", value: `**${signal.grade ?? "—"}**  (${signal.score}/100)`, inline: true },
    { name: "Entry", value: `\`${fmtPrice(signal.entryPrice, signal.assetClass)}\``, inline: true },
    { name: "Stop", value: `\`${fmtPrice(signal.stopPrice, signal.assetClass)}\``, inline: true },
    { name: "Target", value: `\`${fmtPrice(signal.targetPrice, signal.assetClass)}\``, inline: true },
    { name: "Risk : Reward", value: rr, inline: true },
  ];

  // Killzone badge
  if (signal.gradeFactors?.killzoneScore && signal.gradeFactors.killzoneScore > 15) {
    fields.push({ name: "Killzone", value: "🟢 Active", inline: true });
  }

  // Confluence count
  if (signal.gradeFactors?.confluenceScore !== undefined) {
    const conf = Math.round((signal.gradeFactors.confluenceScore / 25) * 100);
    fields.push({ name: "Confluence", value: `${conf}%`, inline: true });
  }

  const reasonsText = signal.reasons?.slice(0, 4).map(r => `▸ ${r}`).join("\n") ?? "";

  return {
    title: `${arrow}  ${dirText}  ${signal.display}  ·  ${signal.timeframe.toUpperCase()}`,
    description: reasonsText || undefined,
    fields,
    color,
    timestamp: signal.generatedAt ?? new Date().toISOString(),
    footer: { text: "Quant Scanner · live signal" },
  };
}

// ── Build a summary embed (sent after a scheduled sweep) ────
export interface SummaryMeta {
  instrumentsScanned?: number;
  instrumentsSkipped?: number;
  forwarded?: number;        // ForwardTestSignal rows written
  dispatched?: number;        // Discord alerts actually sent
  deduped?: number;           // Cross-sweep deduped (suppressed repeats)
  failedSymbols?: string[];    // Symbols that came back with no data
  staleSymbols?: string[];    // Symbols where live price was unavailable
  durationMs?: number;
}

export function buildSummaryEmbed(signals: ScanSignal[], isLive: boolean, meta?: SummaryMeta) {
  const count = signals.length;

  // Break down by family
  const byFamily: Record<string, number> = {};
  for (const s of signals) {
    const fam = getFamily(s.strategyKey, s.strategyType);
    byFamily[fam] = (byFamily[fam] || 0) + 1;
  }

  const familyLines = Object.entries(byFamily).map(([fam, n]) => {
    const emoji = FAMILY_EMOJIS[fam] ?? "📊";
    const name = fam.charAt(0).toUpperCase() + fam.slice(1);
    return `${emoji}  \`${name}\` — ${n} signal${n === 1 ? "" : "s"}`;
  }).join("\n") || "`—`";

  // Top signal
  const top = count > 0
    ? signals.reduce((a, b) => a.score > b.score ? a : b)
    : null;
  const topLine = top
    ? `${top.direction === "long" ? "🟢" : "🔴"} ${top.direction.toUpperCase()} ${top.display} · Score ${top.score} · Grade ${top.grade}`
    : "—";

  const lines: string[] = [
    `**Status:** ${isLive ? "🟢 LIVE" : "🟡 STALE"}`,
    `**Scope:** ${meta?.instrumentsScanned ?? 24} instruments · 4H + 1D timeframes`,
  ];
  if (meta?.durationMs != null) {
    lines.push(`**Duration:** ${(meta.durationMs / 1000).toFixed(1)}s`);
  }
  if (meta?.dispatched != null || meta?.deduped != null) {
    lines.push(`**Dispatched:** ${meta?.dispatched ?? 0} alerts (${meta?.deduped ?? 0} deduped this sweep)`);
  }
  if (meta?.forwarded != null) {
    lines.push(`**Forward-test rows:** ${meta.forwarded}`);
  }
  lines.push("", "**Signals by family:**", familyLines, "", "**Top signal:**", topLine);
  if (meta?.failedSymbols && meta.failedSymbols.length > 0) {
    lines.push("", `⚠️  **No data:** ${meta.failedSymbols.join(", ")}`);
  }
  if (meta?.staleSymbols && meta.staleSymbols.length > 0) {
    lines.push(`🟡  **Stale price:** ${meta.staleSymbols.join(", ")}`);
  }
  if (meta?.instrumentsSkipped && meta.instrumentsSkipped > 0) {
    lines.push(`⚠️  **Skipped:** ${meta.instrumentsSkipped} instruments errored`);
  }
  lines.push("", "Next scan in 4 hours");

  const description = lines.join("\n");

  return {
    title: count > 0
      ? `📡  ${count} Signal${count === 1 ? "" : "s"} Detected`
      : "📡  Scanner Sweep Complete",
    description,
    color: count > 0 ? 0x22c55e : 0xf59e0b,
    timestamp: new Date().toISOString(),
    footer: { text: "Quant Scanner · scheduled sweep" },
  };
}

// ── Send functions ──────────────────────────────────────────
export async function sendDiscordAlert(signal: ScanSignal): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  if (signal.score < MIN_SCORE) return false;

  const embed = buildSignalEmbed(signal);

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
    if (ok) {
      sent++;
      // Discord rate limit: ~30 messages / 60s. Add small delay between sends.
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return sent;
}

export async function sendDiscordSummary(
  signals: ScanSignal[],
  isLive: boolean,
  meta?: SummaryMeta,
): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  const embed = buildSummaryEmbed(signals, isLive, meta);
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
