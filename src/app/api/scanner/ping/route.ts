// GET /api/scanner/ping — runs a FULL scan + sends signals to Discord
// Called by Vercel Cron (daily on Hobby plan) or cron-job.org (every 6h)
// This runs even when your browser is closed — you get Discord alerts 24/7

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  try {
    // Run a full scan — same instruments + timeframes as the browser
    const scanRes = await fetch("https://quant-scanner-g7r7.vercel.app/api/scanner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyType: "all",
        instruments: [
          "EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X", "USDCAD=X", "USDCHF=X", "NZDUSD=X",
          "BTC-USD", "ETH-USD", "GC=F", "^GSPC", "^NDX"
        ],
        timeframes: ["4h", "1d"],
        minScore: 30,
        dispatch: true,  // ← sends signals to Discord automatically
      }),
    });
    const scanData = await scanRes.json();
    const signalCount = scanData.count ?? 0;
    const isLive = scanData.meta?.live ?? false;

    // Send a status summary to Discord
    if (webhookUrl) {
      const embed = {
        title: signalCount > 0 ? `📡 ${signalCount} Signal${signalCount === 1 ? "" : "s"} Found` : "📡 Scanner Status",
        description: [
          `Scanner is **${isLive ? "LIVE" : "STALE"}**`,
          `${signalCount} signal${signalCount === 1 ? "" : "s"} detected across 12 pairs`,
          signalCount > 0 ? "Signal alerts sent above ↑" : "No setups right now — market is quiet.",
          `\nNext scan: in 6 hours`,
        ].join("\n"),
        color: signalCount > 0 ? 0x22c55e : 0xf59e0b,
        timestamp: new Date().toISOString(),
        footer: { text: "Quant Scanner · scheduled scan" },
      };

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, alive: true, live: isLive, signals: signalCount });
  } catch (e) {
    // Scanner down — send alert
    if (webhookUrl) {
      const embed = {
        title: "⚠️ Scanner Down",
        description: `Scheduled scan failed at ${new Date().toISOString()}\nError: ${e instanceof Error ? e.message : "unknown"}`,
        color: 0xef4444,
        timestamp: new Date().toISOString(),
        footer: { text: "Quant Scanner · scheduled scan" },
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
