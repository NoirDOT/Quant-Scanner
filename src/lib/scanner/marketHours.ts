// src/lib/scanner/marketHours.ts
// Market-hours awareness — prevents scanning instruments whose market is
// currently closed. This is the fix for weekend forex alerts: FX is closed
// Saturday + Sunday (before 22:00 UTC), so currency pairs must not produce
// or dispatch signals on weekends. Crypto trades 24/7 so it's always scanned.
//
// FX session: opens Sunday 22:00 UTC (Sydney), closes Friday 22:00 UTC (NY).
//   -> Closed: all of Saturday, and Sunday before 22:00 UTC.
//
// Commodities / Indices / Stocks: no weekend session. US futures reopen
// Sunday ~23:00 UTC, but we treat the full weekend as closed to avoid
// borderline phantom signals — safer to skip than to emit stale alerts.

export type MarketAssetClass = "forex" | "crypto" | "commodity" | "index" | "stock";

/**
 * Is the FX market open at the given instant?
 * FX runs Sunday 22:00 UTC → Friday 22:00 UTC (24/5).
 */
export function isFxMarketOpen(date: Date = new Date()): boolean {
  const day = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  if (day === 6) return false; // Saturday — closed all day
  if (day === 0) return hours >= 22; // Sunday — opens 22:00 UTC
  if (day === 5) return hours < 22; // Friday — closes 22:00 UTC
  return true; // Monday–Thursday — open 24h
}

/**
 * Is the market open for a given asset class?
 * Crypto is 24/7 (always open, including weekends).
 * Forex follows the 24/5 FX week.
 * Commodities / indices / stocks are closed Saturday + Sunday.
 */
export function isMarketOpen(assetClass: string, date: Date = new Date()): boolean {
  switch (assetClass) {
    case "crypto":
      return true; // 24/7
    case "forex":
      return isFxMarketOpen(date);
    case "commodity":
    case "index":
    case "stock": {
      const day = date.getUTCDay();
      return day !== 6 && day !== 0; // closed Sat (6) + Sun (0)
    }
    default:
      return true; // unknown asset class — don't block
  }
}
