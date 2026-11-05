// /api/scanner/custom-strategies
// CRUD for user-created strategies. These are evaluated at scan time by
// the custom strategy engine alongside the built-in scanners.
//
// GET  /api/scanner/custom-strategies        → list all
// POST /api/scanner/custom-strategies        → create
// PUT  /api/scanner/custom-strategies/:id    → update
// DELETE /api/scanner/custom-strategies/:id  → delete
//
// Auth: requires API_SECRET (or CRON_SECRET). Browser can't create strategies
// without admin auth — this is a privileged operation.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return true; // dev mode
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

const ConditionSchema = z.object({
  indicator: z.enum(["ema", "rsi", "adx", "macd", "supertrend", "price", "volume"]),
  period: z.number().int().min(1).max(500).optional(),
  comparator: z.enum([">", "<", ">=", "<=", "crosses_above", "crosses_below", "between"]),
  value: z.union([z.string(), z.number()]),
  value2: z.number().optional(),
});

const RuleTreeSchema = z.object({
  entry: z.object({
    logic: z.enum(["and", "or"]),
    conditions: z.array(ConditionSchema).min(1).max(10),
  }),
  exit: z.object({
    stopType: z.enum(["atr", "fixed", "ema"]),
    stopValue: z.number().min(0),
    targetType: z.literal("rr"),
    targetValue: z.number().min(0.5).max(20),
  }),
  score: z.number().int().min(0).max(100).default(65),
  direction: z.enum(["long", "short", "auto"]).default("auto"),
});

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  family: z.enum(["trend", "ict", "trader", "ea", "horc", "community"]).default("trend"),
  timeframes: z.array(z.enum(["1h", "2h", "4h", "1d", "1w"])).min(1).max(5),
  rules: RuleTreeSchema,
  enabled: z.boolean().default(true),
}).strict();

// GET — list all custom strategies
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await db.customStrategy.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      ok: true,
      strategies: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        family: r.family,
        enabled: r.enabled,
        timeframes: JSON.parse(r.timeframesJson || "[]"),
        rules: JSON.parse(r.rulesJson || "{}"),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[custom-strategies] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

// POST — create a custom strategy
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Generate a key from the name (slugify)
  const key = `custom-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  try {
    const row = await db.customStrategy.create({
      data: {
        key,
        name: body.name,
        description: body.description ?? "",
        family: body.family,
        enabled: body.enabled,
        timeframesJson: JSON.stringify(body.timeframes),
        rulesJson: JSON.stringify(body.rules),
      },
    });
    return NextResponse.json({
      ok: true,
      strategy: {
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        family: row.family,
        enabled: row.enabled,
        timeframes: body.timeframes,
        rules: body.rules,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "A strategy with this name already exists" },
        { status: 409 },
      );
    }
    console.error("[custom-strategies] POST error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
