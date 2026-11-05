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

// ── TradingView deep link ───────────────────────────────────────────────────
// Converts a Yahoo Finance symbol to a TradingView symbol + interval so the
// user can click straight from the Discord alert into a chart with the
// entry/stop/target visible.
function tradingViewSymbol(yahooSymbol: string, assetClass: string): string {
  // Forex: EURUSD=X → FX:EURUSD
  if (assetClass === "forex") {
    const pair = yahooSymbol.replace("=X", "");
    // JPY pairs → FX_IDC, others → FX
    return pair.endsWith("JPY") ? `FX_IDC:${pair}` : `FX:${pair}`;
  }
  // Crypto: BTC-USD → BINANCE:BTCUSDT  (or COINBASE:BTCUSD as fallback)
  if (assetClass === "crypto") {
    const base = yahooSymbol.replace(/-USD$/, "").replace(/-USDT$/, "");
    return `BINANCE:${base}USDT`;
  }
  // Commodities: GC=F → TVC:GOLD, CL=F → TVC:USOIL, SI=F → TVC:SILVER
  if (assetClass === "commodity") {
    const map: Record<string, string> = {
      "GC=F": "TVC:GOLD",
      "SI=F": "TVC:SILVER",
      "CL=F": "TVC:USOIL",
      "BZ=F": "TVC:UKOIL",
      "NG=F": "TVC:NATGAS",
      "HG=F": "TVC:COPPER",
      "PL=F": "TVC:PLATINUM",
      "XAUUSD=X": "TVC:GOLD",
    };
    return map[yahooSymbol] ?? `TVC:${yahooSymbol.replace("=F", "")}`;
  }
  // Indices: ^GSPC → SP:SPX, ^NDX → NASDAQ:NDX, ^DJI → DJI:DJI
  if (assetClass === "index") {
    const map: Record<string, string> = {
      "^GSPC": "SP:SPX",
      "^NDX": "NASDAQ:NDX",
      "^DJI": "DJI:DJI",
      "^RUT": "I:RUT",
    };
    return map[yahooSymbol] ?? yahooSymbol;
  }
  return yahooSymbol;
}

function tradingViewInterval(timeframe: string): string {
  switch (timeframe) {
    case "1h": return "60";
    case "2h": return "120";
    case "4h": return "240";
    case "1d": return "D";
    case "1w": return "W";
    default: return "240";
  }
}

