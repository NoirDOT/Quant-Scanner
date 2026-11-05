// src/lib/scanner/paperTrade.ts
// Paper trading service — opens virtual trades when setups are dispatched,
// closes them when stop/target hits, and tracks account equity + P&L.
//
// Trades are opened with the position size from risk.ts (account balance ×
// risk % per trade). When a trade closes:
//   - Win: realizedPnl = riskAmount × R:R (e.g. risk $100 at 1:2 = +$200)
//   - Loss: realizedPnl = -riskAmount (e.g. -$100)
//   - Timeout: realizedPnl = 0 (neither hit within maxBars)
//
// Account balance updates on each close. The daily summary posts the running
// balance, win rate, total R, and open positions to Discord.

import type { Setup } from "./consolidate";
import type { ScanSignal } from "./types";
import { db } from "@/lib/db";
import { computePositionSize, DEFAULT_RISK_CONFIG, type RiskConfig } from "./risk";
import type { Candle } from "./data";
import { getCandles } from "./data";
import type { Timeframe } from "./instruments";

// ─── Account management ───────────────────────────────────────────────────

/** Get or initialize the paper trading account. */
export async function getAccount() {
  let account = await db.paperTradeAccount.findUnique({ where: { id: "main" } }).catch(() => null);
  if (!account) {
    const startingBalance = parseFloat(process.env.PAPER_TRADE_BALANCE ?? "10000");
    account = await db.paperTradeAccount.create({
      data: {
        id: "main",
        startingBalance,
        currentBalance: startingBalance,
      },
    }).catch(() => null);
    if (!account) {
      // DB not available — return a default in-memory account
      return {
        id: "main",
        startingBalance: 10000,
        currentBalance: 10000,
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        totalTimeouts: 0,
        totalRealizedR: 0,
        totalRealizedPnl: 0,
        openRisk: 0,
        updatedAt: new Date(),
      };
    }
  }
  return account;
}

/** Get the risk config from env vars (or defaults). */
function getRiskConfig(): RiskConfig {
  return {
    accountBalance: parseFloat(process.env.PAPER_TRADE_BALANCE ?? "10000"),
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE ?? "0.01"),
  };
}

// ─── Open trades ───────────────────────────────────────────────────────────

export interface OpenTradeResult {
  opened: number;
  skipped: number;
  error?: string;
}

/**
 * Open a paper trade for a dispatched setup.
 * Called by dispatchAlerts when a setup is sent to Discord.
 *
 * If a trade with the same setupKey already exists (from a previous dispatch),
 * it's skipped — we don't double-enter.
 */
