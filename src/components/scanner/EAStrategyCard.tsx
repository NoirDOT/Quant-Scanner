"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Activity, Award, FileCode2, TrendingUp, TrendingDown, Target, ShieldAlert } from "lucide-react";

export interface EACatalogEntry {
  id: string;
  fileName: string;
  name: string;
  category: string;
  description: string;
  targetSymbol: string;
  targetTimeframe: string;
  multiPair?: string[];
  strategyRules: string[];
  backtestStats?: {
    sharpe?: number;
    profitFactor?: number;
    maxDrawdown?: number;
    winRate?: number;
    trades?: number;
    netPnl?: number;
    period?: string;
  };
  risk: {
    slRule: string;
    tpRule: string;
  };
  sourceFile: string;
  sourcePreview?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  ict: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  trend: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "mean-reversion": "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  momentum: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  range: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  breakout: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  seasonal: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
  divergence: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  "time-based": "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
};

export function EAStrategyCard({ ea }: { ea: EACatalogEntry }) {
  const catColor = CATEGORY_COLORS[ea.category] || "bg-muted text-muted-foreground";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start justify-between text-base gap-2">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 shrink-0" />
              <span className="font-medium leading-tight">{ea.name}</span>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              <Badge className={catColor}>{ea.category}</Badge>
              <Badge variant="outline">{ea.targetSymbol}</Badge>
              <Badge variant="outline">{ea.targetTimeframe}</Badge>
              {ea.multiPair && ea.multiPair.length > 1 && (
                <Badge variant="outline">+{ea.multiPair.length - 1} pairs</Badge>
              )}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs leading-relaxed">{ea.description}</p>

        {ea.backtestStats && (
          <div className="rounded-md border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-2">
              <Award className="h-3 w-3" />
              EA Backtest Stats {ea.backtestStats.period ? `(${ea.backtestStats.period})` : ""}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {typeof ea.backtestStats.sharpe === "number" && (
                <Stat label="Sharpe" value={ea.backtestStats.sharpe.toFixed(2)} />
              )}
              {typeof ea.backtestStats.profitFactor === "number" && ea.backtestStats.profitFactor > 0 && (
                <Stat label="Profit Factor" value={ea.backtestStats.profitFactor.toFixed(2)} tone={ea.backtestStats.profitFactor >= 1.5 ? "pos" : "neutral"} />
              )}
              {typeof ea.backtestStats.maxDrawdown === "number" && ea.backtestStats.maxDrawdown > 0 && (
                <Stat label="Max DD" value={`-${ea.backtestStats.maxDrawdown.toFixed(2)}%`} tone="neg" />
              )}
              {typeof ea.backtestStats.winRate === "number" && ea.backtestStats.winRate > 0 && (
                <Stat label="Win Rate" value={`${ea.backtestStats.winRate.toFixed(1)}%`} tone={ea.backtestStats.winRate >= 50 ? "pos" : "neutral"} />
              )}
              {typeof ea.backtestStats.trades === "number" && ea.backtestStats.trades > 0 && (
                <Stat label="Trades" value={String(ea.backtestStats.trades)} />
              )}
              {typeof ea.backtestStats.netPnl === "number" && ea.backtestStats.netPnl > 0 && (
                <Stat label="Net P/L" value={`+$${ea.backtestStats.netPnl.toLocaleString()}`} tone="pos" />
              )}
            </div>
          </div>
        )}

        <Accordion type="single" collapsible>
          <AccordionItem value="rules">
            <AccordionTrigger className="text-xs">Strategy rules</AccordionTrigger>
            <AccordionContent>
              <ol className="list-decimal pl-4 space-y-1 text-xs">
                {ea.strategyRules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
              <div className="mt-3 space-y-1 text-xs">
                <div className="text-muted-foreground flex items-start gap-1">
                  <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                  <span><strong>SL:</strong> {ea.risk.slRule}</span>
                </div>
                <div className="text-muted-foreground flex items-start gap-1">
                  <Target className="h-3 w-3 mt-0.5 shrink-0" />
                  <span><strong>TP:</strong> {ea.risk.tpRule}</span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="source">
            <AccordionTrigger className="text-xs">MQL5 source preview</AccordionTrigger>
            <AccordionContent>
              <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 p-2 rounded max-h-60 overflow-y-auto leading-tight">
                {ea.sourcePreview || "// Source preview not available"}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`font-mono tabular-nums ${
          tone === "pos" ? "text-emerald-600 dark:text-emerald-400" : tone === "neg" ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
