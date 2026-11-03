// GET /api/scanner/ping — runs a FULL scan + sends signals to Discord.
// Triggered by GitHub Actions (every 4h aligned to bar closes) or manually.
//
// CRITICAL FIX: this used to POST to /api/scanner over HTTP (self-fetch),
// which broke under Vercel SSO. Now it calls runScan() directly — same
// process, no auth boundary, no SSO.
//
// Behavior:
//   - Persists every signal to ScanResult (so historical scans are queryable)
//   - Writes ForwardTestSignal rows (so a nightly replay can resolve outcomes)
//   - Dispatches Discord alerts (cross-sweep deduped via DispatchedSignal)
//   - Sends a summary embed
//
// Query params:
//   ?test=1   Send sample signals + summary to Discord (preview the embed design)
//
// Auth: requires CRON_SECRET (or API_SECRET) as a Bearer token.
// If neither is set, returns 500 with a config warning.

import { NextRequest, NextResponse } from "next/server";
import type { ScanSignal } from "@/lib/scanner/types";
import { sendDiscordSummary, buildSignalEmbed } from "@/lib/scanner/alerts/discord";
import { runScan } from "@/lib/scanner/runScan";

export const dynamic = "force-dynamic";
export const maxDuration = 150; // scan (120s) + dispatch + summary

// ── Sample signals for test mode ────────────────────────────────────────────
const SAMPLE_SIGNALS: ScanSignal[] = [
  {
    strategyKey: "trend-donchian-4h",
    strategyType: "trend",
    strategyLabel: "Donchian Breakout",
    symbol: "EURUSD=X",
    display: "EUR/USD",
    assetClass: "forex",
    timeframe: "4h",
    direction: "long",
    score: 78,
    grade: "A",
    gradeFactors: { rawScore: 78, confluenceScore: 20, killzoneScore: 22, rrScore: 18, catalogScore: 12, freshnessScore: 6 },
    reasons: [
      "Close broke above Donchian 20 upper band",
      "Higher highs forming on 4H structure",
      "London killzone active",
      "EMA stack aligned bullish",
    ],
    entryPrice: 1.08234,
    stopPrice: 1.07981,
    targetPrice: 1.08745,
    generatedAt: new Date().toISOString(),
  },
  {
    strategyKey: "ict-fvg-1d",
    strategyType: "ict",
    strategyLabel: "Fair Value Gap",
    symbol: "GBPUSD=X",
    display: "GBP/USD",
    assetClass: "forex",
    timeframe: "1d",
    direction: "short",
    score: 72,
    grade: "A",
    gradeFactors: { rawScore: 72, confluenceScore: 18, killzoneScore: 20, rrScore: 16, catalogScore: 10, freshnessScore: 8 },
    reasons: [
      "Bearish FVG unfilled on daily",
      "Liquidity sweep above prior high",
      "Market structure shift to bearish",
    ],
    entryPrice: 1.27154,
    stopPrice: 1.27520,
    targetPrice: 1.26410,
    generatedAt: new Date().toISOString(),
  },
  {
    strategyKey: "community-smc-bos-s3-4h",
    strategyType: "trader",
    strategyLabel: "SMC BOS s3",
    symbol: "USDJPY=X",
    display: "USD/JPY",
    assetClass: "forex",
    timeframe: "4h",
    direction: "long",
    score: 68,
    grade: "B+",
    gradeFactors: { rawScore: 68, confluenceScore: 16, killzoneScore: 18, rrScore: 14, catalogScore: 12, freshnessScore: 8 },
    reasons: [
      "Break of structure to upside",
      "Order block mitigation below",
      "Equal lows swept",
    ],
    entryPrice: 151.234,
    stopPrice: 150.890,
    targetPrice: 152.120,
    generatedAt: new Date().toISOString(),
  },
  {
    strategyKey: "ea-ema-cloud-1d",
    strategyType: "ea",
    strategyLabel: "EMA Cloud",
    symbol: "BTC-USD",
    display: "Bitcoin",
    assetClass: "crypto",
    timeframe: "1d",
    direction: "long",
    score: 65,
    grade: "B+",
    gradeFactors: { rawScore: 65, confluenceScore: 15, killzoneScore: 8, rrScore: 16, catalogScore: 14, freshnessScore: 12 },
    reasons: [
      "Price reclaimed 21/55 EMA cloud",
      "Daily MACD histogram flipped positive",
      "Volume rising 3 sessions",
    ],
    entryPrice: 67250,
    stopPrice: 64800,
    targetPrice: 72400,
    generatedAt: new Date().toISOString(),
  },
];

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.API_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return false; // require explicit secret in prod
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const queryKey = req.nextUrl.searchParams.get("key") ?? "";
  const provided = token || queryKey;
  return !!provided && secrets.includes(provided);
}

