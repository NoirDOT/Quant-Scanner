// src/app/api/alerts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { initTelegram, initEmail } from "@/lib/scanner/alerts";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
  const configs = await db.alertConfigScanner.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const logs = await db.alertLogScanner.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ configs, logs });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action } = body;
  if (action === "create") {
    const cfg = await db.alertConfigScanner.create({
      data: {
        name: body.name || `Alert ${body.channel}`,
        channel: body.channel,
        destination: body.recipient,
        strategyTypes: Array.isArray(body.strategyKeys) ? body.strategyKeys.join(",") : body.strategyKeys,
        minScore: body.minScore ?? 70,
        enabled: body.active ?? true,
      } as any,
    });
    // Initialize transport if creds provided
    if (body.channel === "telegram" && body.telegramToken) {
      try { initTelegram(body.telegramToken); } catch (e) { console.error("[alerts] init telegram:", e); }
    }
    if (body.channel === "email" && body.emailConfig) {
      try { initEmail(body.emailConfig); } catch (e) { console.error("[alerts] init email:", e); }
    }
    return NextResponse.json({ config: cfg });
  }
  if (action === "update") {
    const cfg = await db.alertConfigScanner.update({
      where: { id: body.id },
      data: {
        ...(body.recipient !== undefined ? { destination: body.recipient } : {}),
        ...(body.strategyKeys !== undefined ? { strategyTypes: Array.isArray(body.strategyKeys) ? body.strategyKeys.join(",") : body.strategyKeys } : {}),
        ...(body.minScore !== undefined ? { minScore: body.minScore } : {}),
        ...(body.active !== undefined ? { enabled: body.active } : {}),
      },
    });
    return NextResponse.json({ config: cfg });
  }
  if (action === "delete") {
    await db.alertConfigScanner.delete({ where: { id: body.id } });
    return NextResponse.json({ ok: true });
  }
  if (action === "test") {
    return NextResponse.json({ message: "Test alert queued (requires initialized transport)" });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
