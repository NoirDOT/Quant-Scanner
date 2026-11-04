// src/lib/scanner/news.ts
// Economic news blackout flag — suppresses setups around high-impact events.
//
// High-impact events (NFP, FOMC, CPI, rate decisions) cause violent,
// unpredictable moves that invalidate technical setups. This module
// identifies when a blackout window is active and which currencies are
// affected, so consolidate() can flag/suppress setups.
//
// Uses a hardcoded schedule of recurring events (no external API needed):
//   - NFP: first Friday of every month, 13:30 UTC
//   - CPI: monthly, around the 10th-13th (approximate — varies)
//   - FOMC: 8 meetings/year (we approximate as every 6 weeks, Wed)
//   - ECB: 8 meetings/year (approximate)
//   - BoE: 8 meetings/year (approximate)
//
// Override via NEWS_BLACKOUT_OVERRIDE env var for custom events:
//   "USD:2026-11-05T13:30:00Z:60, EUR:2026-11-07T12:45:00Z:60"

export interface NewsEvent {
  name: string;
  currencies: string[];  // ["USD"], ["EUR"], ["GBP"], etc.
  startTime: Date;
  /** Blackout window in minutes before and after the event. */
  blackoutMinutes: number;
  /** Impact level — only "high" events trigger blackouts. */
  impact: "high" | "medium" | "low";
}

export interface NewsBlackoutResult {
  /** True if any high-impact event is in its blackout window right now. */
  inBlackout: boolean;
  /** Currencies affected by the current blackout — setups on these pairs
   *  should be suppressed or flagged. */
  affectedCurrencies: Set<string>;
  /** The events causing the blackout (for display in the UI/Discord). */
  activeEvents: NewsEvent[];
  /** Events coming up in the next 24h (for the summary embed). */
  upcoming: NewsEvent[];
}

// ─── Recurring event schedule ────────────────────────────────────────────────
// These are approximations. For a scanner that runs every 4h, being within
// a few hours is fine — we just need to know "is a major event happening
// right now or very soon?"

function firstFridayOfMonth(year: number, month: number): Date {
  const d = new Date(Date.UTC(year, month, 1, 13, 30, 0));
  // Day 5 = Friday in JS (0=Sun). Find the first Friday.
  while (d.getUTCDay() !== 5) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(13, 30, 0, 0);
  return d;
}

function nthDayOfMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1, 18, 0, 0));
  let count = 0;
  while (d.getUTCDay() !== dayOfWeek || count < n - 1) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() === dayOfWeek) count++;
  }
  return d;
}

/** Returns the next N high-impact economic events from the recurring schedule. */
function getRecurringEvents(now: Date, lookAheadDays = 7): NewsEvent[] {
  const events: NewsEvent[] = [];
  const lookAhead = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

  for (let monthOffset = -1; monthOffset <= 2; monthOffset++) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() + monthOffset);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();

    // NFP — first Friday of each month, 13:30 UTC
    const nfp = firstFridayOfMonth(year, month);
    if (nfp > new Date(now.getTime() - 24 * 60 * 60 * 1000) && nfp < lookAhead) {
      events.push({
        name: "NFP (Non-Farm Payrolls)",
        currencies: ["USD"],
        startTime: nfp,
        blackoutMinutes: 60,
        impact: "high",
      });
    }

    // CPI — approximate as the 13th of each month (varies, but close enough)
    const cpi = new Date(Date.UTC(year, month, 13, 13, 30, 0));
    if (cpi > new Date(now.getTime() - 24 * 60 * 60 * 1000) && cpi < lookAhead) {
      events.push({
        name: "CPI (Inflation)",
        currencies: ["USD"],
        startTime: cpi,
        blackoutMinutes: 60,
        impact: "high",
      });
    }

    // FOMC — 8 meetings/year, approximately every 6 weeks on Wednesday
    // We approximate as the 3rd Wednesday of every 6-week cycle.
    // For simplicity, schedule on the 3rd Wednesday of Jan, Mar, Apr, Jun, Jul, Sep, Oct, Dec.
    const fomcMonths = [0, 2, 3, 5, 6, 8, 9, 11]; // Jan, Mar, Apr, Jun, Jul, Sep, Oct, Dec
    if (fomcMonths.includes(month)) {
      const fomc = nthDayOfMonth(year, month, 3, 2); // 2nd Wednesday (day 3 = Wed)
      fomc.setUTCHours(18, 0, 0, 0); // 18:00 UTC (2:00 PM ET)
      if (fomc > new Date(now.getTime() - 24 * 60 * 60 * 1000) && fomc < lookAhead) {
        events.push({
          name: "FOMC Rate Decision",
          currencies: ["USD"],
          startTime: fomc,
          blackoutMinutes: 120, // FOMC has a longer blackout (press conference)
          impact: "high",
        });
      }
    }

    // ECB rate decision — approximate as the 2nd Thursday of Mar, Jun, Sep, Dec
    const ecbMonths = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec
    if (ecbMonths.includes(month)) {
      const ecb = nthDayOfMonth(year, month, 4, 2); // 2nd Thursday (day 4 = Thu)
      ecb.setUTCHours(12, 45, 0, 0);
      if (ecb > new Date(now.getTime() - 24 * 60 * 60 * 1000) && ecb < lookAhead) {
        events.push({
          name: "ECB Rate Decision",
          currencies: ["EUR"],
          startTime: ecb,
          blackoutMinutes: 90,
          impact: "high",
        });
      }
    }

    // BoE rate decision — approximate as the 3rd Thursday of every month
    // (actually every 6 weeks, but monthly approximation is conservative)
    const boe = nthDayOfMonth(year, month, 4, 3); // 3rd Thursday
    boe.setUTCHours(12, 0, 0, 0);
    if (boe > new Date(now.getTime() - 24 * 60 * 60 * 1000) && boe < lookAhead) {
      events.push({
        name: "BoE Rate Decision",
        currencies: ["GBP"],
        startTime: boe,
        blackoutMinutes: 90,
        impact: "high",
      });
    }
  }

  // Parse override events from env var
  const override = process.env.NEWS_BLACKOUT_OVERRIDE;
  if (override) {
    for (const entry of override.split(",")) {
      const [currencies, isoTime, minutes] = entry.trim().split(":");
      if (!currencies || !isoTime) continue;
      const startTime = new Date(isoTime);
      if (isNaN(startTime.getTime())) continue;
      events.push({
        name: "Custom Event",
        currencies: currencies.split("|"),
        startTime,
        blackoutMinutes: parseInt(minutes ?? "60", 10),
        impact: "high",
      });
    }
  }

  return events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

