// /api/webhook/incoming/[secret]/route.ts
// TradingView webhook receiver — secret lives in the URL path because TV
// can't send custom Authorization headers.
//
// URL pattern: POST /api/webhook/incoming/:secret
// The middleware checks the secret against WEBHOOK_SECRET before this
// handler runs, so by the time we're here the request is authentic.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const TVAlert = z.object({
  ticker: z.string().max(40).optional(),
  interval: z.string().max(10).optional(),
  strategy: z.string().max(80).optional(),
  direction: z.enum(["long", "short"]).optional(),
  price: z.number().positive().optional(),
  message: z.string().max(2000).optional(),
}).strict();

export async function POST(req: NextRequest) {
  // Try JSON first
  let body: unknown = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = await req.json().catch(() => null);
  } else {
    // TradingView sometimes sends form-encoded {{ticker}} etc.
    const text = await req.text();
    try {
      body = JSON.parse(text);
    } catch {
      // Treat as plain message
      return NextResponse.json({
        ok: true,
        note: "Received text webhook (no JSON body)",
        preview: text.slice(0, 200),
      });
    }
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Empty or invalid body" }, { status: 400 });
  }

  const parsed = TVAlert.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid alert payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const alert = parsed.data;

  // Determine target Discord channel based on strategy/ticker
  const strategy = (alert.strategy ?? "").toLowerCase();
  let discordChannel = "all-signals";
  if (strategy.includes("cisd") || strategy.includes("order-block")) discordChannel = "cisd-signals";
  else if (strategy.includes("silver") || strategy.includes("bullet") || strategy.includes("london")) discordChannel = "silver-bullet";
  else if (strategy.startsWith("trader-")) discordChannel = "trader-strategies";
  else if (strategy.startsWith("ea-")) discordChannel = "ea-signals";
  else if (strategy.startsWith("trend-")) discordChannel = "trend-signals";
  else if (strategy.includes("horc")) discordChannel = "all-signals";

  const envVar = `DISCORD_${discordChannel.toUpperCase().replace(/-/g, "_")}_WEBHOOK_URL`;
  const webhookUrl = process.env[envVar] ?? process.env.DISCORD_ALL_SIGNALS_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    return NextResponse.json({
      ok: false,
      error: `No Discord webhook URL configured for #${discordChannel}`,
      hint: `Set env var ${envVar} (or DISCORD_WEBHOOK_URL as fallback)`,
    }, { status: 400 });
  }

  try {
    const embed = {
      title: `📺 TradingView Alert → #${discordChannel}`,
      description: alert.message ?? `Strategy: ${alert.strategy ?? "?"} on ${alert.ticker ?? "?"} (${alert.interval ?? "?"})`,
      color: alert.direction === "long" ? 0x00ff00 : alert.direction === "short" ? 0xff0000 : 0x888888,
      fields: [
        { name: "Ticker", value: alert.ticker ?? "—", inline: true },
        { name: "Interval", value: alert.interval ?? "—", inline: true },
        { name: "Direction", value: alert.direction ?? "—", inline: true },
        { name: "Strategy", value: alert.strategy ?? "—", inline: true },
        { name: "Price", value: alert.price?.toString() ?? "—", inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return NextResponse.json({
        ok: false,
        error: `Discord webhook failed: HTTP ${resp.status}`,
        body: await resp.text(),
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true, forwardedTo: discordChannel, alert });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/incoming/:secret",
    description: "TradingView webhook receiver — re-broadcasts alerts to Discord channels",
    auth: "Secret must be in the URL path. Set WEBHOOK_SECRET env var, then configure your TradingView alert webhook URL as: https://<your-app>/api/webhook/incoming/<YOUR_SECRET>",
    usage: `Configure your TradingView alert webhook URL to point here. The alert payload should include: ticker, interval, strategy, direction, price, message. We route to Discord channels based on strategy name.`,
    discordChannelRouting: {
      "cisd-signals": "Strategy IDs containing cisd/order-block/fvg/liquidity/premium",
      "silver-bullet": "Strategy IDs containing silver/bullet/london-killzone/ny-killzone/asia",
      "trader-strategies": "Strategy IDs starting with trader-",
      "ea-signals": "Strategy IDs starting with ea-",
      "trend-signals": "Strategy IDs starting with trend-",
      "all-signals": "Fallback for unmatched strategies + HORC",
    },
    envVars: [
      "WEBHOOK_SECRET (required — the secret in the URL path)",
      "DISCORD_CISD_WEBHOOK_URL",
      "DISCORD_SILVER_BULLET_WEBHOOK_URL",
      "DISCORD_TRADER_STRATEGIES_WEBHOOK_URL",
      "DISCORD_EA_SIGNALS_WEBHOOK_URL",
      "DISCORD_TREND_SIGNALS_WEBHOOK_URL",
      "DISCORD_ALL_SIGNALS_WEBHOOK_URL (or DISCORD_WEBHOOK_URL as fallback)",
    ],
  });
}
