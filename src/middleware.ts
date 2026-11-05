// src/middleware.ts
// API auth gate — runs on every /api/* request.
//
// Threat model (from second security review):
//   - NEXT_PUBLIC_BROWSER_SECRET is in the JS bundle. If middleware accepted
//     it for admin routes, anyone opening dev tools gets admin. So
//     BROWSER_SECRET is ONLY accepted for the scan route (where dispatch/
//     persist are still gated by the route handler).
//   - Anonymous scans are uncapped — anyone can burn 120s of function time.
//     Mitigated by a simple in-memory rate limit on POST /api/scanner.
//   - `?key=` query puts secrets in URLs and logs — removed. Only the
//     Authorization: Bearer header is accepted (except for the TradingView
//     webhook, which can't send headers — secret goes in the URL path).
//   - Fails open in dev (no secrets set), fails CLOSED in production.
//
// Secrets:
//   - API_SECRET       — admin token (server, scripts, resolve endpoint)
//   - CRON_SECRET      — GitHub Actions cron token (ping endpoint)
//   - BROWSER_SECRET   — UI token (scan endpoint only — NOT admin routes)
//   - WEBHOOK_SECRET   — TradingView webhook (URL-path only)

import { NextRequest, NextResponse } from "next/server";

// In-memory rate limiter for POST /api/scanner — caps per-IP manual scans.
// Serverless instances are ephemeral so this is best-effort, not a hard limit,
// but it stops a single instance from being hammered.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 min
const RATE_LIMIT_MAX_PER_IP = 4;        // 4 scans/min/IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_PER_IP;
}

// Constant-time string comparison (avoids timing side-channel on secret match).
// Returns true if the two strings are equal. Length is leaked but that's fine —
// secrets are fixed-length hex strings.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isProduction(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

// Routes the browser can hit anonymously (read-only reference data).
const PUBLIC_GET_ROUTES = [
  /^\/api\/scanner\/strategies$/,
  /^\/api\/scanner\/instruments$/,
  /^\/api\/scanner\/grades$/,
  /^\/api\/scanner\/killzones$/,
  /^\/api\/scanner\/signals$/,
  /^\/api\/scanner\/candidates$/,
  /^\/api\/scanner\/horc$/,
  /^\/api\/scanner\/smt-psp-pro$/,
  /^\/api\/scanner\/data$/,
  // NOTE: /api/scanner/eas is NOT here — it reads EA source files. Admin-only.
];

// Admin-only routes — require API_SECRET or CRON_SECRET (NOT BROWSER_SECRET,
// which is public in the JS bundle).
const ADMIN_ROUTES = [
  /^\/api\/scanner\/alerts/,
  /^\/api\/scanner\/debug/,
  /^\/api\/scanner\/backtest/,
  /^\/api\/scanner\/export/,
  /^\/api\/scanner\/stress-tests/,
  /^\/api\/scanner\/csv-data/,
  /^\/api\/scanner\/eas/,
  /^\/api\/scanner\/forward-tests/,
];

// Bearer-token check against a list of allowed secrets, constant-time.
function tokenMatches(provided: string, secrets: string[]): boolean {
  if (!provided || secrets.length === 0) return false;
  let matched = false;
  for (const s of secrets) {
    if (safeEqual(provided, s)) matched = true;
  }
  return matched;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── TradingView webhook: secret lives in the URL path ──────────────────
  const webhookMatch = pathname.match(/^\/api\/webhook\/incoming\/([^/?]+)$/);
  if (webhookMatch) {
    const provided = decodeURIComponent(webhookMatch[1]);
    const expected = process.env.WEBHOOK_SECRET;
    if (!expected) {
      return NextResponse.json(
        { ok: false, error: "WEBHOOK_SECRET not configured" },
        { status: 500 },
      );
    }
    if (!safeEqual(provided, expected)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }
  if (pathname === "/api/webhook/incoming" || pathname.startsWith("/api/webhook/incoming?")) {
    return NextResponse.json(
      { ok: false, error: "Webhook secret required in URL path: /api/webhook/incoming/:secret" },
      { status: 401 },
    );
  }

  // ── Collect valid API secrets ───────────────────────────────────────────
  const adminSecrets = [process.env.API_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  const allSecrets = adminSecrets;

  // ── Fail-closed in production ───────────────────────────────────────────
  // If no secrets are configured in production, deny everything except the
  // public GET reference routes. In dev, allow everything with a header.
  if (allSecrets.length === 0) {
    if (isProduction()) {
      if (req.method === "GET" && PUBLIC_GET_ROUTES.some((re) => re.test(pathname))) {
        return NextResponse.next();
      }
      return NextResponse.json(
        { ok: false, error: "No API secrets configured — server misconfigured" },
        { status: 500 },
      );
    }
    // Dev mode — no secrets configured
    const res = NextResponse.next();
    res.headers.set("X-Scanner-Auth", "insecure");
    return res;
  }

  // Extract provided token from Authorization: Bearer header ONLY (no ?key=).
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "");

  // ── Public GET reference routes: no secret required ─────────────────────
  if (req.method === "GET" && PUBLIC_GET_ROUTES.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }

  // ── Public POST /api/scanner (browser scan): allow through middleware ──
  // The route handler strips dispatch/persist for non-privileged callers.
  // Apply a simple in-memory rate limit per IP to prevent abuse.
  if (req.method === "POST" && pathname === "/api/scanner") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (rateLimited(ip)) {
      return NextResponse.json(
        { ok: false, error: "Rate limit exceeded — max 4 scans/min/IP" },
        { status: 429 },
      );
    }
    return NextResponse.next();
  }
  if (req.method === "GET" && pathname === "/api/scanner") {
    return NextResponse.next();
  }

  // ── Admin routes: require API_SECRET or CRON_SECRET (NOT BROWSER_SECRET) ─
  if (ADMIN_ROUTES.some((re) => re.test(pathname))) {
    if (!tokenMatches(provided, adminSecrets)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // ── All other /api/* routes (including /api/scanner/ping): require any secret ─
  if (!tokenMatches(provided, allSecrets)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
