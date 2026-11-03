"use client";

// src/components/scanner/BotDashboard.tsx
// BOT Dashboard — universal grading + per-strategy performance + grade distribution.
//
//   - Shows grade distribution columns (A+/A/B+/B-/C count per scanner)
//   - Top performers / failing scanners sections
//   - "Backtest ALL N scanners" button → calls /api/scanner/backtest-all

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Activity, TrendingUp, TrendingDown, Trophy, AlertTriangle } from "lucide-react";

interface BacktestRow {
  strategyKey: string;
  family: string;
  label: string;
  aggregate: {
    avgWinRate: number;
    avgProfitFactor: number;
    avgMaxDrawdown: number;
    totalTrades: number;
    gradeDistribution: {
      "A+": number;
      "A": number;
      "B+": number;
      "B-": number;
      "C": number;
      total: number;
      avgScore: number;
    };
  };
}

const FAMILY_COLORS: Record<string, string> = {
  trend: "blue",
  ict: "purple",
  trader: "amber",
  ea: "emerald",
  horc: "rose",
};

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  "A": "bg-green-500/20 text-green-300 border-green-500/30",
  "B+": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "B-": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "C": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
};

export function BotDashboard() {
  const [data, setData] = useState<BacktestRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scanner/backtest-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruments: [
            { symbol: "EURUSD", display: "EUR/USD", assetClass: "forex" },
            { symbol: "GBPUSD", display: "GBP/USD", assetClass: "forex" },
            { symbol: "USDJPY", display: "USD/JPY", assetClass: "forex" },
            { symbol: "XAUUSD", display: "Gold", assetClass: "commodity" },
            { symbol: "BTCUSD", display: "BTC/USD", assetClass: "crypto" },
            { symbol: "US500", display: "S&P 500", assetClass: "index" },
          ],
          timeframes: ["1h", "4h", "1d"],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Auto-run on mount
  useEffect(() => {
    runBacktest();
  }, []);

  const topPerformers = data
    ? [...data].sort((a, b) => b.aggregate.avgWinRate - a.aggregate.avgWinRate).slice(0, 5)
    : [];
  const failingScanners = data
    ? [...data].filter((r) => r.aggregate.avgWinRate < 40).slice(0, 5)
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            BOT Dashboard — Universal Grading
          </CardTitle>
          <Button onClick={runBacktest} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Running..." : "Backtest ALL scanners"}
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="text-sm text-red-400 mb-3">Error: {error}</div>
          )}
          {loading && !data && (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">Strategy</th>
                    <th className="p-2">Family</th>
                    <th className="p-2 text-right">Win%</th>
                    <th className="p-2 text-right">PF</th>
                    <th className="p-2 text-right">MaxDD</th>
                    <th className="p-2 text-right">Trades</th>
                    <th className="p-2 text-center">A+</th>
                    <th className="p-2 text-center">A</th>
                    <th className="p-2 text-center">B+</th>
                    <th className="p-2 text-center">B-</th>
                    <th className="p-2 text-center">C</th>
                    <th className="p-2 text-right">Avg Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.strategyKey} className="border-b">
                      <td className="p-2 font-medium">{row.label}</td>
                      <td className="p-2">
                        <Badge variant="outline" className={FAMILY_COLORS[row.family] ?? ""}>
                          {row.family}
                        </Badge>
                      </td>
                      <td className="p-2 text-right">{row.aggregate.avgWinRate.toFixed(1)}%</td>
                      <td className="p-2 text-right">{row.aggregate.avgProfitFactor.toFixed(2)}</td>
                      <td className="p-2 text-right">{row.aggregate.avgMaxDrawdown.toFixed(1)}%</td>
                      <td className="p-2 text-right">{row.aggregate.totalTrades}</td>
                      <td className={`p-2 text-center ${GRADE_COLORS["A+"]}`}>
                        {row.aggregate.gradeDistribution["A+"]}
                      </td>
                      <td className={`p-2 text-center ${GRADE_COLORS["A"]}`}>
                        {row.aggregate.gradeDistribution["A"]}
                      </td>
                      <td className={`p-2 text-center ${GRADE_COLORS["B+"]}`}>
                        {row.aggregate.gradeDistribution["B+"]}
                      </td>
                      <td className={`p-2 text-center ${GRADE_COLORS["B-"]}`}>
                        {row.aggregate.gradeDistribution["B-"]}
                      </td>
                      <td className={`p-2 text-center ${GRADE_COLORS["C"]}`}>
                        {row.aggregate.gradeDistribution["C"]}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {row.aggregate.gradeDistribution.avgScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4 text-emerald-400" />
                Top Performers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topPerformers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {topPerformers.map((r, i) => (
                    <li key={r.strategyKey} className="flex items-center justify-between">
                      <span>
                        <span className="text-muted-foreground mr-2">#{i + 1}</span>
                        {r.label}
                      </span>
                      <Badge variant="outline" className="text-emerald-300 border-emerald-500/30">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        {r.aggregate.avgWinRate.toFixed(1)}%
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Failing Scanners (&lt;40% WR)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {failingScanners.length === 0 ? (
                <p className="text-sm text-emerald-300">None — all scanners above 40% WR.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {failingScanners.map((r, i) => (
                    <li key={r.strategyKey} className="flex items-center justify-between">
                      <span>
                        <span className="text-muted-foreground mr-2">#{i + 1}</span>
                        {r.label}
                      </span>
                      <Badge variant="outline" className="text-amber-300 border-amber-500/30">
                        <TrendingDown className="h-3 w-3 mr-1" />
                        {r.aggregate.avgWinRate.toFixed(1)}%
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
