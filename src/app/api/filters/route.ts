// app/api/filters/route.ts
import { NextResponse } from "next/server";
import { FILTERS_INFO } from "@/lib/scanner/filters";

export async function GET() {
  return NextResponse.json({
    layer: 2,
    description: "Boolean condition checks — return Candidate (no entry/stop/target)",
    count: FILTERS_INFO.length,
    filters: FILTERS_INFO,
  });
}
