"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Activity, RefreshCw, Clock, ArrowUpRight, ArrowDownRight,
  Check, Zap, Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ScanSignal } from "@/lib/scanner/types";

// ─── Validated scanners ──────────────────────────────────────────────────

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

const TABS = ["Live", "Validated", "Prop Firm"] as const;
type Tab = typeof TABS[number];

// ─── Component ──────────────────────────────────────────────────────────────

export function IctScannerPage() {
  const [tab, setTab] = useState<Tab>("Live");
  const [signals, setSignals] = useState<ScanSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [killzone, setKillzone] = useState("");

  const runScan = useCallback(async (silent = false) => {
    setLoading(true);
    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyType: "all", timeframes: ["4h", "1d"], minScore: 50 }),
      });
      const json = await res.json();
      setSignals(json.signals ?? []);
      setLastScan(new Date());
      setIsLive(!!json.meta?.live);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void runScan(true); }, [runScan]);

  const runScanRef = useRef(runScan);
  useEffect(() => { runScanRef.current = runScan; });
  useEffect(() => {
    if (!autoScan) return;
    const id = setInterval(() => {
      if (!document.hidden) void runScanRef.current(true);
    }, 60_000);
    return () => clearInterval(id);
  }, [autoScan]);

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

  return (
    <div className="px-4 sm:px-6 lg:px-10 pt-6 pb-16">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <p className="pepy-label mb-2">QuantForge</p>
          <h1 className="pepy-heading-lg m-0">Strategy Scanner</h1>
          <p className="pepy-subtitle m-0 mt-2">48 scanners · 6 families · live signal stream</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {isLive && (
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--stem)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--stem)]" />
              </span>
              <span className="pepy-label text-[var(--stem)]">LIVE</span>
            </span>
          )}
          {lastScan && (
            <span className={cn("pepy-label", secondsAgo > 90 && "text-amber-500")}>
              {secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`}
            </span>
          )}
          {killzone && (
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-[var(--ink-2)]" />
              <span className="pepy-label">{killzone}</span>
            </span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Switch checked={autoScan} onCheckedChange={setAutoScan} />
            <span className="pepy-label">Auto</span>
          </label>
          <button
            onClick={() => runScan(false)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-[var(--stem)] px-3 py-1.5 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
            {loading ? "Scanning" : "Scan"}
          </button>
        </div>
      </div>

      {/* ─── Tab bar ─── */}
      <div className="flex items-center gap-1 border-b border-[var(--rule)] overflow-x-auto mb-6">
        {TABS.map(t => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-serif uppercase tracking-[0.12em] whitespace-nowrap border-b-2 -mb-px transition-colors",
                active
                  ? "text-[var(--ink)] border-[var(--stem)]"
                  : "text-[var(--ink-2)] border-transparent hover:text-[var(--ink)]"
              )}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* ─── Tab content ─── */}
      {tab === "Live" && <LiveTab signals={signals} loading={loading} />}
      {tab === "Validated" && <ValidatedTab />}
      {tab === "Prop Firm" && <PropFirmTab />}

      <hr className="pepy-section-divider mt-12" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Live tab — signal stream
// ═══════════════════════════════════════════════════════════════════════════

function LiveTab({ signals, loading }: { signals: ScanSignal[]; loading: boolean }) {
  if (loading && signals.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--rule)] bg-[var(--paper)] py-16 text-center">
        <Radio className="h-8 w-8 mx-auto mb-3 text-[var(--ink-2)] opacity-30" />
        <p className="pepy-body-serif">No signals right now. The scanner is watching.</p>
      </div>
    );
  }

  // Group by direction
  const longs = signals.filter(s => s.direction === "long");
  const shorts = signals.filter(s => s.direction === "short");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Long signals */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <ArrowUpRight size={14} className="text-[var(--stem)]" />
          <span className="pepy-label">Long Signals</span>
          <span className="pepy-label text-[var(--ink-2)] opacity-60">{longs.length}</span>
        </div>
        <div className="space-y-1">
          {longs.map((sig, i) => <SignalRow key={i} signal={sig} />)}
        </div>
      </div>

      {/* Short signals */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <ArrowDownRight size={14} className="text-rose-500" />
          <span className="pepy-label">Short Signals</span>
          <span className="pepy-label text-[var(--ink-2)] opacity-60">{shorts.length}</span>
        </div>
        <div className="space-y-1">
          {shorts.map((sig, i) => <SignalRow key={i} signal={sig} />)}
        </div>
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: ScanSignal }) {
  const isLong = signal.direction === "long";
  const validated = SCANNERS.some(s => s.key === signal.strategyKey);

  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 hover:bg-[var(--paper-2)] transition-colors">
      {/* Direction */}
      <span className={cn("text-xs font-mono font-bold uppercase w-10", isLong ? "text-[var(--stem)]" : "text-rose-500")}>
        {signal.direction}
      </span>

      {/* Symbol */}
      <span className="pepy-value text-sm min-w-[100px]">{signal.display}</span>

      {/* Timeframe */}
      <span className="pepy-label text-[var(--ink-2)]">{signal.timeframe.toUpperCase()}</span>

      {/* Strategy */}
      <span className="text-xs text-[var(--ink-2)] truncate flex-1 min-w-0">{signal.strategyKey.replace(/^(trend|ict|ea|community|horc|channel)-/, "")}</span>

      {/* Validated badge */}
      {validated && (
        <span className="flex items-center gap-0.5 text-[var(--stem)]">
          <Check size={10} />
        </span>
      )}

      {/* Grade */}
      {signal.grade && (
        <span className="pepy-label text-[var(--ink-2)]">{signal.grade}</span>
      )}

      {/* Score */}
      <span className="pepy-value text-xs">{signal.score}</span>

      {/* Entry price */}
      {signal.entryPrice && (
        <span className="pepy-value text-xs text-[var(--ink-2)]">{signal.entryPrice.toFixed(5)}</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Validated tab — handbook-passed scanners
// ═══════════════════════════════════════════════════════════════════════════

function ValidatedTab() {
  const families = [...new Set(SCANNERS.map(s => s.family))];

  return (
    <div className="space-y-8">
      <div>
        <p className="pepy-subtitle m-0">
          14 scanners passed the Kieran Duff systematic trading handbook rules
          (≥4 of 6 tests). These are candidates for MT5 Strategy Tester validation.
        </p>
      </div>

      {families.map(family => {
        const scanners = SCANNERS.filter(s => s.family === family);
        return (
          <div key={family}>
            {/* Section header */}
            <div className="flex items-baseline gap-2 mb-3 pb-2 border-b border-[var(--rule)]">
              <span className="pepy-label">{family}</span>
              <span className="pepy-label text-[var(--ink-2)] opacity-60">{scanners.length} validated</span>
            </div>

            {/* Scanner list */}
            <div className="space-y-1">
              {scanners.map(s => (
                <div
                  key={s.key}
                  className="flex items-center gap-4 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-4 py-2.5"
                >
                  <span className={cn(
                    "pepy-label w-12",
                    s.tier === "PERFECT" ? "text-[var(--stem)]" :
                    s.tier === "GREAT" ? "text-blue-500" :
                    "text-amber-500"
                  )}>
                    {s.tier}
                  </span>
                  <span className="text-sm font-serif text-[var(--ink)] min-w-[160px]">{s.short}</span>
                  <span className="pepy-label text-[var(--ink-2)] flex-1">{s.key}</span>
                  <span className="pepy-value text-sm">{s.pass}</span>
                  <Check size={14} className="text-[var(--stem)]" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Prop Firm tab — combination optimizer result
// ═══════════════════════════════════════════════════════════════════════════

function PropFirmTab() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="pepy-subtitle m-0">
          Two scanners that individually fail a prop challenge can pass together
          because they lose on different days. The prop firm grades your path, not your P&L.
        </p>
      </div>

      {/* Best combination */}
      <div className="rounded-lg border border-[var(--rule)] bg-[var(--paper)] p-6">
        <div className="flex items-baseline justify-between mb-4">
          <span className="pepy-label">Best Combination</span>
          <span className="pepy-value text-2xl text-[var(--stem)]">70.4%</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Scanner 1 */}
          <div className="flex-1 rounded-md border border-[var(--rule)] p-4">
            <div className="pepy-label mb-1">Scanner A</div>
            <div className="text-sm font-serif text-[var(--ink)]">Dual Donchian Channel</div>
            <div className="pepy-value text-xs text-[var(--ink-2)] mt-1">63.4% individual pass</div>
          </div>

          {/* Plus */}
          <span className="pepy-heading-md text-[var(--ink-2)]">+</span>

          {/* Scanner 2 */}
          <div className="flex-1 rounded-md border border-[var(--rule)] p-4">
            <div className="pepy-label mb-1">Scanner B</div>
            <div className="text-sm font-serif text-[var(--ink)]">SMC BOS/CHoCH s3</div>
            <div className="pepy-value text-xs text-[var(--ink-2)] mt-1">61.7% individual pass</div>
          </div>

          {/* Result */}
          <div className="flex-1 rounded-md border border-[var(--stem)] bg-[var(--stem)]/5 p-4">
            <div className="pepy-label mb-1 text-[var(--stem)]">Combined</div>
            <div className="text-sm font-serif text-[var(--ink)]">70.4% pass rate</div>
            <div className="pepy-value text-xs text-[var(--stem)] mt-1">+7.8% synergy</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--rule)]">
          <p className="pepy-body-serif m-0">
            The Donchian channel catches trend breakouts with a different loss profile
            than SMC BOS/CHoCH. They lose on different days — crash days cancel out.
            Combined pass rate exceeds either scanner individually.
          </p>
        </div>
      </div>

      {/* Rules */}
      <div className="rounded-lg border border-[var(--rule)] bg-[var(--paper)] p-6">
        <span className="pepy-label">LucidFlex 50K Rules</span>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-baseline gap-2">
            <span className="pepy-value">$50,000</span>
            <span className="pepy-label">Account</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="pepy-value">$3,000</span>
            <span className="pepy-label">Profit Target</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="pepy-value">$2,000</span>
            <span className="pepy-label">Trailing Drawdown</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="pepy-value">50%</span>
            <span className="pepy-label">Consistency Rule</span>
          </div>
        </div>
      </div>
    </div>
  );
}
