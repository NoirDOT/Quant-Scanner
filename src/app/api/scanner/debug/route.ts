// GET /api/scanner/debug — diagnose Yahoo Finance connectivity from the Vercel runtime.
// Shows the RAW error yahoo-finance2 throws (instead of swallowing it).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const results: Record<string, any> = {};

  // Test 1: raw fetch to Yahoo chart API (bypasses yahoo-finance2 lib)
  const t0 = Date.now();
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1h&range=5d",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "application/json",
        },
      }
    );
    const body = await res.text();
    results.rawFetch = {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      bodyStart: body.slice(0, 200),
    };
  } catch (e) {
    results.rawFetch = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }

  // Test 2: raw fetch to query2
  const t1 = Date.now();
  try {
    const res = await fetch(
      "https://query2.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1h&range=5d",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
      }
    );
    const body = await res.text();
    results.rawFetchQuery2 = {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t1,
      bodyStart: body.slice(0, 200),
    };
  } catch (e) {
    results.rawFetchQuery2 = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - t1 };
  }

  // Test 3: yahoo-finance2 library (what the scanner actually uses)
  const t2 = Date.now();
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const result = await YahooFinance.chart("EURUSD=X", {
      period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      interval: "1h",
    });
    const quotes = (result as any).quotes ?? [];
    results.libraryChart = {
      ok: true,
      ms: Date.now() - t2,
      quoteCount: quotes.length,
      lastClose: quotes[quotes.length - 1]?.close ?? null,
    };
  } catch (e: any) {
    results.libraryChart = {
      ok: false,
      ms: Date.now() - t2,
      name: e?.name,
      message: e?.message?.slice(0, 300),
      code: e?.code,
    };
  }

  // Test 4: yahoo-finance2 quote (live price)
  const t3 = Date.now();
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const q = await YahooFinance.quote("EURUSD=X");
    results.libraryQuote = {
      ok: true,
      ms: Date.now() - t3,
      price: (q as any).regularMarketPrice ?? null,
    };
  } catch (e: any) {
    results.libraryQuote = {
      ok: false,
      ms: Date.now() - t3,
      name: e?.name,
      message: e?.message?.slice(0, 300),
      code: e?.code,
    };
  }

  // Test 5: Stooq fallback candidate (free, no key)
  const t4 = Date.now();
  try {
    const res = await fetch("https://stooq.com/q/d/l/?s=eurusd&i=d", {
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    results.stooqDaily = {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t4,
      bodyStart: body.slice(0, 150),
    };
  } catch (e) {
    results.stooqDaily = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - t4 };
  }

  return NextResponse.json({
    runtime: "vercel",
    region: process.env.VERCEL_REGION ?? "unknown",
    timestamp: new Date().toISOString(),
    tests: results,
  });
}
