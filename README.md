# Quant Scanner

A multi-strategy market scanner with 48 strategies across 7 families.

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
4. Set env vars: `DATABASE_URL`, `DISCORD_WEBHOOK_URL`, `CRON_SECRET`
5. Deploy

## Discord alerts — how it works

### Real-time (browser open)
When you have the scanner page open, it auto-scans on a timeframe-aware cadence (5m/15m/60m). Any signal scoring ≥50 sends a Discord alert immediately.

### Scheduled scans (browser closed) — GitHub Actions

**This is the recommended approach.** GitHub Actions runs the scanner every 6 hours, even when your browser is closed. No Vercel Cron needed (Hobby plan is limited to 1/day anyway).

#### Setup (one-time, 2 minutes)

1. **Generate a secret token** (any random string):
   ```bash
   openssl rand -hex 32
   # e.g. a3f8c1d2e5b4... (copy this)
   ```

2. **Add it to Vercel:**
   - Vercel → your project → Settings → Environment Variables
   - Name: `CRON_SECRET`
   - Value: the string from step 1
   - Redeploy (push any commit, or click Redeploy)

3. **Add it to GitHub:**
   - GitHub → `NoirDOT/Quant-Scanner` → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `CRON_SECRET`
   - Value: the same string from step 1

4. **Done.** The workflow at `.github/workflows/scan.yml` runs every 6 hours automatically:
   - 00:00 UTC, 06:00 UTC, 12:00 UTC, 18:00 UTC

#### Manual trigger

Want to run a scan right now?

1. GitHub → `NoirDOT/Quant-Scanner` → **Actions** tab
2. Select **"Scanner Sweep"** in the left sidebar
3. Click **"Run workflow"** → green button
4. Watch the run — you'll get Discord alerts within ~30 seconds

#### How much does it cost?

GitHub Actions free tier: **2,000 minutes/month** for private repos.
- One scan takes ~30 seconds
- 4 scans/day × 30 days = 120 scans/month = **~60 minutes/month**
- You're using 3% of your free quota. No cost.

### What you see in Discord

**Signal alert (score ≥50):**
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
- Scheduled scans via GitHub Actions (every 6h, free)
