"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

export interface ScanSignalRow {
  strategyKey: string;
  strategyType: "trend" | "ict" | "trader";
  strategyLabel: string;
  symbol: string;
  display: string;
  assetClass: string;
  timeframe: string;
  direction: "long" | "short" | "neutral";
  score: number;
  reasons: string[];
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  metadata?: Record<string, any>;
}

export function ScanResultsTable({ rows }: { rows: ScanSignalRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No signals match your filters. Try lowering the minimum score or expanding instruments.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="max-h-[700px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">Strategy</th>
              <th className="px-3 py-2 text-left font-medium">Symbol</th>
              <th className="px-3 py-2 text-left font-medium">TF</th>
              <th className="px-3 py-2 text-left font-medium">Dir</th>
              <th className="px-3 py-2 text-left font-medium">Score</th>
              <th className="px-3 py-2 text-right font-medium">Entry</th>
              <th className="px-3 py-2 text-right font-medium">Stop</th>
              <th className="px-3 py-2 text-right font-medium">Target</th>
              <th className="px-3 py-2 text-left font-medium">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.strategyKey}-${r.symbol}-${i}`}
                className="border-b last:border-0 hover:bg-muted/40"
              >
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{r.strategyLabel}</span>
                    <Badge variant="outline" className="text-[10px] w-fit">
                      {r.strategyType}
                    </Badge>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.display}</span>
                    <span className="text-xs text-muted-foreground">{r.symbol}</span>
                  </div>
                </td>
                <td className="px-3 py-2 uppercase text-xs">{r.timeframe}</td>
                <td className="px-3 py-2">
                  {r.direction === "long" ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      <TrendingUp className="h-3 w-3 mr-1" /> Long
                    </Badge>
                  ) : r.direction === "short" ? (
                    <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                      <TrendingDown className="h-3 w-3 mr-1" /> Short
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Minus className="h-3 w-3 mr-1" /> Wait
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${
                          r.score >= 75 ? "bg-emerald-500" : r.score >= 60 ? "bg-amber-500" : "bg-muted-foreground"
                        }`}
                        style={{ width: `${r.score}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs tabular-nums">{r.score.toFixed(0)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {r.entryPrice ? fmt(r.entryPrice) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-rose-600 dark:text-rose-400">
                  {r.stopPrice ? fmt(r.stopPrice) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">
                  {r.targetPrice ? fmt(r.targetPrice) : "—"}
                </td>
                <td className="px-3 py-2">
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {r.reasons.slice(0, 3).map((reason, j) => (
                      <li key={j} className="leading-tight">
                        • {reason}
                      </li>
                    ))}
                    {r.reasons.length > 3 && (
                      <li className="text-[10px] italic">
                        +{r.reasons.length - 3} more
                      </li>
                    )}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(v: number): string {
  if (v >= 1000) return v.toFixed(0);
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(5);
}
