// src/app/api/eas/route.ts
import { NextResponse } from "next/server";
import { EA_STRATEGIES, EA_CATEGORIES } from "@/lib/scanner/strategies/eas/definitions";
import { promises as fs } from "fs";

export async function GET() {
  // Read each EA source file (first 60 lines) for inspection
  const eaWithSource = await Promise.all(
    EA_STRATEGIES.map(async (ea) => {
      let sourcePreview = "";
      try {
        const raw = await fs.readFile(ea.sourceFile, "utf-8");
        sourcePreview = raw.slice(0, 3000); // first 3000 chars = header doc + inputs
      } catch {
        // ignore
      }
      return { ...ea, sourcePreview };
    })
  );
  return NextResponse.json({
    total: EA_STRATEGIES.length,
    categories: EA_CATEGORIES,
    eas: eaWithSource,
  });
}
