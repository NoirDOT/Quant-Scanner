# Quant Scanner

A multi-strategy market scanner with 48 strategies across 6 families.

## Run locally

```bash
bun install
bunx prisma generate
bunx prisma db push --accept-data-loss
bun run dev
```

Open http://localhost:4000

## Deploy on Vercel

1. Go to https://vercel.com → New Project → Import `NoirDOT/Quant-Scanner`
2. Create a Postgres database (Vercel → Storage → Create → Postgres)
3. Set `DATABASE_URL` env var to the Postgres connection string
4. Deploy

## Discord alerts

Get signal alerts in Discord — one channel, no bot needed:

1. In your Discord server, create a channel (e.g., `#scanner-signals`)
2. Channel Settings → Integrations → Webhooks → Create Webhook → copy URL
3. Set env var:
   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
4. Restart the scanner

When a signal scores ≥70 (grade A or A+), you get a Discord message like:

```
🔴 SHORT EUR/USD · 4h
SMC BOS s3 · Score 78 · Grade A
Entry: 1.0823
Stop: 1.0850
Target: 1.0770
Close broke below Donchian lower, lower tracker falling
```

That's it. You see it, you check the chart, you decide.

## Features

- 48 scanners: Trend(6) + ICT(8) + Trader(10) + EA(12) + HORC(5) + Community(5) + Channel(3)
- 4-layer architecture: Detector → Filter → Strategy → Scanner
- Universal A+/A/B+/B-/C grading
- Live Yahoo Finance price overlay
- Auto-scan with timeframe-aware cadence
- Backtest engine (walk-forward, cost-adjusted)
- Prop Firm Sim with Monte Carlo combination optimizer
- 14 handbook-validated scanners (MT5 candidates)
- Discord webhook alerts (grade A+ / A only)
