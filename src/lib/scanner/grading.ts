// Universal A+/A/B+/B-/C grading for ALL scanner families.
//
// Grading factors (each 0 to its max, total 0-100):
//   1. Confluence count     (0-25): how many INDEPENDENT conditions fired
//      (reasons deduped by leading phrase so padding more strings doesn't help)
//   2. Killzone alignment   (0-25): London/NY/Silver Bullet alignment at the
//      signal's BAR CLOSE time, not the wall-clock scan time. A 4h bar closing
//      at 12:00 UTC always scores 25 regardless of when the cron sweep runs.
//   3. Reward:Risk          (0-20): R:R of entry/stop/target
//   4. Catalog edge         (0-15): read live from BacktestByGrade table;
//      falls back to family defaults only when no backtest data exists.
//   5. Freshness            (0-15): how recent the signal is (decays over 24h)
//
// Grade mapping:
//   A+ : 90-100   A : 75-89   B+ : 60-74   B- : 40-59   C : 0-39

import type { ScanSignal, Grade, GradeFactors } from "./types";

// ---------------------------------------------------------------------------
// Killzone helper (lightweight — full module is in ict/killzones.ts)
// ---------------------------------------------------------------------------

/**
 * Returns 0-25 based on the hour (UTC) alignment with ICT killzones.
 *   - London killzone (07:00-10:00 UTC): 25
 *   - NY killzone (12:00-15:00 UTC): 25
 *   - Silver Bullet (10:00-12:00 UTC): 22
 *   - Asia killzone (00:00-06:00 UTC): 12
 *   - Outside any killzone: 5
 */
export function killzoneAlignmentScore(now: Date = new Date()): number {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (h >= 7 && h < 10) return 25;      // London
  if (h >= 12 && h < 15) return 25;     // NY
  if (h >= 10 && h < 12) return 22;     // Silver Bullet
  if (h >= 0 && h < 6) return 12;       // Asia
  return 5;
}

/**
 * Killzone score for a specific SIGNAL — uses the bar close time, not the
 * wall-clock scan time. Falls back to generatedAt, then to current time.
 *
 * Pass barCloseMs = (bar open time + bar duration) × 1000 to score at the
 * bar's close (the moment a closed-candle strategy would have detected it).
 */
export function killzoneScoreForSignal(signal: ScanSignal, barCloseMs?: number): number {
  // 1. Explicit bar close time (preferred — set by runScan from candle.time + duration)
  if (barCloseMs != null && Number.isFinite(barCloseMs)) {
    return killzoneAlignmentScore(new Date(barCloseMs));
  }
  if (signal.metadata?.barCloseMs != null && Number.isFinite(signal.metadata.barCloseMs)) {
    return killzoneAlignmentScore(new Date(signal.metadata.barCloseMs));
  }
  // 2. generatedAt — when the scan ran (good proxy for daily/weekly bars)
  if (signal.generatedAt) {
    const d = new Date(signal.generatedAt);
    if (!isNaN(d.getTime())) return killzoneAlignmentScore(d);
  }
  // 3. Last resort: wall-clock (legacy behavior)
  return killzoneAlignmentScore();
}

// ---------------------------------------------------------------------------
// Reward:Risk score (0-20)
// ---------------------------------------------------------------------------

export function rrScore(signal: ScanSignal): number {
  if (!signal.entryPrice || !signal.stopPrice || !signal.targetPrice) return 0;
  const risk = Math.abs(signal.entryPrice - signal.stopPrice);
  const reward = Math.abs(signal.targetPrice - signal.entryPrice);
  if (risk <= 0) return 0;
  const rr = reward / risk;
  if (rr >= 5) return 20;
  if (rr >= 3) return 18;
  if (rr >= 2) return 14;
  if (rr >= 1.5) return 10;
  if (rr >= 1) return 6;
  return 2;
}

// ---------------------------------------------------------------------------
// Catalog edge score (0-15) — reads live from BacktestByGrade when available
// ---------------------------------------------------------------------------

export interface CatalogStats {
  winRate?: number;
  profitFactor?: number;
}

/**
 * Uses signal.metadata.catalogStats if available (winRate, profitFactor).
 * Falls back to strategy-type defaults only when no catalog stats present.
 *
 * runScan() pre-loads BacktestByGrade rows and attaches catalogStats to each
 * signal's metadata before grading, so this stays sync.
 */
export function catalogScore(signal: ScanSignal): number {
  const stats: CatalogStats | undefined = signal.metadata?.catalogStats ?? signal.metadata?.backtestStats;
  if (stats) {
    const wr = stats.winRate ?? 50;
    const pf = stats.profitFactor ?? 1;
    // 60% WR + 1.5 PF = 12 points; 70%+ WR + 2+ PF = 15 points
    const wrScore = Math.min(8, Math.max(0, (wr - 40) / 5));
    const pfScore = Math.min(7, Math.max(0, (pf - 1) * 5));
    return Math.round(wrScore + pfScore);
  }
  // Family defaults — used only when no BacktestByGrade data exists yet
  switch (signal.strategyType) {
    case "horc": return 10;
    case "ict": return 8;
    case "trend": return 6;
    case "ea": return 12;
    case "trader": return 7;
    default: return 5;
  }
}

