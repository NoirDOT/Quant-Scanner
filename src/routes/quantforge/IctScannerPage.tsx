"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ScanSignal } from "@/lib/scanner/types";
import {
  Activity, Clock, ArrowUp, ArrowDown, Zap, Radio,
  Target, Shield, Layers, CheckCircle2, Sun, Moon, AlertCircle,
} from "lucide-react";

const SCANNERS = [
  { key: "trend-donchian",              name: "Donchian",     family: "Trend",     pass: "6/6", tier: "PERFECT", color: "#3b82f6" },
  { key: "trend-ema",                   name: "EMA Stack",    family: "Trend",     pass: "5/6", tier: "GREAT",   color: "#3b82f6" },
  { key: "trend-supertrend-psar",       name: "ST+PSAR",      family: "Trend",     pass: "5/6", tier: "GREAT",   color: "#3b82f6" },
  { key: "trend-heikin-ashi",          name: "Heikin-Ashi",   family: "Trend",     pass: "5/6", tier: "GREAT",   color: "#3b82f6" },
  { key: "ict-fvg",                     name: "FVG",          family: "ICT",       pass: "5/6", tier: "GREAT",   color: "#10b981" },
  { key: "ict-liquidity",               name: "Liquidity",     family: "ICT",       pass: "5/6", tier: "GREAT",   color: "#10b981" },
  { key: "ea-btc-mom-adx",              name: "BTC Mom",       family: "EA",        pass: "5/6", tier: "GREAT",   color: "#8b5cf6" },
  { key: "community-smc-bos-choch-s5", name: "SMC BOS s5",   family: "Community", pass: "5/6", tier: "GREAT",   color: "#06b6d4" },
  { key: "community-smc-bos-choch-s3", name: "SMC BOS s3",   family: "Community", pass: "5/6", tier: "GREAT",   color: "#06b6d4" },
  { key: "ict-ob",                      name: "Order Block",   family: "ICT",       pass: "4/6", tier: "OK",      color: "#10b981" },
  { key: "ict-ote",                     name: "OTE",          family: "ICT",       pass: "4/6", tier: "OK",      color: "#10b981" },
  { key: "ict-premium-discount",        name: "Premium/Disc",  family: "ICT",       pass: "4/6", tier: "OK",      color: "#10b981" },
  { key: "ea-ema-cloud-touch",         name: "EMA Cloud",     family: "EA",        pass: "4/6", tier: "OK",      color: "#8b5cf6" },
  { key: "horc-origin-structure",       name: "HORC Origin",   family: "HORC",      pass: "4/6", tier: "OK",      color: "#f43f5e" },
] as const;

const TIER_COLORS: Record<string, string> = {
  PERFECT: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  GREAT: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400",
  OK: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
};

const SCAN_INTERVALS = {
  fast: 5 * 60 * 1000,
  medium: 15 * 60 * 1000,
  slow: 60 * 60 * 1000,
};

// Curated instrument list — not all 50+. Keeps the scan fast (under 10s on Vercel).
// Covers forex majors + crypto + gold + indices.
const INSTRUMENTS = [
  "EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X", "USDCAD=X", "USDCHF=X", "NZDUSD=X",
  "BTC-USD", "ETH-USD",
  "GC=F",
  "^GSPC", "^NDX",
] as const;

const ASSET_LABELS: Record<string, string> = {
  "EURUSD=X": "EUR/USD", "GBPUSD=X": "GBP/USD", "USDJPY=X": "USD/JPY",
  "AUDUSD=X": "AUD/USD", "USDCAD=X": "USD/CAD", "USDCHF=X": "USD/CHF", "NZDUSD=X": "NZD/USD",
  "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "GC=F": "Gold",
  "^GSPC": "S&P 500", "^NDX": "Nasdaq 100",
};

