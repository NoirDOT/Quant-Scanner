// /home/z/my-project/build/hubb-final/HUBB/src/lib/scanner/grading.ts
// Universal A+/A/B+/B-/C grading for ALL scanner families.
//
// Reconstructed from the chat history in Untitled.txt:
//   - computeGrade() takes a signal + ctx + catalog stats → returns 5-factor
//     weighted score → maps to grade letter.
//   - applyGrade() is called on every signal in runGradedScan() +
//     backtestScannerAll().
//   - /api/scanner/route.ts POST handler applies applyGrade() to all signals
//     before returning, persists grade to DB.
//   - ScanResultsTable renders a Grade column with color-coded badges:
//       A+ = emerald, A = green, B+ = blue, B- = amber, C = zinc.
//   - BotDashboard shows grade distribution columns (A+/A/B+/B-/C count per scanner).
//   - Discord bot embed formatter shows "🟢🟢 A+ (95/100)" badges.
//
// Grading factors (each 0 to its max, total 0-100):
//   1. Confluence count     (0-25): how many independent conditions fired
//   2. Killzone alignment   (0-25): London/NY/Silver Bullet alignment
//   3. Reward:Risk          (0-20): R:R of entry/stop/target
//   4. Catalog edge         (0-15): backtested historical win-rate / PF of strategy
//   5. Freshness            (0-15): how recent the signal is (decays over 24h)
//
// Grade mapping:
//   A+ : 90-100 (all 5 factors strong, 4+ confluences, killzone aligned, R:R >= 3)
//   A  : 75-89
//   B+ : 60-74
//   B- : 40-59
//   C  : 0-39

import type { ScanSignal, Grade, GradeFactors, StrategyContext } from "./types";
import type { Timeframe } from "./instruments";

// ---------------------------------------------------------------------------
// Killzone helper (lightweight — full module is in ict/killzones.ts)
// ---------------------------------------------------------------------------

function getCurrentUtcHour(): number {
  return new Date().getUTCHours();
}

/**
 * Returns 0-25 based on current UTC hour alignment with ICT killzones.
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
// Catalog edge score (0-15)
// ---------------------------------------------------------------------------

/**
 * Uses signal.metadata.catalogStats if available (winRate, profitFactor).
 * Falls back to strategy-type defaults if no catalog stats.
 */
export function catalogScore(signal: ScanSignal): number {
  const stats = signal.metadata?.catalogStats ?? signal.metadata?.backtestStats;
  if (stats) {
    const wr = stats.winRate ?? 50;
    const pf = stats.profitFactor ?? 1;
    // 60% WR + 1.5 PF = 12 points; 70%+ WR + 2+ PF = 15 points
    const wrScore = Math.min(8, Math.max(0, (wr - 40) / 5));
    const pfScore = Math.min(7, Math.max(0, (pf - 1) * 5));
    return Math.round(wrScore + pfScore);
  }
  // Strategy-type defaults (HORC gets a small edge because of the structural framework)
  switch (signal.strategyType) {
    case "horc": return 10;  // new framework — assumed decent until backtested
    case "ict": return 8;
    case "trend": return 6;
    case "ea": return 12;  // EAs have backtest stats usually
    case "trader": return 7;
    default: return 5;
  }
}

// ---------------------------------------------------------------------------
// Freshness score (0-15) — decays over 24h
// ---------------------------------------------------------------------------

export function freshnessScore(generatedAt?: string): number {
  if (!generatedAt) return 8;  // unknown age → middle score
  const ts = new Date(generatedAt).getTime();
  if (isNaN(ts)) return 8;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  if (ageHours < 0) return 15;  // future timestamp = max (clock skew)
  if (ageHours < 1) return 15;
  if (ageHours < 3) return 13;
  if (ageHours < 6) return 11;
  if (ageHours < 12) return 8;
  if (ageHours < 24) return 5;
  return 2;
}

// ---------------------------------------------------------------------------
// Confluence score (0-25)
// ---------------------------------------------------------------------------

/**
 * Count confluences from signal.reasons. Each reason represents one
 * independent condition that fired. Cap at 5 confluences × 5 points = 25.
 *
 * For HORC signals (which already include a confluenceCount in metadata),
 * use that directly.
 */
export function confluenceScore(signal: ScanSignal): number {
  if (signal.metadata?.horcConfluenceCount !== undefined) {
    return Math.min(25, signal.metadata.horcConfluenceCount * 6);
  }
  const count = signal.reasons?.length ?? 0;
  return Math.min(25, count * 5);
}

// ---------------------------------------------------------------------------
// Compute grade factors + final score + letter grade
// ---------------------------------------------------------------------------

export function computeGradeFactors(signal: ScanSignal): GradeFactors {
  const cs = confluenceScore(signal);
  const ks = killzoneAlignmentScore();
  const rs = rrScore(signal);
  const cat = catalogScore(signal);
  const fs = freshnessScore(signal.generatedAt);
  const rawScore = signal.score;  // raw score from the scanner (before grading)

  // Weighted blend: 60% raw signal score (mapped to 0-100), 40% grade factors
  // This way the grade LETTER reflects both the scanner's own score AND the
  // universal quality factors.
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

export function computeGrade(signal: ScanSignal): { grade: Grade; factors: GradeFactors; finalScore: number } {
  const factors = computeGradeFactors(signal);
  const finalScore = factors.rawScore;
  const grade = gradeFromScore(finalScore);
  return { grade, factors, finalScore };
}

// ---------------------------------------------------------------------------
// applyGrade — mutates a signal in place (or returns a new one)
// ---------------------------------------------------------------------------

export function applyGrade(signal: ScanSignal): ScanSignal {
  const { grade, factors, finalScore } = computeGrade(signal);
  signal.grade = grade;
  signal.gradeFactors = factors;
  signal.score = finalScore;
  return signal;
}

export function applyGradeAll(signals: ScanSignal[]): ScanSignal[] {
  return signals.map(applyGrade);
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
