// src/lib/scanner/risk.ts
// Position sizing — converts a setup's entry/stop into a lot size given
// account size + risk percentage.
//
// Per-instrument contract specs (contract size, pip size, quote currency)
// + live FX conversion so the lot size is correct for JPY pairs, crosses,
// commodities, indices, and crypto.
//
// The live FX rates are passed in by runScan (which already fetches them)
// so we don't double-fetch.

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

// ─── Per-instrument contract specs ──────────────────────────────────────────
// Keyed by Yahoo Finance symbol. Each spec defines:
//   contractSize: how many units one standard lot represents
//   pipSize: the smallest meaningful price increment
//   quoteCurrency: the currency the price is denominated in (for USD conversion)

interface InstrumentSpec {
  contractSize: number;
  pipSize: number;
  quoteCurrency: string;
}

const INSTRUMENT_SPECS: Record<string, InstrumentSpec> = {
  // Forex majors — JPY pairs have pipSize 0.01
  "USDJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },
  "EURJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },
  "GBPJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },
  "AUDJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },
  "CHFJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },
  "NZDJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },
  "CADJPY=X": { contractSize: 100_000, pipSize: 0.01, quoteCurrency: "JPY" },

  // Forex crosses (non-JPY) — quote currency is the second 3 letters
  "EURGBP=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "GBP" },
  "EURCAD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "CAD" },
  "EURAUD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "AUD" },
  "GBPCAD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "CAD" },
  "GBPCHF=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "CHF" },

  // Forex majors (USD quote) — standard
  "EURUSD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "USD" },
  "GBPUSD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "USD" },
  "AUDUSD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "USD" },
  "USDCAD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "CAD" },
  "USDCHF=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "CHF" },
  "NZDUSD=X": { contractSize: 100_000, pipSize: 0.0001, quoteCurrency: "USD" },

  // Commodities — vary widely
  "GC=F":   { contractSize: 100,   pipSize: 0.1,   quoteCurrency: "USD" }, // Gold: 100 oz/lot, $0.10/pt
  "SI=F":   { contractSize: 5000,  pipSize: 0.01,  quoteCurrency: "USD" }, // Silver: 5000 oz/lot, $0.01/pt
  "CL=F":   { contractSize: 1000,  pipSize: 0.01,  quoteCurrency: "USD" }, // Crude: 1000 bbl/lot, $0.01/pt
  "BZ=F":   { contractSize: 1000,  pipSize: 0.01,  quoteCurrency: "USD" }, // Brent
  "NG=F":   { contractSize: 10000, pipSize: 0.001, quoteCurrency: "USD" }, // NatGas: 10000 MMBtu/lot
  "HG=F":   { contractSize: 25000, pipSize: 0.01,  quoteCurrency: "USD" }, // Copper: 25000 lbs/lot
  "PL=F":   { contractSize: 50,    pipSize: 0.1,   quoteCurrency: "USD" }, // Platinum: 50 oz/lot

  // Crypto — 1 unit = 1 coin
  "BTC-USD": { contractSize: 1, pipSize: 1, quoteCurrency: "USD" },
  "ETH-USD": { contractSize: 1, pipSize: 1, quoteCurrency: "USD" },
  "SOL-USD": { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "XRP-USD": { contractSize: 1, pipSize: 0.0001, quoteCurrency: "USD" },
  "DOGE-USD": { contractSize: 1, pipSize: 0.00001, quoteCurrency: "USD" },

  // Indices — 1 contract = $1 per point
  "^GSPC":   { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "^NDX":    { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "^DJI":    { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "^RUT":    { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "US500=F": { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "USTEC=F": { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
  "US30=F":  { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" },
};

/** Get the instrument spec, falling back to a generic forex default. */
function getSpec(symbol: string, assetClass: string): InstrumentSpec {
  if (INSTRUMENT_SPECS[symbol]) return INSTRUMENT_SPECS[symbol];
  // Generic forex default — quote currency is the second 3 letters
  if (assetClass === "forex") {
    const pair = symbol.replace("=X", "");
    if (pair.length === 6) {
      const quote = pair.slice(3, 6);
      const pipSize = quote === "JPY" ? 0.01 : 0.0001;
      return { contractSize: 100_000, pipSize, quoteCurrency: quote };
    }
  }
  // Generic fallback
  return { contractSize: 1, pipSize: 0.01, quoteCurrency: "USD" };
}

/**
 * Convert a quote currency amount to USD using live FX rates.
 * Returns null when the rate is missing — callers should treat a null return
 * as "can't size this trade safely" rather than silently using the wrong size.
 *
 * `fxRates` is a map of quote currency → USD price of 1 unit.
 * e.g. { "JPY": 0.0067, "GBP": 1.27, "EUR": 1.08 }
 */
function quoteToUSD(
  amount: number,
  quoteCurrency: string,
  fxRates?: Record<string, number>,
): number | null {
  if (quoteCurrency === "USD") return amount;
  if (!fxRates) return null; // can't convert — signal "unknown size"
  const rate = fxRates[quoteCurrency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return amount * rate;
}

export interface ComputePositionSizeOpts {
  /** Live FX rates — map of quote currency → USD price of 1 unit.
   *  e.g. { "JPY": 0.0067, "GBP": 1.27, "EUR": 1.08 }
   *  Pass null/omit to assume 1:1 (no conversion — wrong for non-USD). */
  fxRates?: Record<string, number> | null;
}

/**
 * Compute position size for a signal given a risk config.
 *
 * Formula:
 *   riskAmount = accountBalance × riskPerTrade  (in USD)
 *   stopDistance = |entry - stop|  (in price units)
 *   usdPerPointPerLot = contractSize × fxRate(quoteCurrency → USD)
 *   lots = riskAmount / (stopDistance × usdPerPointPerLot)
 *   pipValuePerLot = pipSize × usdPerPointPerLot
 */
export function computePositionSize(
  signal: ScanSignal,
  config: RiskConfig,
  opts: ComputePositionSizeOpts = {},
): PositionSize | null {
  if (!signal.entryPrice || !signal.stopPrice) return null;
  const riskAmount = config.accountBalance * config.riskPerTrade;
  const stopDistance = Math.abs(signal.entryPrice - signal.stopPrice);
  if (stopDistance <= 0) return null;

  const spec = getSpec(signal.symbol, signal.assetClass);
  const fxRates = opts.fxRates ?? undefined;

  // Per-lot USD value of a 1.0 price move. Returns null if the FX rate
  // for the quote currency is missing (e.g. an EUR/GBP-only scan won't
  // have USD/GBP or USD/EUR rates). In that case we return null rather
  // than silently returning the wrong size.
  const converted = quoteToUSD(1, spec.quoteCurrency, fxRates);
  if (converted === null) return null;
  const usdPerPointPerLot = spec.contractSize * converted;
  if (usdPerPointPerLot <= 0) return null;

  const pipValuePerLot = spec.pipSize * usdPerPointPerLot;
  const stopPips = stopDistance / spec.pipSize;
  const lots = riskAmount / (stopDistance * usdPerPointPerLot);
  const units = lots * spec.contractSize;

  let label: string;
  if (signal.assetClass === "forex") {
    label = `${lots.toFixed(2)} lots`;
  } else if (signal.assetClass === "crypto") {
    const base = signal.symbol.replace(/-USD$/, "").replace(/-USDT$/, "");
    label = `${units.toFixed(4)} ${base}`;
  } else {
    label = `${lots.toFixed(2)} contracts`;
  }

  return {
    riskAmount,
    stopDistance,
    stopPips,
    pipValuePerLot,
    lots,
    units,
    label,
  };
}

/** Default risk config — 1% of a $10,000 account. */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  accountBalance: 10_000,
  riskPerTrade: 0.01,
};