export async function openPaperTrade(
  setup: Setup,
  fxRates?: Record<string, number> | null,
): Promise<{ opened: boolean; tradeId?: string; error?: string }> {
  const best = setup.best;
  if (!best.entryPrice || !best.stopPrice || !best.targetPrice) {
    return { opened: false, error: "Missing entry/stop/target" };
  }

  const setupKey = `setup:${setup.symbol}:${setup.direction}:${best.metadata?.barTime ?? 0}`;

  // Check if a trade already exists for this setup
  const existing = await db.paperTrade.findUnique({ where: { setupKey } }).catch(() => null);
  if (existing) {
    return { opened: false, error: "Trade already exists for this setup" };
  }

  // Compute position size
  const cfg = getRiskConfig();
  const posSize = computePositionSize(best, cfg, { fxRates: fxRates ?? undefined });
  const lots = posSize?.lots ?? 0;
  const riskAmount = posSize?.riskAmount ?? cfg.accountBalance * cfg.riskPerTrade;
  const pipValuePerLot = posSize?.pipValuePerLot ?? 0;

  try {
    const trade = await db.paperTrade.create({
      data: {
        setupKey,
        strategyKey: best.strategyKey,
        symbol: setup.symbol,
        timeframe: best.timeframe,
        direction: setup.direction,
        entryPrice: best.entryPrice,
        stopPrice: best.stopPrice,
        targetPrice: best.targetPrice,
        score: setup.score,
        grade: best.grade ?? null,
        familiesJson: JSON.stringify(setup.families),
        lots,
        riskAmount,
        pipValuePerLot,
        regime: setup.regime ?? null,
      },
    });

    // Update open risk on the account
    await db.paperTradeAccount.update({
      where: { id: "main" },
      data: { openRisk: { increment: riskAmount } },
    }).catch(() => null);

    return { opened: true, tradeId: trade.id };
  } catch (err) {
    // P2002 = unique constraint (race condition — trade already opened)
    if ((err as any)?.code === "P2002") {
      return { opened: false, error: "Trade already exists (race)" };
    }
    console.error("[paperTrade] open error:", err);
    return { opened: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * Open paper trades for multiple setups (batch).
 */
export async function openPaperTrades(
  setups: Setup[],
  fxRates?: Record<string, number> | null,
): Promise<OpenTradeResult> {
  let opened = 0;
  let skipped = 0;
  for (const setup of setups) {
    const result = await openPaperTrade(setup, fxRates);
    if (result.opened) opened++;
    else skipped++;
  }
  return { opened, skipped };
}

// ─── Close trades ──────────────────────────────────────────────────────────

export interface CloseResult {
  closed: number;
  wins: number;
  losses: number;
  timeouts: number;
  totalPnl: number;
  totalR: number;
  errors: string[];
}

/**
 * Close open paper trades by replaying subsequent candles.
 * For each open trade:
 *   1. Fetch candles AFTER the trade was opened
 *   2. Check if stop or target hit within maxBars
 *   3. If hit → close the trade, update P&L + account balance
 *   4. If maxBars passed with no hit → close as timeout (P&L = 0)
 *   5. If not enough bars yet → leave open
 *
 * Conservative: if both stop and target hit in the same bar, assume stop first.
 */
export async function closeOpenPaperTrades(maxBars = 50): Promise<CloseResult> {
  const result: CloseResult = {
    closed: 0, wins: 0, losses: 0, timeouts: 0,
    totalPnl: 0, totalR: 0, errors: [],
  };

  const openTrades = await db.paperTrade.findMany({
    where: { status: "open" },
    take: 200,
    orderBy: { openedAt: "asc" },
  }).catch((err) => {
    console.error("[paperTrade] fetch open trades error:", err);
    return [];
  });

  if (openTrades.length === 0) return result;

  for (const trade of openTrades) {
    try {
      const tf = trade.timeframe as Timeframe;
      const candles = await getCandles(trade.symbol, tf, 300);
      const tradeMs = trade.openedAt.getTime();
      const after = candles.filter((c) => c.time * 1000 > tradeMs);

      let outcome: "win" | "loss" | "timeout" | null = null;
      let exitPrice: number | null = null;
      let exitAt: Date | null = null;
      let barsToExit = 0;
      const risk = Math.abs(trade.entryPrice - trade.stopPrice);

      if (risk <= 0) {
        // Degenerate — skip
        continue;
      }

      const loopLimit = Math.min(after.length, maxBars);
      for (let i = 0; i < loopLimit; i++) {
        const c = after[i];
        barsToExit = i + 1;
        if (trade.direction === "long") {
          const stopHit = c.low <= trade.stopPrice;
          const targetHit = c.high >= trade.targetPrice;
          if (stopHit && targetHit) {
            outcome = "loss"; exitPrice = trade.stopPrice; exitAt = c.date; break;
          } else if (stopHit) {
            outcome = "loss"; exitPrice = trade.stopPrice; exitAt = c.date; break;
          } else if (targetHit) {
            outcome = "win"; exitPrice = trade.targetPrice; exitAt = c.date; break;
          }
        } else {
          const stopHit = c.high >= trade.stopPrice;
          const targetHit = c.low <= trade.targetPrice;
          if (stopHit && targetHit) {
            outcome = "loss"; exitPrice = trade.stopPrice; exitAt = c.date; break;
          } else if (stopHit) {
            outcome = "loss"; exitPrice = trade.stopPrice; exitAt = c.date; break;
          } else if (targetHit) {
            outcome = "win"; exitPrice = trade.targetPrice; exitAt = c.date; break;
          }
        }
      }

      // If no hit yet, check whether enough bars passed
      if (outcome === null) {
        if (after.length < maxBars) {
          // Not enough bars — leave open for a future run
          continue;
        }
        outcome = "timeout";
        exitPrice = after[after.length - 1]?.close ?? trade.entryPrice;
        exitAt = after[after.length - 1]?.date ?? new Date();
      }

      // Compute R multiple + P&L
      const sign = trade.direction === "long" ? 1 : -1;
      const rMultiple = exitPrice != null
        ? ((exitPrice - trade.entryPrice) * sign) / risk
        : 0;
      // P&L = riskAmount × R (for wins: positive, for losses: -riskAmount)
      const realizedPnl = outcome === "timeout"
        ? 0
        : trade.riskAmount * rMultiple;

      // Close the trade
      await db.paperTrade.update({
        where: { id: trade.id },
        data: {
          status: outcome,
          closedAt: exitAt,
          exitPrice: exitPrice ?? undefined,
          barsToExit,
          realizedR: rMultiple,
          realizedPnl,
        },
      });

      // Update account balance + stats
      await db.paperTradeAccount.update({
        where: { id: "main" },
        data: {
          currentBalance: { increment: realizedPnl },
          totalTrades: { increment: 1 },
          totalWins: outcome === "win" ? { increment: 1 } : undefined,
          totalLosses: outcome === "loss" ? { increment: 1 } : undefined,
          totalTimeouts: outcome === "timeout" ? { increment: 1 } : undefined,
          totalRealizedR: { increment: rMultiple },
          totalRealizedPnl: { increment: realizedPnl },
          openRisk: { decrement: trade.riskAmount },
        },
      }).catch(() => null);

      result.closed++;
      if (outcome === "win") result.wins++;
      else if (outcome === "loss") result.losses++;
      else result.timeouts++;
      result.totalPnl += realizedPnl;
      result.totalR += rMultiple;
    } catch (err) {
      result.errors.push(`${trade.symbol}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return result;
}

// ─── Summary ──────────────────────────────────────────────────────────────

export interface PaperTradeSummary {
  account: {
    startingBalance: number;
    currentBalance: number;
    totalTrades: number;
    totalWins: number;
    totalLosses: number;
    totalTimeouts: number;
    totalRealizedR: number;
    totalRealizedPnl: number;
    openRisk: number;
    winRate: number;
    roi: number; // (currentBalance - startingBalance) / startingBalance × 100
  };
  openTrades: Array<{
    symbol: string;
    direction: string;
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    score: number;
    openedAt: Date;
    unrealizedR: number;
  }>;
  todayClosed: Array<{
    symbol: string;
    direction: string;
    outcome: string;
    realizedR: number;
    realizedPnl: number;
    closedAt: Date;
  }>;
}

/**
 * Build a summary of the paper trading account for the daily Discord embed.
 */
export async function getPaperTradeSummary(): Promise<PaperTradeSummary | null> {
  const account = await getAccount();

  // Open trades with unrealized R (approximate using current price if available)
  const openTrades = await db.paperTrade.findMany({
    where: { status: "open" },
    orderBy: { openedAt: "desc" },
    take: 20,
  }).catch(() => []);

  // Today's closed trades
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayClosed = await db.paperTrade.findMany({
    where: { status: { in: ["win", "loss", "timeout"] }, closedAt: { gte: todayStart } },
    orderBy: { closedAt: "desc" },
    take: 20,
  }).catch(() => []);

  const winRate = account.totalTrades > 0
    ? (account.totalWins / account.totalTrades) * 100
    : 0;
  const roi = account.startingBalance > 0
    ? ((account.currentBalance - account.startingBalance) / account.startingBalance) * 100
    : 0;

  return {
    account: {
      startingBalance: account.startingBalance,
      currentBalance: account.currentBalance,
      totalTrades: account.totalTrades,
      totalWins: account.totalWins,
      totalLosses: account.totalLosses,
      totalTimeouts: account.totalTimeouts,
      totalRealizedR: account.totalRealizedR,
      totalRealizedPnl: account.totalRealizedPnl,
      openRisk: account.openRisk,
      winRate,
      roi,
    },
    openTrades: openTrades.map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      entryPrice: t.entryPrice,
      stopPrice: t.stopPrice,
      targetPrice: t.targetPrice,
      score: t.score,
      openedAt: t.openedAt,
      unrealizedR: 0, // would need live price — set by caller
    })),
    todayClosed: todayClosed.map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      outcome: t.status,
      realizedR: t.realizedR ?? 0,
      realizedPnl: t.realizedPnl ?? 0,
      closedAt: t.closedAt ?? new Date(),
    })),
  };
}
