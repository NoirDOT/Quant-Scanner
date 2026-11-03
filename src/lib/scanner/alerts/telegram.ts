// src/lib/scanner/alerts/telegram.ts
import { Telegraf } from "telegraf";
import type { ScanSignal } from "../types";

let bot: Telegraf | null = null;
let botToken: string | null = null;
const subscriptions = new Map<string, string[]>(); // recipientId -> strategyKeys

export function initTelegram(token: string) {
  if (bot && token === botToken) return bot;
  bot = new Telegraf(token);
  botToken = token;
  bot.start((ctx) => ctx.reply("Trading scanner bot online. Use /subscribe <strategyKeys> to start receiving signals."));
  bot.command("subscribe", (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length === 0) {
      ctx.reply("Usage: /subscribe <strategyKey1> [strategyKey2 ...]\ne.g. /subscribe trend-ema-1h ict-2022-model");
      return;
    }
    subscriptions.set(String(ctx.chat.id), args);
    ctx.reply(`Subscribed to: ${args.join(", ")}`);
  });
  bot.command("unsubscribe", (ctx) => {
    subscriptions.delete(String(ctx.chat.id));
    ctx.reply("Unsubscribed from all scanner alerts.");
  });
  bot.launch().catch((err) => console.error("[telegram] launch error:", err));
  return bot;
}

export async function sendTelegram(chatId: string, message: string) {
  if (!bot) throw new Error("Telegram bot not initialized");
  await bot.telegram.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

export function signalToTelegramMessage(s: ScanSignal): string {
  return [
    `*${s.strategyLabel}*`,
    `${s.symbol} (${s.timeframe.toUpperCase()})`,
    `Direction: *${s.direction.toUpperCase()}*  Score: *${s.score.toFixed(0)}/100*`,
    s.entryPrice ? `Entry: ${s.entryPrice}` : "",
    s.stopPrice ? `Stop: ${s.stopPrice}` : "",
    s.targetPrice ? `Target: ${s.targetPrice}` : "",
    "",
    "Reasons:",
    ...s.reasons.map((r) => `• ${r}`),
  ].filter(Boolean).join("\n");
}

export function getSubscribedRecipients(strategyKey: string): string[] {
  const out: string[] = [];
  for (const [chatId, keys] of subscriptions) {
    if (keys.includes(strategyKey)) out.push(chatId);
  }
  return out;
}
