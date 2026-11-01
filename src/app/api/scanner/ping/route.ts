// GET /api/scanner/ping — sends a status ping to Discord every 6 hours
// Called by Vercel Cron (configured in vercel.json)

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ ok: true, message: "No DISCORD_WEBHOOK_URL — ping skipped" });
  }

  try {
    // Quick scan to check if the scanner is alive
    const scanRes = await fetch("https://" + process.env.VERCEL_URL + "/api/scanner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyType: "all",
        instruments: ["EURUSD=X", "BTC-USD", "GC=F"],
        timeframes: ["4h", "1d"],
        minScore: 30,
      }),
    });
    const scanData = await scanRes.json();
    const signalCount = scanData.count ?? 0;
    const isLive = scanData.meta?.live ?? false;

    const embed = {
      title: "📡 Scanner Status",
      description: `Scanner is **${isLive ? "LIVE" : "STALE"}** · ${signalCount} signals found\nLast check: ${new Date().toISOString()}`,
      color: isLive ? 0x22c55e : 0xf59e0b,
      timestamp: new Date().toISOString(),
      footer: { text: "Quant Scanner · 6h ping" },
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, alive: true, live: isLive, signals: signalCount });
  } catch (e) {
    const embed = {
      title: "⚠️ Scanner Down",
      description: `Scanner health check failed at ${new Date().toISOString()}\nError: ${e instanceof Error ? e.message : "unknown"}`,
      color: 0xef4444,
      timestamp: new Date().toISOString(),
      footer: { text: "Quant Scanner · 6h ping" },
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    }).catch(() => {});

    return NextResponse.json({ ok: false, alive: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
