// /home/z/my-project/src/lib/scanner/data-csv.ts
// CSV-backed data adapter — reads user-provided OHLC history from /home/z/my-project/data/csv/
// Falls back to Yahoo Finance when CSV is missing for a given symbol/timeframe.

import { promises as fs } from "fs";
import path from "path";
import type { Candle } from "./data";
import type { Timeframe } from "./instruments";

// User's CSV symbols use compact names (EURUSD, XAUUSD, BTCUSD, US500, US30, USTEC, JP225, CA60)
// Yahoo uses suffixes (=X, -USD, ^GSPC, ^DJI, ^NDX, ^N225)
// Build a mapping from user symbols to instrument universe.

const CSV_DIR = process.env.SCANNER_CSV_DIR || path.join(process.cwd(), "data", "csv");

// User symbol → Yahoo symbol (for instruments not directly present in CSVs)
// For pairs/index symbols that exist in CSV, we use CSV directly.
const CSV_SYMBOL_ALIASES: Record<string, string> = {
  // Forex majors/crosses (already in user's CSV format)
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USDCHF: "USDCHF",
  AUDUSD: "AUDUSD",
  USDCAD: "USDCAD",
  NZDUSD: "NZDUSD",
  EURGBP: "EURGBP",
  EURJPY: "EURJPY",
  GBPJPY: "GBPJPY",
  GBPCHF: "GBPCHF",
  AUDJPY: "AUDJPY",
  AUDCHF: "AUDCHF",
  AUDNZD: "AUDNZD",
  AUDCAD: "AUDCAD",
  EURAUD: "EURAUD",
  EURCAD: "EURCAD",
  EURCHF: "EURCHF",
  GBPCAD: "GBPCAD",
  CADJPY: "CADJPY",
  CHFJPY: "CHFJPY",
  NZDJPY: "NZDJPY",
  NZDCAD: "NZDCAD",
  // Commodities
  XAUUSD: "XAUUSD", // Gold
  // Crypto
  BTCUSD: "BTCUSD",
  ETHUSD: "ETHUSD",
  // Indices (user's naming)
  US30: "US30",       // Dow Jones
  US500: "US500",     // S&P 500
  USTEC: "USTEC",     // Nasdaq 100
  JP225: "JP225",     // Nikkei 225
  CA60: "CA60",       // TSX 60
};

// Timeframe → user's filename suffix variants (we try both lowercase _1h and uppercase _H1)
const TF_TO_SUFFIXES: Record<Timeframe, string[]> = {
  "1h": ["_1h.csv", "_H1.csv"],
  "2h": ["_2h.csv", "_H2.csv"],
  "4h": ["_4h.csv", "_H4.csv"],
  "1d": ["_1d.csv", "_D1.csv"],
  "1w": ["_1w.csv", "_W1.csv"],
};

// In-memory cache: key = `csvSymbol:tf`
const cache = new Map<string, { ts: number; data: Candle[] }>();
const CACHE_TTL = 60 * 60 * 1000; // 60 min — data is historical, doesn't change

function parseCsvLine(line: string): (string | number)[] | null {
  const parts = line.split(",");
  if (parts.length < 6) return null;
  return parts.map((p) => {
    const trimmed = p.trim();
    const num = Number(trimmed);
    return isNaN(num) ? trimmed : num;
  });
}

function parseCsvDatetime(s: string): number {
  // Handle formats: "2011-08-01 00:00:00+00:00" or "2010-08-02 00:00"
  // Try ISO first
  let t = Date.parse(s);
  if (!isNaN(t)) return Math.floor(t / 1000);
  // Fallback: replace space with T and add Z if no zone
  let normalized = s.replace(" ", "T");
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) normalized += "Z";
  t = Date.parse(normalized);
  return isNaN(t) ? 0 : Math.floor(t / 1000);
}

