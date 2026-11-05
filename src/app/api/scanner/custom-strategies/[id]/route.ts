// /api/scanner/custom-strategies/[id]
// Update + delete for individual custom strategies.
//
// PUT    → update the strategy (name, rules, enabled, etc.)
// DELETE → remove the strategy

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  const secrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) return true;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && secrets.includes(token);
}

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  family: z.enum(["trend", "ict", "trader", "ea", "horc", "community"]).optional(),
  enabled: z.boolean().optional(),
  timeframes: z.array(z.enum(["1h", "2h", "4h", "1d", "1w"])).min(1).max(5).optional(),
  rules: z.any().optional(),
}).strict();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    const data: any = {};
    if (body.name !== undefined) {
      data.name = body.name;
      data.key = `custom-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    }
    if (body.description !== undefined) data.description = body.description;
    if (body.family !== undefined) data.family = body.family;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.timeframes !== undefined) data.timeframesJson = JSON.stringify(body.timeframes);
    if (body.rules !== undefined) data.rulesJson = JSON.stringify(body.rules);

    const row = await db.customStrategy.update({
      where: { id },
      data,
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
        timeframes: JSON.parse(row.timeframesJson || "[]"),
        rules: JSON.parse(row.rulesJson || "{}"),
      },
    });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    console.error("[custom-strategies] PUT error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await db.customStrategy.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    console.error("[custom-strategies] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