export async function GET(req: NextRequest) {
  // ── Auth check ──────────────────────────────────────────────────────────
  if (!checkAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized — set CRON_SECRET and send as Bearer token" },
      { status: 401 }
    );
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const url = new URL(req.url);
  const isTest = url.searchParams.get("test") === "1";

  // ── Test mode: send sample signals + summary to Discord ──────────────────
  if (isTest) {
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "DISCORD_WEBHOOK_URL not set" },
        { status: 500 }
      );
    }
    const singleEmbed = buildSignalEmbed(SAMPLE_SIGNALS[0]);
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "**▼ TEST — single signal preview ▼**", embeds: [singleEmbed] }),
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    for (const sig of SAMPLE_SIGNALS.slice(1)) {
      const embed = buildSignalEmbed(sig);
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1000));
    await sendDiscordSummary(SAMPLE_SIGNALS, true);
    return NextResponse.json({
      ok: true,
      test: true,
      sent: SAMPLE_SIGNALS.length + 1,
      message: "Test embeds sent to Discord — check your channel",
    });
  }

  // ── Normal mode: run a full scan IN-PROCESS (no self-fetch) ──────────────
  // Persists every signal, writes ForwardTestSignal rows, dispatches Discord
  // alerts (cross-sweep deduped). The 24-instrument universe matches what
  // the browser UI scans.
  try {
    const result = await runScan({
      strategyType: "all",
      instruments: [
        // Forex majors (7)
        "EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X", "USDCAD=X", "USDCHF=X", "NZDUSD=X",
        // Forex crosses (4)
        "EURJPY=X", "GBPJPY=X", "EURGBP=X", "AUDJPY=X",
        // Crypto (5)
        "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD",
        // Commodities (3)
        "GC=F", "SI=F", "CL=F",
        // Indices (5)
        "^GSPC", "^NDX", "^DJI", "US500=F", "USTEC=F",
      ],
      timeframes: ["4h", "1d"],
      minScore: 30,
      persist: true,         // ← store every signal so history is queryable
      dispatch: true,        // ← sends to Discord (cross-sweep deduped)
      trackForward: true,    // ← writes ForwardTestSignal rows
    });

    const signals = result.signals;
    const isLive = result.meta.live;

    // Surface silent Yahoo failures in the summary — operators can see which
    // symbols came back with no data or stale bars.
    const failedSymbols = result.meta.symbolDataStatus.filter((s) => s.source === "failed" || s.candles < 30);
    const staleSymbols = result.meta.symbolDataStatus.filter((s) => s.source === "stale");

    // Send a status summary to Discord
    if (webhookUrl) {
      await sendDiscordSummary(signals, isLive, {
        instrumentsScanned: result.meta.instrumentsScanned,
        instrumentsSkipped: result.meta.instrumentsSkipped,
        forwarded: result.meta.forwardSignalsWritten,
        dispatched: result.meta.dispatched,
        deduped: result.meta.deduped,
        setupCount: result.meta.setupCount,
        conflictedSetupCount: result.meta.conflictedSetupCount,
        failedSymbols: failedSymbols.map((s) => `${s.symbol}/${s.timeframe}`).slice(0, 8),
        staleSymbols: staleSymbols.map((s) => s.symbol).slice(0, 8),
        durationMs: result.meta.duration,
      });
    }

    return NextResponse.json({
      ok: true,
      alive: true,
      live: isLive,
      signals: result.count,
      setups: result.meta.setupCount,
      conflictedSetups: result.meta.conflictedSetupCount,
      dispatched: result.meta.dispatched,
      deduped: result.meta.deduped,
      forwarded: result.meta.forwardSignalsWritten,
      failedSymbols: failedSymbols.length,
      staleSymbols: staleSymbols.length,
      durationMs: result.meta.duration,
    });
  } catch (e) {
    // Scanner down — send alert to Discord
    if (webhookUrl) {
      const embed = {
        title: "⚠️  Scanner Down",
        description: [
          `Scheduled scan failed at ${new Date().toISOString()}`,
          `\`\`\`${e instanceof Error ? e.message : "unknown error"}\`\`\``,
        ].join("\n"),
        color: 0xef4444,
        timestamp: new Date().toISOString(),
        footer: { text: "Quant Scanner · scheduled sweep" },
      };
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      }).catch(() => {});
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