export async function readCsvCandles(
  csvSymbol: string,
  tf: Timeframe
): Promise<Candle[]> {
  const cacheKey = `${csvSymbol}:${tf}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  // Try each suffix variant
  for (const suffix of TF_TO_SUFFIXES[tf]) {
    const filePath = path.join(CSV_DIR, `${csvSymbol}${suffix}`);
    try {
      const stat = await fs.stat(/*turbopackIgnore: true*/ filePath);
      if (!stat.isFile() || stat.size === 0) continue;
      const raw = await fs.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
      const lines = raw.trim().split("\n");
      if (lines.length === 0) continue;

      // Detect header — if first row contains non-numeric Open, it's a header
      let startIndex = 0;
      let hasHeader = false;
      const firstParts = parseCsvLine(lines[0]);
      if (firstParts && typeof firstParts[1] === "string") {
        hasHeader = true;
        startIndex = 1;
      }

      const candles: Candle[] = [];
      for (let i = startIndex; i < lines.length; i++) {
        const parts = parseCsvLine(lines[i]);
        if (!parts) continue;
        const [dateStr, open, high, low, close, volume] = parts as [string, number, number, number, number, number];
        if (typeof dateStr !== "string") continue;
        const time = parseCsvDatetime(dateStr);
        if (time === 0) continue;
        candles.push({
          time,
          date: new Date(time * 1000),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume) || 0,
        });
      }
      candles.sort((a, b) => a.time - b.time);
      cache.set(cacheKey, { ts: Date.now(), data: candles });
      return candles;
    } catch {
      // File doesn't exist with this suffix, try next
      continue;
    }
  }
  return [];
}

export function csvSymbolFor(yahooSymbol: string): string | null {
  // Try direct alias
  const direct = Object.entries(CSV_SYMBOL_ALIASES).find(([_, v]) => v === yahooSymbol);
  if (direct) return direct[0];
  // Normalize Yahoo symbols to user format
  // EURUSD=X -> EURUSD
  if (yahooSymbol.endsWith("=X")) return yahooSymbol.replace("=X", "");
  // BTC-USD -> BTCUSD
  if (yahooSymbol.endsWith("-USD")) return yahooSymbol.replace("-", "");
  // ^GSPC -> US500 (Yahoo S&P 500)
  if (yahooSymbol === "^GSPC") return "US500";
  if (yahooSymbol === "^DJI") return "US30";
  if (yahooSymbol === "^NDX") return "USTEC";
  if (yahooSymbol === "^N225") return "JP225";
  return null;
}

export async function hasCsvData(yahooSymbol: string, tf: Timeframe): Promise<boolean> {
  const csvSymbol = csvSymbolFor(yahooSymbol);
  if (!csvSymbol) return false;
  const data = await readCsvCandles(csvSymbol, tf);
  return data.length > 0;
}

// List all CSV files available (for UI display)
export async function listCsvFiles(): Promise<{ symbol: string; tf: string; bars: number; start: string; end: string; sizeBytes: number }[]> {
  const out: any[] = [];
  try {
    const files = await fs.readdir(/*turbopackIgnore: true*/ CSV_DIR);
    for (const file of files) {
      if (!file.endsWith(".csv")) continue;
      const match = file.match(/^(.+)_(\w+)\.csv$/);
      if (!match) continue;
      const [, symbol, tfRaw] = match;
      const tfLower = tfRaw.toLowerCase();
      const tfMap: Record<string, Timeframe> = { h1: "1h", h2: "2h", h4: "4h", d1: "1d", w1: "1w" };
      const tf = tfMap[tfLower] || tfLower;
      const filePath = path.join(CSV_DIR, file);
      const stat = await fs.stat(/*turbopackIgnore: true*/ filePath);
      const candles = await readCsvCandles(symbol, tf as Timeframe);
      if (candles.length === 0) continue;
      out.push({
        symbol,
        tf,
        bars: candles.length,
        start: candles[0].date.toISOString().slice(0, 10),
        end: candles[candles.length - 1].date.toISOString().slice(0, 10),
        sizeBytes: stat.size,
      });
    }
  } catch (err) {
    console.error("[data-csv] listCsvFiles error:", err);
  }
  return out;
}
