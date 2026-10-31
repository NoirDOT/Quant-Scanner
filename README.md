# Quant Scanner — Standalone

A multi-strategy market scanner with 48 strategies across 6 families:
- Trend (6), ICT (8), Trader (10), EA (12), HORC (5), Community (5), Channel (3)

## Features
- 4-layer architecture: Detector → Filter → Strategy → Scanner
- Universal A+/A/B+/B-/C grading
- Live Yahoo Finance price overlay
- Auto-scan with timeframe-aware cadence
- Inline backtest engine (Sharpe/PF/MaxDD/WinRate)
- Prop Firm Sim with Monte Carlo combination optimizer
- 6-test Kieranduff stress test suite
- 14 handbook-validated scanners (candidates for MT5)
- Discord bot + TradingView webhook

## Setup

```bash
# 1. Install deps
bun install   # or npm install / pnpm install

# 2. Apply Prisma schema
bunx prisma generate
bunx prisma db push --accept-data-loss

# 3. (Optional) Add CSV data to data/csv/

# 4. Run (port 4000)
bun run dev
```

Open http://localhost:4000

## Backtest

```bash
bun run scripts/backtest-all.ts
```

Runs walk-forward backtest on all 48 strategies across 6 instruments × 3 timeframes.

## Scanners

### 14 Handbook-Validated (MT5 candidates)
| Scanner | Family | Tests | Score |
|---------|--------|-------|-------|
| trend-donchian | Trend | 6/6 | 100% |
| trend-ema | Trend | 5/6 | 83% |
| ict-fvg | ICT | 5/6 | 83% |
| community-smc-bos-choch-s3 | Community | 5/6 | 83% |
| channel-dual-donchian | Channel | 5/6* | 83% |

### Prop Firm Best Combination
`channel-dual-donchian + community-smc-bos-choch-s3 → 70.4% pass rate` (+7.8% synergy)
