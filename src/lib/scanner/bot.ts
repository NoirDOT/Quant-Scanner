// src/lib/scanner/bot.ts
// Discord bot client — uses a bot token (not a webhook) to read + delete
// messages. Webhooks can only SEND; bots can also READ, DELETE, and react.
//
// Used by the nightly cleanup job to delete old signal messages from the
// channel so it doesn't get cluttered (the user had to delete the entire
// channel last time because of message buildup).

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID ?? "";

const API_BASE = "https://discord.com/api/v10";

interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string; bot: boolean };
  embeds?: unknown[];
}

/**
 * Fetch the most recent messages from the configured channel.
 * Discord returns up to 100 messages per call; we paginate to get more.
 */
export async function fetchRecentMessages(limit = 100): Promise<DiscordMessage[]> {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error("[bot] DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set");
    return [];
  }

  const all: DiscordMessage[] = [];
  let before: string | undefined;

  // Discord allows max 100 messages per request
  while (all.length < limit) {
    const params = new URLSearchParams({ limit: "100" });
    if (before) params.set("before", before);

    const res = await fetch(
      `${API_BASE}/channels/${CHANNEL_ID}/messages?${params}`,
      {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!res.ok) {
      console.error(`[bot] fetch messages failed: HTTP ${res.status}`);
      break;
    }

    const batch: DiscordMessage[] = await res.json();
    if (batch.length === 0) break;

    all.push(...batch);
    before = batch[batch.length - 1].id;

    // Stop if we got fewer than 100 (reached the beginning of the channel)
    if (batch.length < 100) break;
  }

  return all.slice(0, limit);
}

/**
 * Bulk-delete messages by ID. Discord allows up to 100 messages per
 * bulk-delete call, and messages must be newer than 2 weeks (14 days).
 * Older messages must be deleted one at a time.
 *
 * Returns the count of deleted messages.
 */
