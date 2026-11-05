"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save, X, Wand2, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// ─── Types (mirror the backend schema) ────────────────────────────────────────

interface Condition {
  indicator: "ema" | "rsi" | "adx" | "macd" | "supertrend" | "price" | "volume";
  period?: number;
  comparator: ">" | "<" | ">=" | "<=" | "crosses_above" | "crosses_below" | "between";
  value: string | number;
  value2?: number;
}

interface RuleTree {
  entry: { logic: "and" | "or"; conditions: Condition[] };
  exit: { stopType: "atr" | "fixed" | "ema"; stopValue: number; targetType: "rr"; targetValue: number };
  score: number;
  direction: "long" | "short" | "auto";
}

interface CustomStrategy {
  id?: string;
  key?: string;
  name: string;
  description: string;
  family: string;
  enabled: boolean;
  timeframes: string[];
  rules: RuleTree;
}

const INDICATORS = [
  { value: "ema", label: "EMA", needsPeriod: true, defaultPeriod: 21 },
  { value: "rsi", label: "RSI", needsPeriod: true, defaultPeriod: 14 },
  { value: "adx", label: "ADX", needsPeriod: true, defaultPeriod: 14 },
  { value: "macd", label: "MACD", needsPeriod: false },
  { value: "supertrend", label: "Supertrend", needsPeriod: false },
  { value: "price", label: "Price", needsPeriod: false },
  { value: "volume", label: "Volume", needsPeriod: false },
];

const COMPARATORS = [
  { value: ">", label: "is above" },
  { value: "<", label: "is below" },
  { value: ">=", label: "is above or equal" },
  { value: "<=", label: "is below or equal" },
  { value: "crosses_above", label: "crosses above" },
  { value: "crosses_below", label: "crosses below" },
];

const VALUE_PRESETS = [
  { value: "close", label: "current close price" },
  { value: "ema21", label: "EMA 21" },
  { value: "ema50", label: "EMA 50" },
  { value: "ema200", label: "EMA 200" },
  { value: "open", label: "current open" },
  { value: "high", label: "current high" },
  { value: "low", label: "current low" },
  { value: "volume_avg20", label: "20-bar avg volume" },
];

const TIMEFRAMES = ["1h", "2h", "4h", "1d", "1w"];

const FAMILIES = [
  { value: "trend", label: "Trend" },
  { value: "ict", label: "ICT" },
  { value: "trader", label: "Trader" },
  { value: "ea", label: "EA" },
  { value: "horc", label: "HORC" },
  { value: "community", label: "Community" },
];

// ─── Default empty strategy ──────────────────────────────────────────────────

function emptyStrategy(): CustomStrategy {
  return {
    name: "",
    description: "",
    family: "trend",
    enabled: true,
    timeframes: ["4h", "1d"],
    rules: {
      entry: {
        logic: "and",
        conditions: [
          { indicator: "ema", period: 21, comparator: ">", value: "ema50" },
        ],
      },
      exit: { stopType: "atr", stopValue: 1.5, targetType: "rr", targetValue: 2 },
      score: 65,
      direction: "auto",
    },
  };
}

