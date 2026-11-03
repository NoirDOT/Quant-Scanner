"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  RefreshCw, Clock, ArrowUp, ArrowDown, Zap, Radio,
  ChevronRight, ArrowLeft, Layers, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScanSignal } from "@/lib/scanner/types";

// ─── Validated scanners (handbook tier) ────────────────────────────────────

const SCANNERS = [
  { key: "trend-donchian",              short: "Donchian",     family: "Trend",     pass: "6/6", tier: "PERFECT" },
  { key: "trend-ema",                   short: "EMA Stack",    family: "Trend",     pass: "5/6", tier: "GREAT" },
  { key: "trend-supertrend-psar",       short: "ST+PSAR",      family: "Trend",     pass: "5/6", tier: "GREAT" },
  { key: "trend-heikin-ashi",          short: "Heikin-Ashi",   family: "Trend",     pass: "5/6", tier: "GREAT" },
  { key: "ict-fvg",                     short: "FVG",           family: "ICT",       pass: "5/6", tier: "GREAT" },
  { key: "ict-liquidity",               short: "Liquidity",     family: "ICT",       pass: "5/6", tier: "GREAT" },
  { key: "ea-btc-mom-adx",              short: "BTC Mom+ADX",  family: "EA",         pass: "5/6", tier: "GREAT" },
  { key: "community-smc-bos-choch-s5", short: "SMC BOS s5",   family: "Community", pass: "5/6", tier: "GREAT" },
  { key: "community-smc-bos-choch-s3", short: "SMC BOS s3",   family: "Community", pass: "5/6", tier: "GREAT" },
  { key: "ict-ob",                      short: "Order Block",   family: "ICT",       pass: "4/6", tier: "OK" },
  { key: "ict-ote",                     short: "OTE",           family: "ICT",       pass: "4/6", tier: "OK" },
  { key: "ict-premium-discount",        short: "Premium/Disc",  family: "ICT",       pass: "4/6", tier: "OK" },
  { key: "ea-ema-cloud-touch",         short: "EMA Cloud",     family: "EA",         pass: "4/6", tier: "OK" },
  { key: "horc-origin-structure",       short: "HORC Origin",   family: "HORC",      pass: "4/6", tier: "OK" },
] as const;

const SCAN_INTERVALS = {
  fast: 5 * 60 * 1000,
  medium: 15 * 60 * 1000,
  slow: 60 * 60 * 1000,
};

// ─── Family metadata (NO blue/indigo per styling rules) ─────────────────────

interface FamilyMeta {
  label: string;
  color: string;       // hex
  borderAlpha: string; // tailwind border tint
  bgAlpha: string;     // tailwind bg tint
  textClass: string;
}

const FAMILIES: Record<string, FamilyMeta> = {
  trend:     { label: "Trend",     color: "#10b981", borderAlpha: "border-emerald-500/30", bgAlpha: "bg-emerald-500/10",  textClass: "text-emerald-600 dark:text-emerald-400" },
  ict:       { label: "ICT",       color: "#8b5cf6", borderAlpha: "border-violet-500/30",  bgAlpha: "bg-violet-500/10",    textClass: "text-violet-600 dark:text-violet-400" },
  trader:    { label: "Trader",    color: "#f97316", borderAlpha: "border-orange-500/30", bgAlpha: "bg-orange-500/10",    textClass: "text-orange-600 dark:text-orange-400" },
  ea:        { label: "EA",        color: "#f59e0b", borderAlpha: "border-amber-500/30",  bgAlpha: "bg-amber-500/10",    textClass: "text-amber-600 dark:text-amber-400" },
  horc:      { label: "HORC",      color: "#f43f5e", borderAlpha: "border-rose-500/30",    bgAlpha: "bg-rose-500/10",      textClass: "text-rose-600 dark:text-rose-400" },
  community: { label: "Community", color: "#14b8a6", borderAlpha: "border-teal-500/30",    bgAlpha: "bg-teal-500/10",      textClass: "text-teal-600 dark:text-teal-400" },
};

function familyOf(signal: ScanSignal): string {
  const key = signal.strategyKey;
  for (const f of Object.keys(FAMILIES)) {
    if (key.startsWith(f + "-") || key === f) return f;
  }
  return signal.strategyType ?? "trend";
}

function familyMeta(fam: string): FamilyMeta {
  return FAMILIES[fam] ?? FAMILIES.trend;
}