function tradingViewUrl(signal: ScanSignal): string {
  const tvSym = tradingViewSymbol(signal.symbol, signal.assetClass);
  const tvInt = tradingViewInterval(signal.timeframe);
  // Build a URL that opens TradingView with the symbol + interval pre-filled
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}&interval=${tvInt}`;
}

// ── Build a single signal embed ─────────────────────────────────────────────
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

  // TradingView deep link — click straight into a chart with this symbol + interval
  const tvUrl = tradingViewUrl(signal);
  fields.push({
    name: "Chart",
    value: `[📊 Open in TradingView](${tvUrl})`,
    inline: false,
  });

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

// ── Build a SETUP embed (consolidated — one per pair + direction) ────────────
// This is what Discord should send instead of individual signal embeds.
// Includes: regime, families agreeing, R:R, risk sizing, TV deep link.

import type { Setup } from "../consolidate";
import { computePositionSize, DEFAULT_RISK_CONFIG, type RiskConfig } from "../risk";

export function buildSetupEmbed(
  setup: Setup,
  riskConfig?: RiskConfig,
  fxRates?: Record<string, number> | null,
) {
  const isLong = setup.direction === "long";
  const arrow = isLong ? "🟢" : "🔴";
  const dirText = isLong ? "LONG" : "SHORT";
  const color = isLong ? 0x22c55e : 0xef4444;
  const { best } = setup;

  // Family agreement badges
  const familyBadges = setup.families
    .map((f) => {
      const emoji = FAMILY_EMOJIS[f] ?? "📊";
      const name = f.charAt(0).toUpperCase() + f.slice(1);
      return `${emoji} ${name}`;
    })
    .join("  ·  ");

  // Regime badge
  const regimeEmoji =
    setup.regime === "bull" ? "📈" :
    setup.regime === "bear" ? "📉" :
    setup.regime === "sideways" ? "➡️" : "❓";
  const regimeText = setup.regime
    ? `${regimeEmoji} ${setup.regime.toUpperCase()}${setup.regimeLabel ? ` · ${setup.regimeLabel}` : ""}`
    : "—";

  // Risk sizing — use live FX rates for correct conversion on non-USD pairs
  const cfg = riskConfig ?? {
    accountBalance: parseFloat(process.env.ACCOUNT_BALANCE ?? "10000"),
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE ?? "0.01"),
  };
  const posSize = computePositionSize(best, cfg, { fxRates: fxRates ?? undefined });

  const fields = [
    { name: "Families Agreeing", value: familyBadges, inline: false },
    { name: "Regime", value: regimeText, inline: true },
    { name: "Setup Score", value: `**${Math.round(setup.score)}**/100`, inline: true },
    { name: "Grade", value: `**${best.grade ?? "—"}**`, inline: true },
    { name: "Entry", value: `\`${fmtPrice(best.entryPrice, setup.assetClass)}\``, inline: true },
    { name: "Stop", value: `\`${fmtPrice(best.stopPrice, setup.assetClass)}\``, inline: true },
    { name: "Target", value: `\`${fmtPrice(best.targetPrice, setup.assetClass)}\``, inline: true },
    { name: "Risk : Reward", value: `1:${setup.rr.toFixed(1)}`, inline: true },
  ];

  // Risk sizing
  if (posSize) {
    fields.push({
      name: "Position Size",
      value: `${posSize.label}  (risk $${posSize.riskAmount.toFixed(0)} · ${posSize.stopPips.toFixed(0)} pip stop)`,
      inline: false,
    });
  }

  // Timeframes + strategy count
  fields.push({
    name: "Confluence",
    value: `${setup.strategyCount} signal${setup.strategyCount === 1 ? "" : "s"} across ${setup.timeframes.join(" + ").toUpperCase()}`,
    inline: false,
  });

  // TradingView deep link
  const tvUrl = tradingViewUrl(best);
  fields.push({
    name: "Chart",
    value: `[📊 Open in TradingView](${tvUrl})`,
    inline: false,
  });

  // Best signal's reasons (top 3)
  const reasonsText = best.reasons?.slice(0, 3).map(r => `▸ ${r}`).join("\n") ?? "";

  return {
    title: `${arrow}  ${dirText}  ${setup.display}  ·  ${setup.timeframes.join("/").toUpperCase()}`,
    description: reasonsText || `**${familyBadges}**`,
    fields,
    color,
    timestamp: best.generatedAt ?? new Date().toISOString(),
    footer: { text: `Quant Scanner · setup · best: ${best.strategyLabel}` },
  };
}

