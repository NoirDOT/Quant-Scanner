# Quant Scanner

A multi-strategy market scanner with 48 strategies across 6 families.

## Run locally

```bash
bun install
bunx prisma generate
bunx prisma db push --accept-data-loss
bun run dev
```

Open http://localhost:4000 — uses SQLite locally, no Postgres needed.

## Deploy on Vercel

1. Go to https://vercel.com → New Project → Import `NoirDOT/Quant-Scanner`
2. Create a Postgres database: Vercel → Storage → Create → Postgres
3. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`
4. Set env var `DATABASE_URL` to your Postgres connection string
5. Deploy

## Discord alerts

Get signal alerts in one Discord channel — no bot needed:

1. In Discord, create a channel (e.g., `#scanner-signals`)
2. Channel Settings → Integrations → Webhooks → Create Webhook → copy URL
3. Set env var:
   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
4. Restart

When a signal scores ≥70 (grade A or A+), you get:

```
🔴 SHORT EUR/USD · 4h
SMC BOS s3 · Score 78 · Grade A
Entry: 1.0823 · Stop: 1.0850 · Target: 1.0770
Close broke below Donchian lower, lower tracker falling
```

## Features

- 48 scanners: Trend(6) + ICT(8) + Trader(10) + EA(12) + HORC(5) + Community(5) + Channel(3)
- 4-layer architecture: Detector → Filter → Strategy → Scanner
- Universal A+/A/B+/B-/C grading
- Live Yahoo Finance price overlay
- Auto-scan (60s)
- Backtest engine (walk-forward, cost-adjusted)
- Prop Firm Sim with Monte Carlo combination optimizer
- 14 handbook-validated scanners (MT5 candidates)
- Discord webhook alerts (grade A+ / A only)
- Dark mode

## Scanners

### 14 Handbook-Validated (MT5 candidates)
| Scanner | Family | Score |
|---------|--------|-------|
| trend-donchian | Trend | 6/6 |
| trend-ema | Trend | 5/6 |
| ict-fvg | ICT | 5/6 |
| community-smc-bos-choch-s3 | Community | 5/6 |
| channel-dual-donchian | Channel | 5/6 |

### Best Prop Firm Combination
`channel-dual-donchian + community-smc-bos-choch-s3 → 70.4% pass rate`