function emptyCondition(): Condition {
  return { indicator: "ema", period: 21, comparator: ">", value: "ema50" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StrategyBuilder({ onClose }: { onClose: () => void }) {
  const [strategies, setStrategies] = useState<CustomStrategy[]>([]);
  const [editing, setEditing] = useState<CustomStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const apiSecret = process.env.NEXT_PUBLIC_BROWSER_SECRET;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const loadStrategies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scanner/custom-strategies", { headers });
      if (res.ok) {
        const json = await res.json();
        setStrategies(json.strategies ?? []);
      }
    } catch (e) {
      console.error("load strategies error:", e);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void loadStrategies(); }, [loadStrategies]);

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) {
      toast.error("Strategy name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/scanner/custom-strategies", {
        method: "POST",
        headers,
        body: JSON.stringify(editing),
      });
      if (res.ok) {
        toast.success(`Strategy "${editing.name}" saved`);
        await loadStrategies();
        setEditing(null);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this strategy?")) return;
    try {
      await fetch(`/api/scanner/custom-strategies/${id}`, {
        method: "DELETE",
        headers,
      });
      toast.success("Strategy deleted");
      await loadStrategies();
    } catch (e) {
      toast.error("Failed to delete");
    }
  };

  const handleToggle = async (s: CustomStrategy) => {
    if (!s.id) return;
    try {
      await fetch(`/api/scanner/custom-strategies/${s.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      await loadStrategies();
    } catch (e) {
      toast.error("Failed to toggle");
    }
  };

  // ─── Editing UI ──────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 100 }}>
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border p-6" style={{ background: "var(--paper)", borderColor: "var(--rule)" }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-2xl font-semibold" style={{ color: "var(--ink)" }}>
              {editing.id ? "Edit Strategy" : "Build New Strategy"}
            </h2>
            <button onClick={() => setEditing(null)} className="rounded-lg p-1 hover:opacity-70" style={{ color: "var(--ink-2)" }}>
              <X size={20} />
            </button>
          </div>

          {/* Name + Description */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Name</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. RSI Dip Buy"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Family</Label>
              <Select value={editing.family} onValueChange={(v) => setEditing({ ...editing, family: v })}>
                <SelectTrigger className="font-mono text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FAMILIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mb-4">
            <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Description</Label>
            <Textarea
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="What does this strategy do?"
              className="text-sm"
              rows={2}
            />
          </div>

          {/* Timeframes */}
          <div className="mb-4">
            <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Timeframes</Label>
            <div className="flex gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => {
                    const tfs = editing.timeframes.includes(tf)
                      ? editing.timeframes.filter((t) => t !== tf)
                      : [...editing.timeframes, tf];
                    setEditing({ ...editing, timeframes: tfs });
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-1 text-xs font-mono transition-all",
                    editing.timeframes.includes(tf)
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "hover:opacity-70"
                  )}
                  style={!editing.timeframes.includes(tf) ? { borderColor: "var(--rule)", color: "var(--ink-2)" } : undefined}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Entry Conditions */}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>
                Entry Conditions ({editing.rules.entry.conditions.length})
              </Label>
              <div className="flex items-center gap-2">
                <Select
                  value={editing.rules.entry.logic}
                  onValueChange={(v) => setEditing({
                    ...editing,
                    rules: { ...editing.rules, entry: { ...editing.rules.entry, logic: v as "and" | "or" } }
                  })}
                >
                  <SelectTrigger className="h-7 w-20 text-xs font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and">ALL (AND)</SelectItem>
                    <SelectItem value="or">ANY (OR)</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => setEditing({
                  ...editing,
                  rules: {
                    ...editing.rules,
                    entry: { ...editing.rules.entry, conditions: [...editing.rules.entry.conditions, emptyCondition()] }
                  }
                })}>
                  <Plus size={12} /> Add
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {editing.rules.entry.conditions.map((cond, i) => (
                <ConditionRow
                  key={i}
                  condition={cond}
                  onChange={(c) => {
                    const conds = [...editing.rules.entry.conditions];
                    conds[i] = c;
                    setEditing({ ...editing, rules: { ...editing.rules, entry: { ...editing.rules.entry, conditions: conds } } });
                  }}
                  onDelete={() => {
                    const conds = editing.rules.entry.conditions.filter((_, idx) => idx !== i);
                    setEditing({ ...editing, rules: { ...editing.rules, entry: { ...editing.rules.entry, conditions: conds } } });
                  }}
                />
              ))}
              {editing.rules.entry.conditions.length === 0 && (
                <p className="text-xs italic" style={{ color: "var(--ink-2)" }}>No conditions. Add at least one.</p>
              )}
            </div>
          </div>

          {/* Exit + Score */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Stop Loss</Label>
              <div className="flex gap-2">
                <Select
                  value={editing.rules.exit.stopType}
                  onValueChange={(v) => setEditing({
                    ...editing,
                    rules: { ...editing.rules, exit: { ...editing.rules.exit, stopType: v as any } }
                  })}
                >
                  <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="atr">ATR ×</SelectItem>
                    <SelectItem value="fixed">Fixed %</SelectItem>
                    <SelectItem value="ema">EMA period</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={editing.rules.exit.stopValue}
                  onChange={(e) => setEditing({
                    ...editing,
                    rules: { ...editing.rules, exit: { ...editing.rules.exit, stopValue: parseFloat(e.target.value) || 0 } }
                  })}
                  className="w-20 font-mono text-xs"
                  step="0.1"
                />
              </div>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Target (R:R)</Label>
              <Input
                type="number"
                value={editing.rules.exit.targetValue}
                onChange={(e) => setEditing({
                  ...editing,
                  rules: { ...editing.rules, exit: { ...editing.rules.exit, targetValue: parseFloat(e.target.value) || 0 } }
                })}
                className="font-mono text-xs"
                step="0.5"
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Direction</Label>
              <Select
                value={editing.rules.direction}
                onValueChange={(v) => setEditing({
                  ...editing,
                  rules: { ...editing.rules, direction: v as "long" | "short" | "auto" }
                })}
              >
                <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (infer from conditions)</SelectItem>
                  <SelectItem value="long">Long only</SelectItem>
                  <SelectItem value="short">Short only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-mono uppercase" style={{ color: "var(--ink-2)" }}>Base Score (0-100)</Label>
              <Input
                type="number"
                value={editing.rules.score}
                onChange={(e) => setEditing({
                  ...editing,
                  rules: { ...editing.rules, score: parseInt(e.target.value) || 0 }
                })}
                className="font-mono text-xs"
                min="0"
                max="100"
              />
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save size={14} /> {saving ? "Saving..." : "Save Strategy"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── List view ───────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 100 }}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border p-6" style={{ background: "var(--paper)", borderColor: "var(--rule)" }}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-2xl font-semibold" style={{ color: "var(--ink)" }}>Strategy Builder</h2>
            <p className="text-xs font-mono mt-1" style={{ color: "var(--ink-2)" }}>
              Build custom strategies from the UI — no code needed
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:opacity-70" style={{ color: "var(--ink-2)" }}>
            <X size={20} />
          </button>
        </div>

        <Button onClick={() => setEditing(emptyStrategy())} className="mb-4 w-full">
          <Wand2 size={14} /> Build New Strategy
        </Button>

        {loading ? (
          <p className="text-center text-sm" style={{ color: "var(--ink-2)" }}>Loading...</p>
        ) : strategies.length === 0 ? (
          <div className="rounded-xl border p-12 text-center" style={{ borderColor: "var(--rule)", background: "var(--paper-2)" }}>
            <Wand2 className="h-10 w-10 mx-auto mb-4 opacity-20" style={{ color: "var(--ink-2)" }} />
            <p className="font-serif text-lg italic" style={{ color: "var(--ink-2)" }}>
              No custom strategies yet.
            </p>
            <p className="font-mono text-[10px] mt-2" style={{ color: "var(--ink-2)" }}>
              Click "Build New Strategy" to create your first one.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {strategies.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3",
                  s.enabled ? "border-emerald-500/20" : "opacity-50"
                )}
                style={{ background: "var(--paper)" }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-sm font-semibold" style={{ color: "var(--ink)" }}>{s.name}</span>
                    <span className="rounded-full px-2 py-0.5 text-[9px] font-mono uppercase" style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}>
                      {s.family}
                    </span>
                    <span className="font-mono text-[9px]" style={{ color: "var(--ink-2)" }}>
                      {s.timeframes.join(" · ").toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-2)" }}>
                    {s.description || "No description"}
                  </p>
                  <p className="font-mono text-[9px] mt-0.5" style={{ color: "var(--ink-2)" }}>
                    {s.rules.entry.conditions.length} conditions · {s.rules.entry.logic.toUpperCase()} · score {s.rules.score} · {s.rules.direction}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggle(s)}
                    className={cn(
                      "rounded-lg p-1.5 transition-colors",
                      s.enabled ? "text-emerald-500 hover:bg-emerald-500/10" : "hover:opacity-70"
                    )}
                    style={!s.enabled ? { color: "var(--ink-2)" } : undefined}
                    title={s.enabled ? "Disable" : "Enable"}
                  >
                    <Power size={14} />
                  </button>
                  <button
                    onClick={() => setEditing(s)}
                    className="rounded-lg p-1.5 hover:opacity-70"
                    style={{ color: "var(--ink-2)" }}
                    title="Edit"
                  >
                    <Wand2 size={14} />
                  </button>
                  <button
                    onClick={() => s.id && handleDelete(s.id)}
                    className="rounded-lg p-1.5 hover:bg-rose-500/10 hover:text-rose-500"
                    style={{ color: "var(--ink-2)" }}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Condition Row ───────────────────────────────────────────────────────────

function ConditionRow({
  condition, onChange, onDelete,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onDelete: () => void;
}) {
  const ind = INDICATORS.find((i) => i.value === condition.indicator);

  return (
    <div className="flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: "var(--rule)", background: "var(--paper-2)" }}>
      <Select
        value={condition.indicator}
        onValueChange={(v) => {
          const newInd = INDICATORS.find((i) => i.value === v)!;
          onChange({
            ...condition,
            indicator: v as any,
            period: newInd.needsPeriod ? newInd.defaultPeriod : undefined,
          });
        }}
      >
        <SelectTrigger className="h-8 w-28 text-xs font-mono"><SelectValue /></SelectTrigger>
        <SelectContent>
          {INDICATORS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {ind?.needsPeriod && (
        <Input
          type="number"
          value={condition.period ?? ""}
          onChange={(e) => onChange({ ...condition, period: parseInt(e.target.value) || undefined })}
          className="h-8 w-16 font-mono text-xs"
          placeholder="period"
        />
      )}

      <Select
        value={condition.comparator}
        onValueChange={(v) => onChange({ ...condition, comparator: v as any })}
      >
        <SelectTrigger className="h-8 w-36 text-xs font-mono"><SelectValue /></SelectTrigger>
        <SelectContent>
          {COMPARATORS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select
        value={typeof condition.value === "string" ? condition.value : "__custom__"}
        onValueChange={(v) => {
          if (v === "__custom__") {
            onChange({ ...condition, value: 0 });
          } else {
            onChange({ ...condition, value: v });
          }
        }}
      >
        <SelectTrigger className="h-8 flex-1 text-xs font-mono"><SelectValue /></SelectTrigger>
        <SelectContent>
          {VALUE_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          <SelectItem value="__custom__">Custom number...</SelectItem>
        </SelectContent>
      </Select>

      {typeof condition.value === "number" && (
        <Input
          type="number"
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: parseFloat(e.target.value) || 0 })}
          className="h-8 w-20 font-mono text-xs"
          step="0.1"
        />
      )}

      <button onClick={onDelete} className="rounded p-1 hover:bg-rose-500/10 hover:text-rose-500" style={{ color: "var(--ink-2)" }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