export function IctScannerPage() {
  const [signals, setSignals] = useState<ScanSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [scanInterval, setScanInterval] = useState<"fast" | "medium" | "slow">("medium");
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [killzone, setKillzone] = useState("");
  const [enabled, setEnabled] = useState<Set<string>>(new Set(SCANNERS.map(s => s.key)));
  const [dark, setDark] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle("dark");
    setDark(isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
  };

  const runScan = useCallback(async (silent = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyType: "all",
          instruments: Array.from(INSTRUMENTS),
          timeframes: ["4h", "1d"],
          minScore: 30,
          dispatch: true,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setSignals(json.signals ?? []);
      setLastScan(new Date());
      setIsLive(!!json.meta?.live);
    } catch (e) {
      console.error("[scanner] scan failed:", e);
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void runScan(true); }, [runScan]);

  const runScanRef = useRef(runScan);
  const intervalRef = useRef(scanInterval);
  useEffect(() => { runScanRef.current = runScan; });
  useEffect(() => { intervalRef.current = scanInterval; });
  useEffect(() => {
    if (!autoScan) return;
    const ms = SCAN_INTERVALS[intervalRef.current];
    const id = setInterval(() => {
      if (!document.hidden) void runScanRef.current(true);
    }, ms);
    return () => clearInterval(id);
  }, [autoScan, scanInterval]);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastScan) setSecondsAgo(Math.floor((Date.now() - lastScan.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [lastScan]);

  useEffect(() => {
    fetch("/api/scanner/killzones").then(r => r.json()).then(d => {
      setKillzone(d.nextKillzone?.label ?? d.current?.label ?? "");
    }).catch(() => {});
  }, []);

  const visibleSignals = signals.filter(s => {
    const sc = SCANNERS.find(x => x.key === s.strategyKey);
    if (sc && !enabled.has(sc.key)) return false;
    return true;
  });
  const longCount = visibleSignals.filter(s => s.direction === "long").length;
  const shortCount = visibleSignals.filter(s => s.direction === "short").length;
  const intervalLabel = scanInterval === "fast" ? "5m" : scanInterval === "medium" ? "15m" : "60m";

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">

        <header className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] mb-2" style={{ color: "var(--ink-2)" }}>Quant Scanner</p>
              <h1 className="font-serif text-4xl font-semibold tracking-tight" style={{ color: "var(--ink)" }}>Signal Stream</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {isLive && (
                <span className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-emerald-500" /></span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-500">LIVE</span>
                </span>
              )}
              {lastScan && (
                <span className={cn("font-mono text-[10px]", secondsAgo > 90 ? "text-amber-500" : "")} style={{ color: secondsAgo > 90 ? undefined : "var(--ink-2)" }}>
                  {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m ${secondsAgo % 60}s`}
                </span>
              )}
              {killzone && (
                <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: "var(--ink-2)" }}><Clock size={11} />{killzone}</span>
              )}
              <div className="flex items-center gap-1 rounded-lg border" style={{ borderColor: "var(--rule)" }}>
                {(["fast", "medium", "slow"] as const).map(v => (
                  <button key={v} onClick={() => setScanInterval(v)}
                    className={cn("px-2 py-1 text-[10px] font-mono rounded transition-colors", scanInterval === v ? "text-white" : "hover:opacity-70")}
                    style={{ background: scanInterval === v ? "var(--stem)" : "transparent", color: scanInterval === v ? "white" : "var(--ink-2)" }}>
                    {v === "fast" ? "5m" : v === "medium" ? "15m" : "60m"}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch checked={autoScan} onCheckedChange={setAutoScan} />
                <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>AUTO</span>
              </label>
              <button onClick={toggleTheme} className="p-1.5 rounded-lg transition-colors hover:opacity-80" style={{ color: "var(--ink-2)" }}>
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button onClick={() => runScan(false)} disabled={loading}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--stem)" }}>
                {loading ? <Activity size={12} className="animate-pulse" /> : <Zap size={12} />}
                {loading ? "Scanning" : "Scan"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6">
            <div className="flex items-center gap-1.5"><ArrowUp size={14} className="text-emerald-500" /><span className="font-mono text-sm font-bold text-emerald-500">{longCount}</span><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>LONG</span></div>
            <div className="flex items-center gap-1.5"><ArrowDown size={14} className="text-rose-500" /><span className="font-mono text-sm font-bold text-rose-500">{shortCount}</span><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>SHORT</span></div>
            <div className="h-4 w-px" style={{ background: "var(--rule)" }} />
            <div className="flex items-center gap-1.5"><Radio size={14} style={{ color: "var(--ink-2)" }} /><span className="font-mono text-sm font-bold" style={{ color: "var(--ink)" }}>{visibleSignals.length}</span><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>SIGNALS</span></div>
            <div className="h-4 w-px" style={{ background: "var(--rule)" }} />
            <div className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>
              <Clock size={11} /> {intervalLabel} · {INSTRUMENTS.length} pairs · 4h/1d
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <AlertCircle size={14} className="text-rose-500 shrink-0" />
              <span className="text-xs text-rose-600">{error}</span>
            </div>
          )}
        </header>

        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] mb-3" style={{ color: "var(--ink-2)" }}>
            Active Scanners · {enabled.size}/{SCANNERS.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SCANNERS.map(s => {
              const on = enabled.has(s.key);
              return (
                <button key={s.key} onClick={() => { const next = new Set(enabled); if (next.has(s.key)) next.delete(s.key); else next.add(s.key); setEnabled(next); }}
                  className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-all", on ? cn(TIER_COLORS[s.tier]) : "opacity-30 hover:opacity-60")}
                  style={!on ? { background: "var(--paper-2)", borderColor: "var(--rule)" } : undefined}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                  <span className="font-medium">{s.name}</span>
                  <span className="font-mono text-[9px] opacity-60">{s.pass}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-12">
          {loading && visibleSignals.length === 0 ? (
            <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-14 rounded-lg shimmer" />))}</div>
          ) : visibleSignals.length === 0 ? (
            <div className="rounded-xl border p-16 text-center" style={{ borderColor: "var(--rule)" }}>
              <Radio className="h-10 w-10 mx-auto mb-4 opacity-20" style={{ color: "var(--ink-2)" }} />
              <p className="font-serif text-lg italic" style={{ color: "var(--ink-2)" }}>No signals right now.</p>
              <p className="font-mono text-[10px] mt-2" style={{ color: "var(--ink-2)" }}>Scanning {INSTRUMENTS.length} pairs · {Object.values(ASSET_LABELS).join(", ")}</p>
            </div>
          ) : (
            <div className="space-y-1.5">{visibleSignals.sort((a, b) => b.score - a.score).map((sig, i) => <SignalCard key={i} signal={sig} />)}</div>
          )}
        </section>

        <section className="mb-12">
          <div className="flex items-baseline gap-3 mb-4">
            <Shield size={16} style={{ color: "var(--stem)" }} />
            <h2 className="font-serif text-xl font-semibold" style={{ color: "var(--ink)" }}>Validated Scanners</h2>
            <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>14 passed handbook · MT5 candidates</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {SCANNERS.map(s => (
              <div key={s.key} className={cn("rounded-lg border p-3 transition-all cursor-pointer", enabled.has(s.key) ? TIER_COLORS[s.tier] : "opacity-40")}
                onClick={() => { const next = new Set(enabled); if (next.has(s.key)) next.delete(s.key); else next.add(s.key); setEnabled(next); }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--rule)" }}>{s.pass}</span>
                </div>
                <div className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>{s.name}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-mono text-[9px]" style={{ color: "var(--ink-2)" }}>{s.family}</span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: "var(--stem)" }}>{s.tier}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <div className="flex items-baseline gap-3 mb-4">
            <Target size={16} style={{ color: "var(--stem)" }} />
            <h2 className="font-serif text-xl font-semibold" style={{ color: "var(--ink)" }}>Prop Firm Combination</h2>
          </div>
          <div className="rounded-xl border p-5" style={{ borderColor: "var(--rule)", background: "var(--paper-2)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-serif text-sm italic" style={{ color: "var(--ink-2)" }}>Two scanners that individually fail can pass together — they lose on different days.</p>
              <span className="font-mono text-2xl font-bold text-emerald-500">70.4%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-lg border p-3" style={{ borderColor: "var(--rule)", background: "var(--paper)" }}>
                <div className="font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--ink-2)" }}>Scanner A</div>
                <div className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>Dual Donchian</div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--ink-2)" }}>63.4% individual</div>
              </div>
              <span className="font-serif text-lg" style={{ color: "var(--ink-2)" }}>+</span>
              <div className="flex-1 rounded-lg border p-3" style={{ borderColor: "var(--rule)", background: "var(--paper)" }}>
                <div className="font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--ink-2)" }}>Scanner B</div>
                <div className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>SMC BOS s3</div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--ink-2)" }}>61.7% individual</div>
              </div>
              <span className="font-serif text-lg" style={{ color: "var(--ink-2)" }}>→</span>
              <div className="flex-1 rounded-lg border p-3" style={{ borderColor: "var(--stem)", background: "hsl(161 91% 30% / 0.05)" }}>
                <div className="font-mono text-[9px] uppercase tracking-wider mb-1 text-emerald-500">Combined</div>
                <div className="font-serif text-sm font-bold text-emerald-500">70.4% pass</div>
                <div className="font-mono text-[10px] mt-0.5 text-emerald-500">+7.8% synergy</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t flex items-center gap-6" style={{ borderColor: "var(--rule)" }}>
              <div className="flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-500" /><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>$50K account</span></div>
              <div className="flex items-center gap-2"><Target size={14} style={{ color: "var(--ink-2)" }} /><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>$3K target</span></div>
              <div className="flex items-center gap-2"><Shield size={14} style={{ color: "var(--ink-2)" }} /><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>$2K trailing DD</span></div>
              <div className="flex items-center gap-2"><Layers size={14} style={{ color: "var(--ink-2)" }} /><span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>50% consistency</span></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: ScanSignal }) {
  const isLong = signal.direction === "long";
  const scanner = SCANNERS.find(s => s.key === signal.strategyKey);
  return (
    <div className="animate-slide-in flex items-center gap-3 rounded-lg border p-3 transition-all hover:shadow-sm"
      style={{ borderColor: isLong ? "hsl(161 91% 30% / 0.2)" : "hsl(0 72% 51% / 0.2)", background: isLong ? "hsl(161 91% 30% / 0.03)" : "hsl(0 72% 51% / 0.03)" }}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: isLong ? "hsl(161 91% 30% / 0.1)" : "hsl(0 72% 51% / 0.1)" }}>
        {isLong ? <ArrowUp size={16} className="text-emerald-500" /> : <ArrowDown size={16} className="text-rose-500" />}
      </div>
      <div className="shrink-0 min-w-[100px]">
        <div className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>{signal.display}</div>
        <div className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>{signal.timeframe.toUpperCase()}</div>
      </div>
      <div className="hidden sm:block shrink-0 min-w-[120px]">
        <div className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>{scanner?.name ?? signal.strategyKey.replace(/^(trend|ict|ea|community|horc|channel)-/, "")}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-1.5 w-16 rounded-full overflow-hidden" style={{ background: "var(--rule)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${signal.score}%`, background: signal.score >= 70 ? "var(--stem)" : signal.score >= 50 ? "var(--copper)" : "var(--loss)" }} />
        </div>
        <span className="font-mono text-[10px] w-6" style={{ color: "var(--ink-2)" }}>{signal.score}</span>
      </div>
      {signal.entryPrice && (
        <div className="hidden md:flex items-center gap-4 ml-auto shrink-0">
          <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>Entry</div><div className="font-mono text-xs" style={{ color: "var(--ink)" }}>{signal.entryPrice.toFixed(5)}</div></div>
          <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>Stop</div><div className="font-mono text-xs text-rose-500">{signal.stopPrice?.toFixed(5) ?? "—"}</div></div>
          <div className="text-right"><div className="font-mono text-[8px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>Target</div><div className="font-mono text-xs text-emerald-500">{signal.targetPrice?.toFixed(5) ?? "—"}</div></div>
        </div>
      )}
    </div>
  );
}
