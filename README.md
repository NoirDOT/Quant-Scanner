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
5. Deploy

## Discord alerts — how it works

### Real-time (browser open)
When you have the scanner page open, it auto-scans every 15 minutes. Any signal scoring ≥50 sends a Discord alert immediately.

### Scheduled scans (browser closed)
Vercel Cron runs `/api/scanner/ping` daily at 9am UTC. This runs a full scan across 12 instruments and sends:
- Individual signal alerts (if any found)
- A summary message: "📡 3 Signals Found — Scanner is LIVE"

### Every 6 hours (recommended — free)
Vercel Hobby only allows 1 cron per day. To get scans every 6 hours, use [cron-job.org](https://cron-job.org) (free):

1. Create a free account at cron-job.org
2. Create a job:
   - URL: `https://quant-scanner-g7r7.vercel.app/api/scanner/ping`
   - Method: GET
   - Schedule: every 6 hours
3. Done — you get 4 scans per day that each fire Discord alerts

### What you see in Discord

**Signal alert:**
```
🔴 SHORT EUR/USD · 4h
SMC BOS s3 · Score 78 · Grade A
Entry: 1.0823 · Stop: 1.0850 · Target: 1.0770
Close broke below Donchian lower, lower tracker falling
```

**Summary (after each scheduled scan):**
```
📡 3 Signals Found
Scanner is LIVE
3 signals detected across 12 pairs
Signal alerts sent above ↑
Next scan: in 6 hours
```

**If scanner is down:**
```
⚠️ Scanner Down
Scheduled scan failed
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
- Discord webhook alerts (score ≥50)
- Scheduled scans via Vercel Cron + cron-job.org
