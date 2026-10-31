import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// Works with both SQLite (local: file:./db/scanner.db) and Postgres (Vercel)
// The provider in schema.prisma must match DATABASE_URL:
//   - SQLite:   provider = "sqlite"   DATABASE_URL="file:./db/scanner.db"
//   - Postgres: provider = "postgresql" DATABASE_URL="postgresql://..."
//
// For Vercel, set provider to "postgresql" in schema.prisma + DATABASE_URL env var.
// For local, set provider to "sqlite" + DATABASE_URL="file:./db/scanner.db"
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
