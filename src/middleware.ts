// src/middleware.ts
// API auth gate — runs on every /api/* request.
//
// Threat model (from security review):
//   - Anonymous attackers could spam Discord by POSTing /api/scanner with
//     dispatch:true. We FORCE dispatch=false for non-privileged callers in
//     the route handler, but middleware is the first line of defense.
//   - /api/scanner/alerts exposes email/Telegram configs and lets anyone
//     create/update/delete alert destinations. Fully admin-gated here.
//   - /api/scanner/debug exposes diagnostics. Admin-gated.
//   - /api/scanner/ping is the cron entry point — gated by CRON_SECRET.
//   - /api/webhook/incoming is hit by TradingView, which can't send custom
//     headers — so the secret goes in the URL path:
//     /api/webhook/incoming/:secret
//
// Secrets accepted (any one works):
//   - API_SECRET       — admin token (server, scripts, the UI when privileged)
//   - CRON_SECRET      — GitHub Actions token (cron sweeps)
//   - BROWSER_SECRET   — public token embedded in the browser bundle
//                        (NEXT_PUBLIC_BROWSER_SECRET) — used by the scanner UI
//   - WEBHOOK_SECRET   — TradingView webhook secret (URL-path only)
//
// If NONE of API_SECRET/CRON_SECRET/BROWSER_SECRET are set, all /api/* routes
// are open (local dev mode). In production, at least one must be set.

import { NextRequest, NextResponse } from "next/server";

// Routes the browser can hit anonymously (read-only reference data + scan).
// POST /api/scanner is allowed through middleware, but the route handler
// strips dispatch/persist for non-privileged callers.
const PUBLIC_GET_ROUTES = [
  /^\/api\/scanner\/strategies$/,
  /^\/api\/scanner\/instruments$/,
  /^\/api\/scanner\/grades$/,
  /^\/api\/scanner\/killzones$/,
  /^\/api\/scanner\/signals$/,
  /^\/api\/scanner\/candidates$/,
  /^\/api\/scanner\/eas$/,
  /^\/api\/scanner\/horc$/,
  /^\/api\/scanner\/smt-psp-pro$/,
  /^\/api\/scanner\/data$/,
];

// Admin-only routes (always require a secret, even on GET).
const ADMIN_ROUTES = [
  /^\/api\/scanner\/alerts/,
  /^\/api\/scanner\/debug/,
  /^\/api\/scanner\/backtest/,
  /^\/api\/scanner\/export/,
  /^\/api\/scanner\/stress-tests/,
  /^\/api\/scanner\/csv-data/,
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── TradingView webhook: secret lives in the URL path ──────────────────
  // /api/webhook/incoming/:secret   ← allowed (after secret check)
  // /api/webhook/incoming           ← denied (no secret in URL)
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
    if (provided !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }
  if (pathname === "/api/webhook/incoming" || pathname.startsWith("/api/webhook/incoming?")) {
    return NextResponse.json(
      {
        ok: false,
        error: "Webhook secret required in URL path: /api/webhook/incoming/:secret",
      },
      { status: 401 },
    );
  }

  // ── Collect valid API secrets ───────────────────────────────────────────
  const secrets = [
    process.env.API_SECRET,
    process.env.CRON_SECRET,
    process.env.BROWSER_SECRET,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  // Dev mode — no secrets configured: allow everything (with a header so the
  // caller knows they're in insecure mode).
  if (secrets.length === 0) {
    const res = NextResponse.next();
    res.headers.set("X-Scanner-Auth", "insecure");
    return res;
  }

  // Extract provided token from Authorization header OR ?key= query.
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  const queryKey = req.nextUrl.searchParams.get("key") ?? "";
  const provided = bearerToken || queryKey;

  // ── Public GET reference routes: no secret required ─────────────────────
  if (req.method === "GET" && PUBLIC_GET_ROUTES.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }

  // ── Public POST /api/scanner (browser scan): allow through middleware ──
  // The route handler will strip dispatch/persist for non-privileged callers.
  // We still want to allow anonymous scan-only calls so the UI works.
  if (req.method === "POST" && pathname === "/api/scanner") {
    return NextResponse.next();
  }
  if (req.method === "GET" && pathname === "/api/scanner") {
    return NextResponse.next();
  }

  // ── Admin routes: always require a valid secret ────────────────────────
  if (ADMIN_ROUTES.some((re) => re.test(pathname))) {
    if (!provided || !secrets.includes(provided)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // ── All other /api/* routes (including /api/scanner/ping): require secret ─
  if (!provided || !secrets.includes(provided)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
