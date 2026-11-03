// src/lib/scanner/risk.ts
// Position sizing — converts a setup's entry/stop into a lot size given
// account size + risk percentage.
//
// "Add risk sizing. Given account size and a risk percentage, show the lot
// size per setup, using the pip and contract values you already define."
//
// This module is pure (no DB, no I/O) so it can run client-side.

import type { ScanSignal } from "./types";

export interface RiskConfig {
  /** Account balance in USD. */
  accountBalance: number;
  /** Risk per trade as a fraction (0.01 = 1%). Default 0.01. */
  riskPerTrade: number;
}

export interface PositionSize {
  /** Risk amount in USD. */
  riskAmount: number;
  /** Stop distance in price units. */
  stopDistance: number;
  /** Stop distance in pips (forex) or points (other asset classes). */
  stopPips: number;
  /** Pip value per standard lot in USD. */
  pipValuePerLot: number;
  /** Position size in standard lots. */
  lots: number;
  /** Position size in units (for crypto). */
  units: number;
  /** Human-readable size, e.g. "0.23 lots" or "0.15 BTC". */
  label: string;
}

/** Pip size per asset class. Forex majors = 0.0001, JPY pairs = 0.01, etc. */
function pipSize(symbol: string, assetClass: string): number {
  if (assetClass === "forex") {
    return symbol.includes("JPY") ? 0.01 : 0.0001;
  }
  return 1; // commodities, indices, crypto use whole units
}

/** Contract size per asset class. Forex standard lot = 100,000 units. */
function contractSize(assetClass: string): number {
  switch (assetClass) {
    case "forex": return 100_000;
    case "crypto": return 1;
    case "commodity": return 100;    // gold: 100 oz/contract
    case "index": return 1;           // 1 point = $1
    default: return 1;
  }
}

/**
 * Compute position size for a signal given a risk config.
 *
 * Forex: riskAmount / (stopPips × pipValuePerLot) = lots
 *   where pipValuePerLot = (pipSize / price) × contractSize × price = pipSize × contractSize
 *   Wait — that simplifies. For a standard lot (100k units) of EUR/USD:
 *     pip = 0.0001, contract = 100,000, so pipValuePerLot = 0.0001 × 100,000 = $10
 *   For USD/JPY: pip = 0.01, contract = 100,000, pipValuePerLot = 0.01 × 100,000 = $1000?
 *   No — JPY pip value = (0.01 / price) × 100,000 ≈ $9.13 at 109.50
 *   We simplify by using a USD-quote assumption: for JPY pairs we divide the
 *   stop distance by the entry price to get "pips" in USD terms.
 *
 * For simplicity (this is a scanner, not a broker), we compute:
 *   riskAmount / stopDistance = max units (how many units you can hold so that
 *   a full stop-out costs exactly riskAmount)
 *   Then convert to lots (forex) or coins (crypto).
 */
export function computePositionSize(signal: ScanSignal, config: RiskConfig): PositionSize | null {
  if (!signal.entryPrice || !signal.stopPrice) return null;
  const riskAmount = config.accountBalance * config.riskPerTrade;
  const stopDistance = Math.abs(signal.entryPrice - signal.stopPrice);
  if (stopDistance <= 0) return null;

  // Max units = riskAmount / stopDistance (so a full stop = riskAmount loss)
  const maxUnits = riskAmount / stopDistance;
  const contract = contractSize(signal.assetClass);
  const lots = maxUnits / contract;
  const pip = pipSize(signal.symbol, signal.assetClass);
  const stopPips = stopDistance / pip;
  const pipValuePerLot = pip * contract;

  let label: string;
  if (signal.assetClass === "forex") {
    label = `${lots.toFixed(2)} lots`;
  } else if (signal.assetClass === "crypto") {
    const coinUnits = maxUnits / signal.entryPrice;
    label = `${coinUnits.toFixed(4)} ${signal.symbol.replace(/-USD$/, "").replace(/-USDT$/, "")}`;
  } else {
    label = `${lots.toFixed(2)} contracts`;
  }

  return {
    riskAmount,
    stopDistance,
    stopPips,
    pipValuePerLot,
    lots,
    units: maxUnits,
    label,
  };
}

/** Default risk config — 1% of a $10,000 account. Override in the UI. */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  accountBalance: 10_000,
  riskPerTrade: 0.01,
};
