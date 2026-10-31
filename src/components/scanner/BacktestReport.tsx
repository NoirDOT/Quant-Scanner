"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, BarChart3, Activity, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface BacktestSummary {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  avgRR: number;
  netReturn: number;
  avgBarsHeld: number;
  equityCurve: { time: number; equity: number }[];
  strategyKey: string;
  symbol: string;
  timeframe: string;
  start: string;
  end: string;
}

export function BacktestReport({ summary }: { summary: BacktestSummary }) {
  const equityData = summary.equityCurve.map((e) => ({
    time: new Date(e.time * 1000).toLocaleDateString(),
    equity: Math.round(e.equity * 100) / 100,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            {summary.strategyKey} · {summary.symbol} · {summary.timeframe}
          </div>
          <Badge variant={summary.netReturn >= 0 ? "default" : "destructive"}>
            {summary.netReturn >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
            {summary.netReturn.toFixed(1)}%
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Trades" value={`${summary.totalTrades}`} icon={<Activity className="h-3 w-3" />} />
          <Stat label="Win Rate" value={`${summary.winRate.toFixed(1)}%`} />
          <Stat label="Profit Factor" value={isFinite(summary.profitFactor) ? summary.profitFactor.toFixed(2) : "∞"} />
          <Stat label="Max DD" value={`${summary.maxDrawdown.toFixed(1)}%`} tone="neg" />
          <Stat label="Avg R:R" value={summary.avgRR.toFixed(2)} />
          <Stat label="Net Return" value={`${summary.netReturn.toFixed(1)}%`} tone={summary.netReturn >= 0 ? "pos" : "neg"} />
          <Stat label="Avg Bars Held" value={summary.avgBarsHeld.toFixed(1)} />
          <Stat label="Period" value={`${summary.start.slice(0, 10)} → ${summary.end.slice(0, 10)}`} small />
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  fontSize: "12px",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                }}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke={summary.netReturn >= 0 ? "#10b981" : "#ef4444"}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
  small,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "pos" | "neg";
  small?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 font-mono tabular-nums ${small ? "text-sm" : "text-lg font-semibold"} ${
          tone === "pos" ? "text-emerald-600 dark:text-emerald-400" : tone === "neg" ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