/** Returns the currencies a symbol's pair involves, based on its Yahoo ticker. */
function symbolCurrencies(symbol: string, assetClass: string): string[] {
  if (assetClass === "forex") {
    // EURUSD=X → ["EUR", "USD"], USDJPY=X → ["USD", "JPY"], etc.
    const pair = symbol.replace("=X", "");
    if (pair.length === 6) {
      return [pair.slice(0, 3), pair.slice(3, 6)];
    }
    return [];
  }
  if (assetClass === "crypto") {
    // BTC-USD → ["USD"] (crypto quotes in USD)
    if (symbol.endsWith("-USD")) return ["USD"];
    return [];
  }
  if (assetClass === "commodity") {
    // Gold, Silver, Oil are USD-quoted
    return ["USD"];
  }
  if (assetClass === "index") {
    // US indices are USD-quoted
    return ["USD"];
  }
  return [];
}

/** Check if a setup's symbol is affected by any active news blackout. */
export function isSymbolAffected(
  symbol: string,
  assetClass: string,
  blackout: NewsBlackoutResult,
): boolean {
  if (!blackout.inBlackout) return false;
  const currencies = symbolCurrencies(symbol, assetClass);
  return currencies.some((c) => blackout.affectedCurrencies.has(c));
}

/** Main entry — call this once per scan to get the current blackout state. */
export function getNewsBlackout(now: Date = new Date()): NewsBlackoutResult {
  const events = getRecurringEvents(now, 7);

  const active: NewsEvent[] = [];
  const upcoming: NewsEvent[] = [];
  const affectedCurrencies = new Set<string>();

  for (const event of events) {
    const blackoutMs = event.blackoutMinutes * 60 * 1000;
    const blackoutStart = new Date(event.startTime.getTime() - blackoutMs);
    const blackoutEnd = new Date(event.startTime.getTime() + blackoutMs);

    if (now >= blackoutStart && now <= blackoutEnd) {
      active.push(event);
      for (const c of event.currencies) affectedCurrencies.add(c);
    } else if (event.startTime > now && event.startTime < new Date(now.getTime() + 24 * 60 * 60 * 1000)) {
      upcoming.push(event);
    }
  }

  return {
    inBlackout: active.length > 0,
    affectedCurrencies,
    activeEvents: active,
    upcoming,
  };
}

/** Format active events for display in the UI/Discord. */
export function formatActiveEvents(blackout: NewsBlackoutResult): string | null {
  if (!blackout.inBlackout) return null;
  return blackout.activeEvents
    .map((e) => `🔴 ${e.name} (${e.currencies.join("/")})`)
    .join(" · ");
}

/** Format upcoming events (next 24h) for the summary embed. */
export function formatUpcomingEvents(blackout: NewsBlackoutResult): string | null {
  if (blackout.upcoming.length === 0) return null;
  return blackout.upcoming
    .map((e) => {
      const hoursUntil = (e.startTime.getTime() - Date.now()) / (60 * 60 * 1000);
      const h = Math.round(hoursUntil);
      return `${e.name} (${e.currencies.join("/")}) in ${h}h`;
    })
    .join(" · ");
}
