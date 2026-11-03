// scripts/swap-provider.ts
// Flips prisma/schema.prisma's datasource provider based on DATABASE_URL.
//   DATABASE_URL="file:./db/scanner.db"     → sqlite (local dev)
//   DATABASE_URL="postgresql://..."          → postgresql (Vercel)
//
// Run before `prisma generate` so Vercel deploys need no manual schema edit.
// Safe to run repeatedly — only rewrites when needed.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
if (!existsSync(schemaPath)) {
  console.error("[swap-provider] prisma/schema.prisma not found");
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? "";
const wantsPostgres = url.startsWith("postgres") || url.startsWith("postgresql");

let schema = readFileSync(schemaPath, "utf8");
const currentProvider = schema.match(/provider\s*=\s*"(\w+)"/)?.[1] ?? "unknown";

if (wantsPostgres && currentProvider !== "postgresql") {
  schema = schema.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  writeFileSync(schemaPath, schema);
  console.log(`[swap-provider] ${currentProvider} → postgresql (DATABASE_URL starts with postgres)`);
} else if (!wantsPostgres && currentProvider !== "sqlite") {
  schema = schema.replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"');
  writeFileSync(schemaPath, schema);
  console.log(`[swap-provider] ${currentProvider} → sqlite (DATABASE_URL is local file)`);
} else {
  console.log(`[swap-provider] provider already correct (${currentProvider})`);
}
