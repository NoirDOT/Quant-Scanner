// GET /api/scanner/ping — runs a FULL scan + sends signals to Discord
// Triggered by GitHub Actions (every 6h) or manually from the Actions tab.
// This runs even when your browser is closed — you get Discord alerts 24/7.
//
// Query params:
//   ?test=1   Send sample signals + summary to Discord (preview the embed design)
//
// Security: if CRON_SECRET env var is set, callers must send it as a
// Bearer token in the Authorization header.

import { NextRequest, NextResponse } from "next/server";
import type { ScanSignal } from "@/lib/scanner/types";
import { sendDiscordAlerts, sendDiscordSummary, buildSignalEmbed } from "@/lib/scanner/alerts/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 150; // cron calls the scan (120s) + sends summary

// ── Sample signals for test mode ────────────────────────────
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

export async function GET(req: NextRequest) {
  // ── Auth check ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token !== cronSecret) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const url = new URL(req.url);
  const isTest = url.searchParams.get("test") === "1";

  // ── Test mode: send sample signals + summary to Discord ────
  if (isTest) {
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "DISCORD_WEBHOOK_URL not set" },
        { status: 500 }
      );
    }

    // Send a single signal first
    const singleEmbed = buildSignalEmbed(SAMPLE_SIGNALS[0]);
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "**▼ TEST — single signal preview ▼**",
        embeds: [singleEmbed],
      }),
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 1000));

    // Send the remaining 3 signals from different families
    for (const sig of SAMPLE_SIGNALS.slice(1)) {
      const embed = buildSignalEmbed(sig);
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 1000));

    // Send the summary embed
    await sendDiscordSummary(SAMPLE_SIGNALS, true);

    return NextResponse.json({
      ok: true,
      test: true,
      sent: SAMPLE_SIGNALS.length + 1, // 4 signals + 1 summary
      message: "Test embeds sent to Discord — check your channel",
    });
  }

  // ── Normal mode: run a full scan ───────────────────────────
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://quant-scanner-g7r7.vercel.app";

  try {
    const scanRes = await fetch(`${baseUrl}/api/scanner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        dispatch: true,  // ← sends signals to Discord automatically
      }),
    });
    const scanText = await scanRes.text();
    let scanData: any = {};
    try {
      scanData = JSON.parse(scanText);
    } catch {
      scanData = { parseError: true, bodyStart: scanText.slice(0, 200) };
    }
    const signalCount = scanData.count ?? 0;
    const isLive = scanData.meta?.live ?? false;

    if (scanData.parseError || !scanRes.ok) {
      console.error(`[ping] scan fetch bad response: status=${scanRes.status} body=${scanText.slice(0, 300)}`);
      return NextResponse.json({
        ok: false,
        alive: true,
        scanStatus: scanRes.status,
        scanBodyStart: scanText.slice(0, 300),
      }, { status: 502 });
    }
    const signals: ScanSignal[] = scanData.signals ?? [];

    // Send a status summary to Discord
    if (webhookUrl) {
      await sendDiscordSummary(signals, isLive);
    }

    return NextResponse.json({ ok: true, alive: true, live: isLive, signals: signalCount });
  } catch (e) {
    // Scanner down — send alert
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

    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