// ── Build a setup DIGEST embed (top N setups in one embed) ──────────────────
// Sent as the summary after a sweep — replaces the old signal-count summary
// with an actionable list of the top setups.
export function buildSetupDigestEmbed(
  setups: Setup[],
  isLive: boolean,
  meta?: SummaryMeta,
) {
  const count = setups.length;

  // Build a compact table of the top 10 setups
  const lines: string[] = [];
  lines.push(`**Status:** ${isLive ? "🟢 LIVE" : "🟡 STALE"}`);
  if (meta?.instrumentsScanned != null) {
    lines.push(`**Scope:** ${meta.instrumentsScanned} instruments · 4H + 1D`);
  }
  if (meta?.durationMs != null) {
    lines.push(`**Duration:** ${(meta.durationMs / 1000).toFixed(1)}s`);
  }
  if (meta?.dispatched != null || meta?.deduped != null) {
    lines.push(`**Dispatched:** ${meta?.dispatched ?? 0} setup alerts (${meta?.deduped ?? 0} deduped)`);
  }
  if (meta?.forwarded != null) {
    lines.push(`**Forward-test rows:** ${meta.forwarded}`);
  }

  lines.push("", `**Tradeable setups (${count}):**`);

  if (count === 0) {
    lines.push("```No setups met the criteria (≥2 families, R:R ≥ 1.5, regime-aligned)```");
  } else {
    // Compact table: arrow pair dir score rr families
    lines.push("```");
    lines.push("  DIR  PAIR           SCORE  R:R   FAMILIES");
    lines.push("  ───  ─────────────  ─────  ───  ──────────────");
    for (const s of setups.slice(0, 10)) {
      const arrow = s.direction === "long" ? "🟢" : "🔴";
      const dir = s.direction === "long" ? "LONG " : "SHORT";
      const pair = s.display.padEnd(14).slice(0, 14);
      const score = String(Math.round(s.score)).padStart(3).slice(0, 3);
      const rr = `1:${s.rr.toFixed(1)}`.padStart(5).slice(0, 5);
      const fams = s.families.map((f) => f.charAt(0).toUpperCase() + f.slice(1, 3)).join(",").slice(0, 14);
      lines.push(`  ${arrow}  ${dir} ${pair}  ${score}  ${rr}  ${fams}`);
    }
    lines.push("```");
  }

  // Conflicted count
  if (meta?.conflictedSetupCount && meta.conflictedSetupCount > 0) {
    lines.push(`⚠️  **${meta.conflictedSetupCount} conflicted setup${meta.conflictedSetupCount === 1 ? "" : "s"}** (both directions firing — ignored)`);
  }

  // News blackout — active events suppress affected setups
  if (meta?.newsActiveLabel) {
    lines.push("", `🔴 **NEWS BLACKOUT:** ${meta.newsActiveLabel}`);
    lines.push("Affected currency setups have been suppressed.");
  }
  if (meta?.newsUpcomingLabel) {
    lines.push(`📅 **Upcoming:** ${meta.newsUpcomingLabel}`);
  }

  // Failed/stale symbols
  if (meta?.failedSymbols && meta.failedSymbols.length > 0) {
    lines.push("", `⚠️  **No data:** ${meta.failedSymbols.join(", ")}`);
  }
  if (meta?.staleSymbols && meta.staleSymbols.length > 0) {
    lines.push(`🟡  **Stale price:** ${meta.staleSymbols.join(", ")}`);
  }

  lines.push("", "Next scan in 4 hours");

  const description = lines.join("\n");

  return {
    title: count > 0
      ? `📡  ${count} Tradeable Setup${count === 1 ? "" : "s"}`
      : "📡  Scanner Sweep Complete",
    description,
    color: count > 0 ? 0x22c55e : 0xf59e0b,
    timestamp: new Date().toISOString(),
    footer: { text: "Quant Scanner · scheduled sweep" },
  };
}

// ── Build a summary embed (sent after a scheduled sweep) ────
export interface SummaryMeta {
  instrumentsScanned?: number;
  instrumentsSkipped?: number;
  forwarded?: number;        // ForwardTestSignal rows written
  dispatched?: number;        // Discord alerts actually sent
  deduped?: number;           // Cross-sweep deduped (suppressed repeats)
  setupCount?: number;        // Consolidated tradeable setups (pair + direction)
  conflictedSetupCount?: number;
  newsActiveLabel?: string | null;    // Active news blackout events
  newsUpcomingLabel?: string | null;  // Events in the next 24h
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
  if (meta?.setupCount != null) {
    const setupLine = `**Tradeable setups:** ${meta.setupCount}`;
    const conflictLine = meta.conflictedSetupCount && meta.conflictedSetupCount > 0
      ? ` (⚠️ ${meta.conflictedSetupCount} conflicted — ignored)`
      : "";
    lines.push(setupLine + conflictLine);
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

// ── Setup send functions (consolidated — one embed per setup) ────────────────

export async function sendDiscordSetupAlert(
  setup: Setup,
  fxRates?: Record<string, number> | null,
): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  const embed = buildSetupEmbed(setup, undefined, fxRates);
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

export async function sendDiscordSetupDigest(
  setups: Setup[],
  isLive: boolean,
  meta?: SummaryMeta,
): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  const embed = buildSetupDigestEmbed(setups, isLive, meta);
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
