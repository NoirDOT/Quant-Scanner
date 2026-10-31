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
2. Create a free Postgres database: Vercel → Storage → Create → Postgres
3. Set environment variable: `DATABASE_URL` = your Postgres connection string
4. Deploy → you get a public URL

## Features

- 48 scanners: Trend(6) + ICT(8) + Trader(10) + EA(12) + HORC(5) + Community(5) + Channel(3)
- 4-layer architecture: Detector → Filter → Strategy → Scanner
- Universal A+/A/B+/B-/C grading
- Live Yahoo Finance price overlay
- Auto-scan with timeframe-aware cadence
- Backtest engine (walk-forward, cost-adjusted)
- Prop Firm Sim with Monte Carlo combination optimizer
- 14 handbook-validated scanners (MT5 candidates)

## Latest update
Fixed Tailwind v4 PostCSS config + turbopackIgnore for CSV file access.
