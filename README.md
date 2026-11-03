# Quant Scanner

A multi-strategy market scanner that watches **117 instruments** (forex, crypto, commodities, indices, US large caps) across **5 timeframes** with **46 scanners in 6 strategy families**, grades every signal A+ → C, and pushes the best ones to **Discord / Telegram / Email** — live in the browser and on a 6-hour schedule via GitHub Actions.

**Live app:** https://quant-scanner-g7r7.vercel.app

---

## Highlights

- **46 scanners across 6 families** — Trend, ICT (SMC), Trader models, EA-derived, HORC, Community
- **4-layer architecture** — Detectors → Filters → Strategies → Scanner
- **Universal grading** — every signal scored 0–100 on 5 factors → `A+ / A / B+ / B- / C`
- **Real entries, not just arrows** — entry / stop / target with computed R:R on every signal
- **Killzone-aware** — London / New York / Silver Bullet alignment feeds the grade
- **Alerts that don't spam** — per-sweep dedupe (best signal per pair+TF+direction) capped at the top 12
- **Runs 24/7** — browser auto-scan while you watch, GitHub Actions sweeps every 6h while you don't
- **Backtest engine** — per-strategy, per-grade win rate / profit factor / drawdown, feeding back into grading
- **UI built for drilling down** — strategy cards (signal counts, family badges) → click → every pair under that strategy

---

## How a scan works

```
Layer 1 · DETECTORS   raw structure + indicators
                      (FVG, order blocks, liquidity sweeps, BOS/CHoCH,
                       EMA stack, MACD, ADX, RSI, ATR, Supertrend, PSAR,
                       Ichimoku, Heikin-Ashi, Donchian, killzones)

Layer 2 · FILTERS     cheap pre-filters discard candles that can't
                      produce a viable signal

Layer 3 · STRATEGIES  46 scanners turn candidates into signals:
                      direction, entry/stop/target, reasons[]

Layer 4 · SCANNER     orchestrates instruments × timeframes × strategies,
                      applies the grading layer, filters by minScore,
                      persists to DB, dispatches alerts
```

Core engine lives in `src/lib/scanner/` — families in `strategies/`, shared detectors in `ict/` + `indicators/`, grading in `grading.ts`, orchestration in the `POST /api/scanner` route.

---

## Strategy catalog

| Family | Count | What's inside |
|---|---|---|
| **Trend** | 6 | EMA Stack (8/21/50/200), Supertrend + PSAR, MACD + ADX, Ichimoku Cloud, Heikin-Ashi Trend, Donchian Breakout |
| **ICT** | 8 | Fair Value Gap, Order Blocks, BOS/CHoCH, Liquidity Sweeps, OTE, Premium/Discount, Killzones / Silver Bullet, 2022 Mentorship Model |
| **Trader** | 10 | Community trader models: TTtrades, Jaefx, MovingAverage, Jadecapfx, Forexcartel/RealWeirdGene, DaveTeachesfx, Words of Rizdom, Tori Trades, Dion Trades, RCVisionaries |
| **EA** | 12 | Scanners distilled from **41 parsed MQL5 Expert Advisors**, each carrying the EA's claimed backtest stats (win rate, profit factor, drawdown) |
| **HORC** | 5 | Composite, Origin Structure, Coordinates, Liquidity, Zones/AOI |
| **Community** | 5 | Supertrend(10,2) + 4h HTF, Supertrend(10,3) + 4h HTF, SMC BOS/CHoCH (strength 5), SMC BOS/CHoCH (strength 3), Fib 50% Midpoint |

> A dual-channel module (3 strategies) sits in `src/lib/scanner/strategies/channel/` but is not yet wired into the unified catalog.

## Grading

Every signal gets a 0–100 score from 5 weighted factors, then a letter grade:

| Factor | Weight |
|---|---|
| Confluence count (independent conditions that fired) | 25 |
| Killzone alignment (London / NY / Silver Bullet) | 25 |
| Reward:Risk of entry / stop / target | 20 |
| Catalog edge (backtested win rate / PF of the strategy) | 15 |
| Freshness (decays over 24h) | 15 |

| Grade | Score |
|---|---|
| **A+** | 90–100 |
| **A** | 75–89 |
| **B+** | 60–74 |
| **B-** | 40–59 |
| **C** | 0–39 |

Default alert threshold: **score ≥ 50**.

## Instruments & timeframes

- **117 instruments** — 21 forex pairs (majors + crosses), 7 commodities (gold, silver, oil, natgas, copper, platinum), 13 crypto, US indices (S&P 500, Nasdaq 100, Dow, Russell) and large-cap stocks. Full list in `src/lib/scanner/instruments.ts`.
- **Timeframes:** `1h · 2h · 4h · 1d · 1w`
- **Price data:** live Yahoo Finance candles (`yahoo-finance2`), CSV fallback in `data/csv/`

---

## Alerts

### Discord
Set `DISCORD_WEBHOOK_URL` and any sweep (browser or scheduled) with `dispatch: true` sends embeds for signals scoring ≥ 50:

```
🔴 SHORT EUR/USD · 4h
SMC BOS s3 · Score 78 · Grade A
Entry: 1.0823 · Stop: 1.0850 · Target: 1.0770
▸ Close broke below Donchian lower
▸ Lower tracker falling
▸ London killzone active
```