// Pretty strategy label
function strategyLabel(signal: ScanSignal): string {
  if (signal.strategyLabel && signal.strategyLabel.trim()) return signal.strategyLabel;
  const fam = familyOf(signal);
  let rest = signal.strategyKey;
  if (rest.startsWith(fam + "-")) rest = rest.slice(fam.length + 1);
  rest = rest.replace(/-(1h|2h|4h|1d|1w)$/, "");
  rest = rest.replace(/-/g, " ");
  return rest.replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Component ──────────────────────────────────────────────────────────────

export function IctScannerPage() {
  const [signals, setSignals] = useState<ScanSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [scanInterval, setScanInterval] = useState<"fast" | "medium" | "slow">("medium");
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [killzone, setKillzone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  const runScan = useCallback(async (silent = false) => {
    setLoading(true);
    setError(null);
    try {
      // BROWSER_SECRET is exposed to the client via NEXT_PUBLIC_BROWSER_SECRET.
      // When set, the server allows dispatch (Discord alerts) + persist from
      // this UI. When unset, scans still run but won't dispatch/persist.
      const browserSecret = process.env.NEXT_PUBLIC_BROWSER_SECRET;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (browserSecret) headers["Authorization"] = `Bearer ${browserSecret}`;
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers,
        body: JSON.stringify({
          strategyType: "all",
          timeframes: ["4h", "1d"],
          minScore: 50,
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

  // ─── Derived: group signals by strategy ─────────────────────────────────
  const strategyGroups = useMemo(() => {
    const map = new Map<string, ScanSignal[]>();
    for (const s of signals) {
      const arr = map.get(s.strategyKey) ?? [];
      arr.push(s);
      map.set(s.strategyKey, arr);
    }
    return Array.from(map.entries()).map(([key, sigs]) => {
      const fam = familyOf(sigs[0]);
      const longs = sigs.filter(s => s.direction === "long").length;
      const shorts = sigs.filter(s => s.direction === "short").length;
      const best = sigs.reduce((a, b) => (b.score > a.score ? b : a));
      const pairs = Array.from(new Set(sigs.map(s => s.display)));
      return {
        key,
        label: strategyLabel(sigs[0]),
        family: fam,
        familyMeta: familyMeta(fam),
        count: sigs.length,
        longs,
        shorts,
        best,
        pairs,
        signals: sigs.sort((a, b) => b.score - a.score),
      };
    }).sort((a, b) => b.count - a.count || b.best.score - a.best.score);
  }, [signals]);

  const filteredGroups = useMemo(() => {
    if (familyFilter === "all") return strategyGroups;
    return strategyGroups.filter(g => g.family === familyFilter);
  }, [strategyGroups, familyFilter]);

  const familyCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of strategyGroups) m[g.family] = (m[g.family] ?? 0) + g.count;
    return m;
  }, [strategyGroups]);

  const totalLongs = signals.filter(s => s.direction === "long").length;
  const totalShorts = signals.filter(s => s.direction === "short").length;
  const pairsCovered = useMemo(
    () => new Set(signals.map(s => s.symbol)).size,
    [signals]
  );
  const intervalLabel = scanInterval === "fast" ? "5m" : scanInterval === "medium" ? "15m" : "60m";

  const selectedGroup = selectedStrategy
    ? strategyGroups.find(g => g.key === selectedStrategy) ?? null
    : null;

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col min-h-screen">

        {/* ─── Header ─── */}
        <header className="mb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] mb-2" style={{ color: "var(--ink-2)" }}>Quant Scanner</p>
              <h1 className="font-serif text-4xl font-semibold tracking-tight m-0" style={{ color: "var(--ink)" }}>Strategy Scanner</h1>
              <p className="font-mono text-[11px] m-0 mt-2" style={{ color: "var(--ink-2)" }}>48 scanners · 6 families · live signal stream</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
              {isLive && (
                <span className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-emerald-500" />
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-500">LIVE</span>
                </span>
              )}
              {lastScan && (
                <span className={cn("font-mono text-[10px]", secondsAgo > 90 && "text-amber-500")} style={{ color: secondsAgo > 90 ? undefined : "var(--ink-2)" }}>
                  {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m ${secondsAgo % 60}s`}
                </span>
              )}
              {killzone && (
                <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>
                  <Clock size={11} />{killzone}
                </span>
              )}
              {/* Cadence selector */}
              <div className="flex items-center gap-1 rounded-lg border" style={{ borderColor: "var(--rule)" }}>
                {(["fast", "medium", "slow"] as const).map(v => (
                  <button key={v} onClick={() => setScanInterval(v)}
                    className={cn("px-2 py-1 text-[10px] font-mono rounded transition-colors", scanInterval === v ? "text-white" : "hover:opacity-70")}
                    style={{ background: scanInterval === v ? "var(--stem)" : "transparent", color: scanInterval === v ? "white" : "var(--ink-2)" }}>
                    {v === "fast" ? "5m" : v === "medium" ? "15m" : "60m"}
                  </button>
                ))}
              </div>
              {/* AUTO toggle — prominent pill */}
              <button
                type="button"
                onClick={() => setAutoScan(v => !v)}
                aria-pressed={autoScan}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all select-none",
                  autoScan
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-[var(--paper)] hover:opacity-80"
                )}
                style={!autoScan ? { borderColor: "var(--rule)", color: "var(--ink-2)" } : undefined}
                title={autoScan ? "Auto-scan is ON — click to turn OFF" : "Auto-scan is OFF — click to turn ON"}
              >
                <span className={cn("flex h-2 w-2 rounded-full transition-colors", autoScan ? "bg-emerald-500" : "opacity-40")} style={!autoScan ? { background: "var(--ink-2)" } : undefined} />
                <span className="font-mono text-[10px] uppercase tracking-wider">AUTO</span>
                <span className={cn("font-mono text-[10px] font-bold", autoScan ? "text-emerald-600 dark:text-emerald-400" : "")} style={!autoScan ? { color: "var(--ink-2)" } : undefined}>
                  {autoScan ? "ON" : "OFF"}
                </span>
              </button>
              <button onClick={() => runScan(false)} disabled={loading}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--stem)" }}>
                {loading ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                {loading ? "Scanning" : "Scan"}
              </button>
            </div>
          </div>

          {/* ─── Stats row ─── */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat icon={<Radio size={13} />} value={signals.length} label="SIGNALS" />
            <Stat icon={<Layers size={13} />} value={strategyGroups.length} label="STRATEGIES" />
            <Stat icon={<Eye size={13} />} value={pairsCovered} label="PAIRS" />
            <div className="h-4 w-px" style={{ background: "var(--rule)" }} />
            <div className="flex items-center gap-1.5">
              <ArrowUp size={13} className="text-emerald-500" />
              <span className="font-mono text-sm font-bold text-emerald-500">{totalLongs}</span>
              <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>LONG</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowDown size={13} className="text-rose-500" />
              <span className="font-mono text-sm font-bold text-rose-500">{totalShorts}</span>
              <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>SHORT</span>
            </div>
            <div className="h-4 w-px" style={{ background: "var(--rule)" }} />
            <div className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>
              <Clock size={11} /> {intervalLabel} · 4h/1d
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <span className="text-xs text-rose-600">{error}</span>
            </div>
          )}
        </header>

        {/* ─── Main content ─── */}
        {selectedGroup ? (
          <StrategyDetail group={selectedGroup} onBack={() => setSelectedStrategy(null)} />
        ) : (
          <>
            {/* Family filter chips */}
            <div className="mb-5 flex flex-wrap items-center gap-1.5">
              <FilterChip
                active={familyFilter === "all"}
                onClick={() => setFamilyFilter("all")}
                label="All"
                count={signals.length}
              />
              {Object.entries(FAMILIES).map(([key, meta]) => {
                const count = familyCounts[key] ?? 0;
                if (count === 0) return null;
                return (
                  <FilterChip
                    key={key}
                    active={familyFilter === key}
                    onClick={() => setFamilyFilter(key)}
                    label={meta.label}
                    count={count}
                    color={meta.color}
                  />
                );
              })}
            </div>

            {/* Strategy cards grid OR loading/empty */}
            {loading && signals.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="rounded-xl border p-16 text-center" style={{ borderColor: "var(--rule)", background: "var(--paper-2)" }}>
                <Radio className="h-10 w-10 mx-auto mb-4 opacity-20" style={{ color: "var(--ink-2)" }} />
                <p className="font-serif text-lg italic" style={{ color: "var(--ink-2)" }}>No signals right now.</p>
                <p className="font-mono text-[10px] mt-2" style={{ color: "var(--ink-2)" }}>
                  Scanning {pairsCovered} pairs · next sweep in {intervalLabel}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredGroups.map(g => (
                  <StrategyCard
                    key={g.key}
                    group={g}
                    onClick={() => setSelectedStrategy(g.key)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stat pill ─────────────────────────────────────────────────────────────

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: "var(--ink-2)" }}>{icon}</span>
      <span className="font-mono text-sm font-bold" style={{ color: "var(--ink)" }}>{value}</span>
      <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>{label}</span>
    </div>
  );
}

// ─── Family filter chip ────────────────────────────────────────────────────

function FilterChip({
  active, onClick, label, count, color,
}: {
  active: boolean; onClick: () => void; label: string; count: number; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all",
        active ? "text-white" : "hover:opacity-80"
      )}
      style={active
        ? { background: "var(--stem)", borderColor: "var(--stem)", color: "white" }
        : { background: "var(--paper)", borderColor: "var(--rule)", color: "var(--ink-2)" }
      }
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {label}
      <span className={cn("font-mono text-[10px]", active ? "text-white opacity-80" : "opacity-60")}>{count}</span>
    </button>
  );
}

// ─── Strategy card (the drill-down entry point) ────────────────────────────

interface StrategyGroup {
  key: string;
  label: string;
  family: string;
  familyMeta: FamilyMeta;
  count: number;
  longs: number;
  shorts: number;
  best: ScanSignal;
  pairs: string[];
  signals: ScanSignal[];
}

function StrategyCard({ group, onClick }: { group: StrategyGroup; onClick: () => void }) {
  const { label, familyMeta: m, count, longs, shorts, best, pairs } = group;
  const tier = SCANNERS.find(s => s.key === best.strategyKey)?.tier;
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5",
        m.borderAlpha
      )}
      style={{ background: "var(--paper)" }}
    >
      {/* Family color stripe (top) */}
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: m.color }} />

      {/* Header: family badge + tier */}
      <div className="flex items-center justify-between mb-3">
        <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", m.bgAlpha, m.textClass)}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
          {m.label}
        </span>
        {tier && (
          <span className={cn(
            "font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border",
            tier === "PERFECT" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" :
            tier === "GREAT" ? "border-violet-500/40 text-violet-600 dark:text-violet-400" :
            "border-amber-500/40 text-amber-600 dark:text-amber-400"
          )}>
            {tier}
          </span>
        )}
      </div>

      {/* Strategy name */}
      <div className="font-serif text-base font-semibold leading-tight mb-1 line-clamp-2" style={{ color: "var(--ink)" }}>
        {label}
      </div>

      {/* Signal count (big) */}
      <div className="flex items-baseline gap-2 mt-2">
        <span className="font-mono text-3xl font-bold" style={{ color: m.color }}>{count}</span>
        <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>signals</span>
      </div>

      {/* Direction split */}
      <div className="flex items-center gap-3 mt-2 text-[11px]">
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <ArrowUp size={11} />{longs}
        </span>
        <span className="flex items-center gap-1 text-rose-500">
          <ArrowDown size={11} />{shorts}
        </span>
        <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>
          top {best.score}
        </span>
      </div>

      {/* Pairs preview chips */}
      <div className="mt-3 flex flex-wrap gap-1">
        {pairs.slice(0, 4).map(p => (
          <span key={p} className="rounded px-1.5 py-0.5 font-mono text-[9px]" style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}>
            {p}
          </span>
        ))}
        {pairs.length > 4 && (
          <span className="rounded px-1.5 py-0.5 font-mono text-[9px]" style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}>
            +{pairs.length - 4}
          </span>
        )}
      </div>

      {/* CTA */}
      <div className="mt-3 flex items-center gap-1 text-[11px] font-medium" style={{ color: m.color }}>
        View pairs
        <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

// ─── Strategy detail view (pairs under a strategy) ─────────────────────────

function StrategyDetail({ group, onBack }: { group: StrategyGroup; onBack: () => void }) {
  const { label, familyMeta: m, count, longs, shorts, signals } = group;
  const longSignals = signals.filter(s => s.direction === "long");
  const shortSignals = signals.filter(s => s.direction === "short");

  return (
    <div>
      {/* Back button + header */}
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
        style={{ color: "var(--ink-2)" }}
      >
        <ArrowLeft size={14} /> Back to strategies
      </button>

      <div className={cn("rounded-xl border p-5 mb-6", m.borderAlpha, m.bgAlpha)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", m.bgAlpha, m.textClass)}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                {m.label}
              </span>
            </div>
            <h2 className="font-serif text-2xl font-semibold m-0" style={{ color: "var(--ink)" }}>{label}</h2>
            <p className="font-mono text-[10px] mt-1 m-0" style={{ color: "var(--ink-2)" }}>{group.key}</p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: m.color }}>{count}</div>
              <div className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>signals</div>
            </div>
            <div className="h-10 w-px" style={{ background: "var(--rule)" }} />
            <div className="text-center">
              <div className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">{longs}</div>
              <div className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>long</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-xl font-bold text-rose-500">{shorts}</div>
              <div className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>short</div>
            </div>
          </div>
        </div>
      </div>

      {/* Long / Short sections */}
      {longSignals.length > 0 && (
        <SignalSection title="Long Signals" count={longSignals.length} direction="long" signals={longSignals} />
      )}
      {shortSignals.length > 0 && (
        <SignalSection title="Short Signals" count={shortSignals.length} direction="short" signals={shortSignals} />
      )}
    </div>
  );
}

function SignalSection({
  title, count, direction, signals,
}: {
  title: string; count: number; direction: "long" | "short"; signals: ScanSignal[];
}) {
  const isLong = direction === "long";
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-2 mb-3 pb-2 border-b" style={{ borderColor: "var(--rule)" }}>
        {isLong ? <ArrowUp size={14} className="text-emerald-500" /> : <ArrowDown size={14} className="text-rose-500" />}
        <span className="font-serif text-base font-semibold" style={{ color: "var(--ink)" }}>{title}</span>
        <span className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>({count})</span>
      </div>
      <div className="space-y-2">
        {signals.map((sig, i) => (
          <PairSignalRow key={`${sig.symbol}-${sig.timeframe}-${i}`} signal={sig} />
        ))}
      </div>
    </section>
  );
}

function PairSignalRow({ signal }: { signal: ScanSignal }) {
  const isLong = signal.direction === "long";
  const rr = signal.entryPrice && signal.stopPrice && signal.targetPrice
    ? Math.abs(signal.targetPrice - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopPrice)
    : null;

  const fmtPrice = (p?: number) => {
    if (p == null || !Number.isFinite(p)) return "—";
    if (signal.assetClass === "forex") return p.toFixed(5);
    if (signal.assetClass === "crypto") return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (signal.assetClass === "commodity" || signal.assetClass === "index") return p.toFixed(2);
    return p.toFixed(2);
  };

  return (
    <div className={cn(
      "rounded-lg border p-3 transition-colors",
      isLong ? "border-emerald-500/20" : "border-rose-500/20"
    )} style={{ background: "var(--paper)" }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Direction + pair */}
        <div className="flex items-center gap-2.5 min-w-[120px]">
          <div className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isLong ? "bg-emerald-500/10" : "bg-rose-500/10"
          )}>
            {isLong ? <ArrowUp size={16} className="text-emerald-500" /> : <ArrowDown size={16} className="text-rose-500" />}
          </div>
          <div>
            <div className="font-serif text-sm font-semibold leading-tight" style={{ color: "var(--ink)" }}>{signal.display}</div>
            <div className="font-mono text-[10px]" style={{ color: "var(--ink-2)" }}>{signal.timeframe.toUpperCase()}</div>
          </div>
        </div>

        {/* Score + grade */}
        <div className="flex items-center gap-2 min-w-[90px]">
          <div className="flex flex-col items-center">
            <span className="font-mono text-lg font-bold" style={{ color: "var(--ink)" }}>{signal.score}</span>
            <span className="font-mono text-[9px]" style={{ color: "var(--ink-2)" }}>score</span>
          </div>
          {signal.grade && (
            <span className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold",
              signal.grade.startsWith("A") ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" :
              signal.grade === "B+" ? "border-violet-500/40 text-violet-600 dark:text-violet-400" :
              signal.grade === "B-" ? "border-amber-500/40 text-amber-600 dark:text-amber-400" :
              ""
            )} style={(!signal.grade.startsWith("A") && signal.grade !== "B+" && signal.grade !== "B-") ? { borderColor: "var(--rule)", color: "var(--ink-2)" } : undefined}>
              {signal.grade}
            </span>
          )}
        </div>

        {/* Entry / Stop / Target */}
        {signal.entryPrice && (
          <div className="flex items-center gap-4 ml-auto">
            <div className="text-right">
              <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>ENTRY</div>
              <div className="font-mono text-xs" style={{ color: "var(--ink)" }}>{fmtPrice(signal.entryPrice)}</div>
            </div>
            {signal.stopPrice && (
              <div className="text-right">
                <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>STOP</div>
                <div className="font-mono text-xs text-rose-500">{fmtPrice(signal.stopPrice)}</div>
              </div>
            )}
            {signal.targetPrice && (
              <div className="text-right">
                <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>TARGET</div>
                <div className="font-mono text-xs text-emerald-500">{fmtPrice(signal.targetPrice)}</div>
              </div>
            )}
            {rr && (
              <div className="text-right">
                <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>R:R</div>
                <div className="font-mono text-xs font-semibold" style={{ color: "var(--ink)" }}>{rr.toFixed(2)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reasons */}
      {signal.reasons && signal.reasons.length > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--rule)" }}>
          <ul className="space-y-0.5">
            {signal.reasons.slice(0, 4).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--ink-2)" }}>
                <span className="mt-0.5" style={{ color: "var(--stem)" }}>▸</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
