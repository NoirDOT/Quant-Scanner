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

1. Import `NoirDOT/Quant-Scanner` on Vercel
2. Create Postgres database (Vercel → Storage)
3. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`
4. Set env vars: `DATABASE_URL`, `DISCORD_WEBHOOK_URL`
5. Deploy — Vercel Cron auto-runs every 6h

## Discord alerts

- **Signal alerts** — when a signal scores ≥70 (grade A+ / A), Discord gets a message automatically
- **6h status ping** — Vercel Cron calls `/api/scanner/ping` every 6 hours. If the scanner is alive, you get:

```
📡 Scanner Status
Scanner is LIVE · 3 signals found
```

If it's down, you get:

```
⚠️ Scanner Down
Scanner health check failed
```

## Scanned instruments
EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD, Bitcoin, Ethereum, Gold, S&P 500, Nasdaq 100

## Features
- 48 scanners: Trend(6) + ICT(8) + Trader(10) + EA(12) + HORC(5) + Community(5) + Channel(3)
- 4-layer architecture: Detector → Filter → Strategy → Scanner
- Universal A+/A/B+/B-/C grading
- Live Yahoo Finance price overlay
- Auto-scan (5m/15m/60m cadence)
- Dark mode
- Discord webhook alerts + 6h status ping