Anti-flood rules per sweep (a full run can produce 500+ raw signals):
1. score ≥ 50 only
2. dedupe — keep the **best** signal per `symbol + timeframe + direction` (the 10 trader models collapse into one embed per pair)
3. cap at the **top 12 by score** (respects Discord's 30 msg/min webhook limit)

A summary embed follows every scheduled sweep, and a ⚠️ **Scanner Down** alert fires if a scheduled scan fails.

### Telegram & Email
Also supported (`telegraf`, `nodemailer`) — configured at runtime via the alerts API and stored in the `AlertConfigScanner` table.

### Test mode
```bash
curl "https://<your-app>/api/scanner/ping?test=1"
```
Sends sample signal embeds + a summary to Discord so you can preview the design without running a real scan.

---

## Scheduled scans (GitHub Actions)

**This is the 24/7 path.** `.github/workflows/scan.yml` hits the scanner every 6 hours (00:00 / 06:00 / 12:00 / 18:00 UTC) — no browser needed, no Vercel Cron required (Hobby plan allows only 1/day).

### One-time setup (2 minutes)

1. Generate a secret:
   ```bash
   openssl rand -hex 32
   ```
2. **Vercel** → project → Settings → Environment Variables → add `CRON_SECRET` with that value → redeploy.
3. **GitHub** → `NoirDOT/Quant-Scanner` → Settings → Secrets and variables → Actions → new repository secret `CRON_SECRET` (same value).
4. *(Optional)* Add a repository **variable** `SCANNER_URL` if you deploy somewhere other than the default production URL.

### Run a scan right now

GitHub → **Actions** tab → **Scanner Sweep** → **Run workflow**. Alerts land in Discord within ~30 seconds.

### Cost

One sweep ≈ 30 s → 4 sweeps/day ≈ **60 min/month** of GitHub Actions' 2,000 free minutes for private repos.

---

## API

| Endpoint | What it does |
|---|---|
| `POST /api/scanner` | Run a scan. Body: `strategyType` (`trend\|ict\|trader\|ea\|horc\|all`), `strategies[]`, `traderKeys[]`, `eaKeys[]`, `instruments` (`"all"`, symbol array, or `assetClasses[]`), `timeframes[]`, `minScore` (default 50), `persist`, `dispatch`, `filterKeys[]`. Returns graded signals + meta. |
| `GET /api/scanner/ping` | Full sweep + Discord dispatch. Protected by `Authorization: Bearer $CRON_SECRET`. `?test=1` for sample embeds. |
| `GET /api/scanner/signals` | Latest persisted signals |
| `GET /api/scanner/strategies` | Unified catalog (all 46 with metadata + backtest stats) |
| `GET /api/scanner/instruments` · `/grades` · `/killzones` | Reference data |
| `POST /api/scanner/backtest` · `/backtest-all` | Run the backtest engine |
| `/api/scanner/candidates` · `/eas` · `/horc` · `/smt-psp-pro` · `/stress-tests` · `/export` · `/csv-data` · `/data` · `/debug` · `/alerts` | Supporting endpoints |

## Database (Prisma)

SQLite in development, PostgreSQL in production (Vercel Postgres). Models:

- `ScanResult` — every persisted signal (strategy, symbol, TF, direction, score, grade, entry/stop/target)
- `BacktestByGrade` — backtest stats per strategy × symbol × timeframe, split by grade
- `AlertConfigScanner` / `AlertLogScanner` — alert channel config + delivery log
- `StressTestResult` / `ForwardTestSignal` — stress-test and forward-test records

---

## Run locally

```bash
bun install
bunx prisma generate
bun run db:push        # creates the SQLite db
bun run dev
```

Open **http://localhost:4000** — the scanner page auto-scans on a timeframe-aware cadence (5m / 15m / 60m, controlled by the **AUTO** toggle) and pushes any signal ≥ 50 straight to Discord while the tab is open.

Optional `.env`:

```env
DATABASE_URL="file:./db/custom.db"
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
CRON_SECRET="any-random-string"   # protects /api/scanner/ping
```

## Deploy on Vercel

1. Import `NoirDOT/Quant-Scanner` on Vercel
2. Create a Postgres database (Vercel → Storage) and link it
3. In `prisma/schema.prisma`, change `provider = "sqlite"` → `provider = "postgresql"`
4. Set env vars: `DATABASE_URL`, `DISCORD_WEBHOOK_URL`, `CRON_SECRET`
5. Deploy — `vercel.json` already sets the build command (`prisma generate && next build`)

## Backtesting

```bash
bun run backtest
```

Runs `scripts/backtest-all.ts` — backtests every strategy across instruments and timeframes, writes per-grade results to `BacktestByGrade`. Those stats feed the "catalog edge" factor in live grading, so better-validated strategies score higher.

## Project structure

```
src/
├── app/
│   ├── page.tsx                    # scanner UI (strategy cards → drill-down)
│   └── api/
│       ├── scanner/                # scan + ping + supporting endpoints
│       └── webhook/incoming/
├── lib/scanner/
│   ├── architecture.ts             # 4-layer types
│   ├── instruments.ts              # 117 instruments + timeframes
│   ├── data.ts                     # Yahoo Finance candles (CSV fallback)
│   ├── grading.ts                  # 5-factor A+→C grading
│   ├── indicators/                 # EMA, MACD, ADX, RSI, ATR, Supertrend, PSAR, Ichimoku, HA, Donchian
│   ├── ict/                        # FVG, order blocks, liquidity, structure, killzones, premium/discount, OTE
│   ├── strategies/                 # trend · ict · traders · eas · horc · community · channel
│   ├── alerts/                     # discord · telegram · email + dispatcher
│   └── backtest/                   # backtest engine
└── routes/quantforge/              # scanner page component
```