export async function bulkDeleteMessages(messageIds: string[]): Promise<number> {
  if (!BOT_TOKEN || !CHANNEL_ID) return 0;
  if (messageIds.length === 0) return 0;

  let deleted = 0;

  // Chunk into groups of 100 (Discord's bulk-delete limit)
  for (let i = 0; i < messageIds.length; i += 100) {
    const chunk = messageIds.slice(i, i + 100);

    // Try bulk delete first (works for messages < 14 days old)
    const res = await fetch(
      `${API_BASE}/channels/${CHANNEL_ID}/messages/bulk-delete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: chunk }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (res.ok) {
      deleted += chunk.length;
    } else if (res.status === 400) {
      // Some messages are older than 14 days — delete them one at a time
      console.log("[bot] bulk delete failed (messages too old), falling back to individual deletes");
      for (const id of chunk) {
        const singleRes = await fetch(
          `${API_BASE}/channels/${CHANNEL_ID}/messages/${id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (singleRes.ok) deleted++;
        else if (singleRes.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = parseFloat(res.headers.get("X-RateLimit-Reset-After") ?? "1");
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
        }
      }
    } else if (res.status === 429) {
      // Rate limited — wait and retry
      const retryAfter = parseFloat(res.headers.get("X-RateLimit-Reset-After") ?? "1");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      // Retry this chunk
      i -= 100;
      continue;
    } else {
      console.error(`[bot] bulk delete failed: HTTP ${res.status}`);
    }

    // Small delay between chunks to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  return deleted;
}

/**
 * Delete all messages older than `maxAgeHours` from the configured channel.
 * Used by the nightly cleanup job.
 *
 * Returns { deleted, total }.
 */
export async function deleteOldMessages(maxAgeHours = 24): Promise<{ deleted: number; total: number }> {
  const messages = await fetchRecentMessages(500); // fetch up to 500 recent messages
  if (messages.length === 0) return { deleted: 0, total: 0 };

  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const oldMessages = messages.filter((m) => new Date(m.timestamp).getTime() < cutoff);

  if (oldMessages.length === 0) {
    console.log(`[bot] no messages older than ${maxAgeHours}h found`);
    return { deleted: 0, total: messages.length };
  }

  const toDelete = oldMessages.map((m) => m.id);
  const deleted = await bulkDeleteMessages(toDelete);

  console.log(`[bot] deleted ${deleted}/${oldMessages.length} old messages (out of ${messages.length} total)`);
  return { deleted, total: messages.length };
}

// ─── Daily P&L summary ────────────────────────────────────────────────────

import type { PaperTradeSummary } from "./paperTrade";

/**
 * Post a daily P&L summary embed to the Discord channel.
 * Shows: account balance, ROI, win rate, today's closed trades, open positions.
 */
export async function postDailySummary(summary: PaperTradeSummary): Promise<boolean> {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;

  const a = summary.account;
  const pnlEmoji = a.totalRealizedPnl >= 0 ? "🟢" : "🔴";
  const roiEmoji = a.roi >= 0 ? "📈" : "📉";

  const lines: string[] = [
    `**Balance:** $${a.currentBalance.toFixed(2)} / $${a.startingBalance.toFixed(2)} start`,
    `**ROI:** ${roiEmoji} ${a.roi.toFixed(2)}%`,
    `**Total P&L:** ${pnlEmoji} $${a.totalRealizedPnl.toFixed(2)} (${a.totalRealizedR >= 0 ? "+" : ""}${a.totalRealizedR.toFixed(1)}R)`,
    `**Win Rate:** ${a.winRate.toFixed(1)}% (${a.totalWins}W / ${a.totalLosses}L / ${a.totalTimeouts}T)`,
    `**Open Risk:** $${a.openRisk.toFixed(2)} (${summary.openTrades.length} open trades)`,
  ];

  // Today's closed trades
  if (summary.todayClosed.length > 0) {
    lines.push("", `**Today's Closed Trades (${summary.todayClosed.length}):**`, "```");
    lines.push("  PAIR           DIR    OUTCOME   R       P&L");
    lines.push("  ─────────────  ─────  ────────  ──────  ─────────");
    for (const t of summary.todayClosed.slice(0, 10)) {
      const pair = t.symbol.padEnd(14).slice(0, 14);
      const dir = t.direction.toUpperCase().padEnd(5).slice(0, 5);
      const outcome = t.outcome.padEnd(8).slice(0, 8);
      const r = (t.realizedR >= 0 ? "+" : "") + t.realizedR.toFixed(1);
      const pnl = (t.realizedPnl >= 0 ? "+" : "") + "$" + t.realizedPnl.toFixed(0);
      lines.push(`  ${pair}  ${dir}  ${outcome}  ${r.padStart(6)}  ${pnl.padStart(10)}`);
    }
    lines.push("```");
  } else {
    lines.push("", "*No trades closed today.*");
  }

  // Open positions
  if (summary.openTrades.length > 0) {
    lines.push("", `**Open Positions (${summary.openTrades.length}):**`, "```");
    lines.push("  PAIR           DIR    ENTRY       STOP        TARGET      SCORE");
    lines.push("  ─────────────  ─────  ──────────  ──────────  ──────────  ─────");
    for (const t of summary.openTrades.slice(0, 10)) {
      const pair = t.symbol.padEnd(14).slice(0, 14);
      const dir = t.direction.toUpperCase().padEnd(5).slice(0, 5);
      const entry = t.entryPrice.toFixed(4).padStart(10).slice(0, 10);
      const stop = t.stopPrice.toFixed(4).padStart(10).slice(0, 10);
      const target = t.targetPrice.toFixed(4).padStart(10).slice(0, 10);
      const score = String(Math.round(t.score)).padStart(5).slice(0, 5);
      lines.push(`  ${pair}  ${dir}  ${entry}  ${stop}  ${target}  ${score}`);
    }
    lines.push("```");
  }

  lines.push("", "_Daily summary posted by the paper-trading bot_");

  const embed = {
    title: `📊  Daily P&L Summary`,
    description: lines.join("\n"),
    color: a.totalRealizedPnl >= 0 ? 0x22c55e : 0xef4444,
    timestamp: new Date().toISOString(),
    footer: { text: "Quant Scanner · paper trading · daily report" },
  };

  try {
    const res = await fetch(`${API_BASE}/channels/${CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error("[bot] postDailySummary error:", err);
    return false;
  }
}
