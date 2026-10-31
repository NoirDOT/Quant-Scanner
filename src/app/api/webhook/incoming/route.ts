// /home/z/my-project/build/hubb-final/HUBB/src/app/api/webhook/incoming/route.ts
// TradingView webhook receiver.
//
// Per Untitled.txt: "Build /api/webhook/incoming endpoint that re-broadcasts
// external scanner payloads to Discord (TV watchlist webhook pattern)"
//
// Accepts POST from TradingView alert webhooks. Re-broadcasts to Discord
// channels based on strategy mapping.

import { NextRequest, NextResponse } from "next/server";

interface TVAlert {
  ticker?: string;
  interval?: string;
  strategy?: string;
  direction?: "long" | "short";
  price?: number;
  message?: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as TVAlert | null;
  if (!body) {
    // Try form-encoded
    const text = await req.text();
    return NextResponse.json({
      ok: true,
      note: "Received text webhook",
      preview: text.slice(0, 200),
    });
  }

  // Determine target Discord channel based on strategy/ticker
  const strategy = (body.strategy ?? "").toLowerCase();
  let discordChannel = "all-signals";
  if (strategy.includes("cisd") || strategy.includes("order-block")) discordChannel = "cisd-signals";
  else if (strategy.includes("silver") || strategy.includes("bullet") || strategy.includes("london")) discordChannel = "silver-bullet";
  else if (strategy.startsWith("trader-")) discordChannel = "trader-strategies";
  else if (strategy.startsWith("ea-")) discordChannel = "ea-signals";
  else if (strategy.startsWith("trend-")) discordChannel = "trend-signals";
  else if (strategy.includes("horc")) discordChannel = "all-signals";

  // Get the Discord webhook URL from env
  const envVar = `DISCORD_${discordChannel.toUpperCase().replace(/-/g, "_")}_WEBHOOK_URL`;
  const webhookUrl = process.env[envVar] ?? process.env.DISCORD_ALL_SIGNALS_WEBHOOK_URL;

  if (!webhookUrl) {
    return NextResponse.json({
      ok: false,
      error: `No Discord webhook URL configured for #${discordChannel}`,
      hint: `Set env var ${envVar}`,
    }, { status: 400 });
  }

  // Forward to Discord
  try {
    const embed = {
      title: `📺 TradingView Alert → #${discordChannel}`,
      description: body.message ?? `Strategy: ${body.strategy ?? "?"} on ${body.ticker ?? "?"} (${body.interval ?? "?"})`,
      color: body.direction === "long" ? 0x00ff00 : body.direction === "short" ? 0xff0000 : 0x888888,
      fields: [
        { name: "Ticker", value: body.ticker ?? "—", inline: true },
        { name: "Interval", value: body.interval ?? "—", inline: true },
        { name: "Direction", value: body.direction ?? "—", inline: true },
        { name: "Strategy", value: body.strategy ?? "—", inline: true },
        { name: "Price", value: body.price?.toString() ?? "—", inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!resp.ok) {
      return NextResponse.json({
        ok: false,
        error: `Discord webhook failed: HTTP ${resp.status}`,
        body: await resp.text(),
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      forwardedTo: discordChannel,
      alert: body,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/incoming",
    description: "TradingView webhook receiver — re-broadcasts alerts to Discord channels",
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
      "DISCORD_CISD_WEBHOOK_URL",
      "DISCORD_SILVER_BULLET_WEBHOOK_URL",
      "DISCORD_TRADER_STRATEGIES_WEBHOOK_URL",
      "DISCORD_EA_SIGNALS_WEBHOOK_URL",
      "DISCORD_TREND_SIGNALS_WEBHOOK_URL",
      "DISCORD_ALL_SIGNALS_WEBHOOK_URL",
    ],
  });
}
