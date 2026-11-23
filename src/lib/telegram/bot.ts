import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Bot do Telegram (API oficial, gratuita). TELEGRAM_BOT_TOKEN vem do @BotFather.
 * Em testes locais, TELEGRAM_API_BASE_URL pode apontar para um servidor simulado
 * em localhost (ignorado fora de APP_ENV=development).
 */
export function telegramConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return null;
  const o = env.TELEGRAM_API_BASE_URL;
  const base = o && (env.APP_ENV ?? "development") === "development" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o)
    ? o.replace(/\/$/, "")
    : "https://api.telegram.org";
  return { token, secret, base, username: env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? null };
}

export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function telegramSend(chatId: number | string, text: string, replyTo?: number): Promise<number | null> {
  const cfg = telegramConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.base}/bot${cfg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number } };
  return j.ok && j.result?.message_id ? j.result.message_id : null;
}
