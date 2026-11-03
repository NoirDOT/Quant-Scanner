// src/app/api/killzones/route.ts
import { NextResponse } from "next/server";
import { activeKillzones, nextKillzone, KILLZONES } from "@/lib/scanner/ict/killzones";

export async function GET() {
  return NextResponse.json({
    now: new Date().toISOString(),
    active: activeKillzones(),
    next: nextKillzone(),
    all: KILLZONES,
  });
}
