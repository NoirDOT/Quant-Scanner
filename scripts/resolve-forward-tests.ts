// scripts/resolve-forward-tests.ts
// Nightly job that replays subsequent candles for each unresolved
// ForwardTestSignal to determine whether the STOP or TARGET hit first,
// then records the R multiple + outcome.
//
// Run via a second GitHub Actions cron (or manually):
//   bun run scripts/resolve-forward-tests.ts
//
// Calls the production /api/scanner/forward-tests/resolve endpoint with
// API_SECRET as Bearer token. The endpoint does the actual replay work
// in-process (no self-fetch).

const API_SECRET = process.env.API_SECRET;
const SCANNER_URL = process.env.SCANNER_URL ?? "https://quant-scanner-g7r7.vercel.app";

if (!API_SECRET) {
  console.error("API_SECRET env var required (used as Bearer token for the resolve endpoint)");
  process.exit(1);
}

async function main() {
  console.log(`=== Resolving forward-test signals at ${new Date().toISOString()} ===`);
  const url = `${SCANNER_URL}/api/scanner/forward-tests/resolve`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_SECRET}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  console.log(`HTTP ${res.status}`, JSON.stringify(json));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error("resolve-forward-tests failed:", e);
  process.exit(1);
});