// ---------------------------------------------------------------------------
// Freshness score (0-15) — decays over 24h
// ---------------------------------------------------------------------------

export function freshnessScore(generatedAt?: string): number {
  if (!generatedAt) return 8;
  const ts = new Date(generatedAt).getTime();
  if (isNaN(ts)) return 8;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  if (ageHours < 0) return 15;
  if (ageHours < 1) return 15;
  if (ageHours < 3) return 13;
  if (ageHours < 6) return 11;
  if (ageHours < 12) return 8;
  if (ageHours < 24) return 5;
  return 2;
}

// ---------------------------------------------------------------------------
// Confluence score (0-25) — dedupes reasons by leading phrase
// ---------------------------------------------------------------------------

/**
 * Count confluences from signal.reasons. Reasons are deduped by their leading
 * 4-word phrase (lowercased) so strategies that append many similar strings
 * don't artificially inflate the score. Cap at 5 confluences × 5 points = 25.
 *
 * For HORC signals (which already include a confluenceCount in metadata),
 * use that directly.
 */
export function confluenceScore(signal: ScanSignal): number {
  if (signal.metadata?.horcConfluenceCount !== undefined) {
    return Math.min(25, signal.metadata.horcConfluenceCount * 6);
  }
  const reasons = signal.reasons ?? [];
  const seen = new Set<string>();
  let count = 0;
  for (const r of reasons) {
    const key = r.toLowerCase().split(/\s+/).slice(0, 4).join(" ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    count++;
  }
  return Math.min(25, count * 5);
}

// ---------------------------------------------------------------------------
// Compute grade factors + final score + letter grade
// ---------------------------------------------------------------------------

export function computeGradeFactors(signal: ScanSignal, barCloseMs?: number): GradeFactors {
  const cs = confluenceScore(signal);
  const ks = killzoneScoreForSignal(signal, barCloseMs);
  const rs = rrScore(signal);
  const cat = catalogScore(signal);
  const fs = freshnessScore(signal.generatedAt);
  const rawScore = signal.score;

  // Weighted blend: 60% raw signal score (mapped to 0-100), 40% grade factors
  const factorSum = cs + ks + rs + cat + fs;  // 0-100
  const blended = Math.round(rawScore * 0.6 + factorSum * 0.4);

  return {
    rawScore: blended,
    confluenceScore: cs,
    killzoneScore: ks,
    rrScore: rs,
    catalogScore: cat,
    freshnessScore: fs,
  };
}

export function gradeFromScore(score: number): Grade {
  if (score >= 90) return "A+";
  if (score >= 75) return "A";
  if (score >= 60) return "B+";
  if (score >= 40) return "B-";
  return "C";
}

export function computeGrade(signal: ScanSignal, barCloseMs?: number): { grade: Grade; factors: GradeFactors; finalScore: number } {
  const factors = computeGradeFactors(signal, barCloseMs);
  const finalScore = factors.rawScore;
  const grade = gradeFromScore(finalScore);
  return { grade, factors, finalScore };
}

// applyGrade — mutates a signal in place (or returns a new one).
// Pass barCloseMs (the bar's close time in ms) for time-aware killzone scoring.
export function applyGrade(signal: ScanSignal, barCloseMs?: number): ScanSignal {
  const { grade, factors, finalScore } = computeGrade(signal, barCloseMs);
  signal.grade = grade;
  signal.gradeFactors = factors;
  signal.score = finalScore;
  return signal;
}

export function applyGradeAll(signals: ScanSignal[], barCloseMsFor?: (s: ScanSignal) => number | undefined): ScanSignal[] {
  return signals.map((s) => applyGrade(s, barCloseMsFor?.(s)));
}

// ---------------------------------------------------------------------------
// Grade color (for UI badges)
// ---------------------------------------------------------------------------

export const GRADE_COLORS: Record<NonNullable<Grade>, string> = {
  "A+": "emerald",
  "A": "green",
  "B+": "blue",
  "B-": "amber",
  "C": "zinc",
};

export const GRADE_EMOJI: Record<NonNullable<Grade>, string> = {
  "A+": "🟢🟢",
  "A": "🟢",
  "B+": "🔵",
  "B-": "🟠",
  "C": "⚪",
};

// ---------------------------------------------------------------------------
// Grade distribution helper (for BOT Dashboard)
// ---------------------------------------------------------------------------

export interface GradeDistribution {
  "A+": number;
  "A": number;
  "B+": number;
  "B-": number;
  "C": number;
  total: number;
  avgScore: number;
}

export function computeGradeDistribution(signals: ScanSignal[]): GradeDistribution {
  const dist: GradeDistribution = { "A+": 0, "A": 0, "B+": 0, "B-": 0, "C": 0, total: 0, avgScore: 0 };
  let sum = 0;
  for (const s of signals) {
    if (!s.grade) continue;
    dist[s.grade]++;
    dist.total++;
    sum += s.score;
  }
  dist.avgScore = dist.total > 0 ? Math.round(sum / dist.total) : 0;
  return dist;
}
