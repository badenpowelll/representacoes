import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeEqual, telegramConfig, telegramSend } from "@/lib/telegram/bot";
import { decryptToken, hasTokenKey } from "@/lib/email/crypto";
import { GoogleAuthRevoked, accessTokenFromRefresh, gmailSend, sendingMode } from "@/lib/email/google";
import { buildMime, toBase64Url } from "@/lib/email/mime";
import { withSignature } from "@/lib/mensagens/templates";
import { SEND_REASON_LABELS } from "@/lib/email/send";

export const dynamic = "force-dynamic";

type Update = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { username?: string };
    reply_to_message?: { message_id: number };
  };
};

const ok = () => NextResponse.json({ ok: true });

/**
 * Webhook do bot. Só aceita chamadas com o segredo combinado com o Telegram
 * (cabeçalho X-Telegram-Bot-Api-Secret-Token) e só em conversa privada.
 *  - "/start CÓDIGO": liga este chat ao usuário que gerou o código em Mensagens.
 *  - Resposta a um aviso: envia o texto por e-mail ao cliente, na mesma conversa.
 */
export async function POST(req: NextRequest) {
  const cfg = telegramConfig();
  if (!cfg || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), cfg.secret)) return new NextResponse(null, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin) return ok();
  const u = (await req.json().catch(() => null)) as Update | null;
  const msg = u?.message;
  if (!u || !msg || msg.chat.type !== "private" || typeof msg.text !== "string") return ok();
  const chat = msg.chat.id;
  const text = msg.text.trim();

  const start = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})$/);
  if (start) {
    const hash = createHash("sha256").update(start[1]).digest("hex");
    const { data } = await admin.rpc("svc_telegram_link", { p_code_hash: hash, p_chat_id: chat, p_username: msg.from?.username ?? null });
    const r = data as { ok: boolean; tenant_name?: string } | null;
    await telegramSend(chat, r?.ok
      ? `Pronto! Este Telegram está ligado ao Rep360 (${r.tenant_name}). Quando um cliente responder um e-mail enviado pelo sistema, você recebe aqui na hora. Para responder, toque em Responder na mensagem e escreva.`
      : "Código inválido ou vencido. Gere um novo em Mensagens, no Rep360.");
    return ok();
  }
  if (/^\/start\b/.test(text)) {
    await telegramSend(chat, "Para ligar este Telegram, abra Mensagens no Rep360 e toque em Ligar Telegram.");
    return ok();
  }
  if (!msg.reply_to_message) {
    await telegramSend(chat, "Para responder a um cliente, toque em Responder na mensagem dele aqui e escreva o texto.");
    return ok();
  }
  if (text.length < 2 || text.length > 4000) {
    await telegramSend(chat, "Mensagem muito curta ou muito longa para enviar.", msg.message_id);
    return ok();
  }

  const { data: prepData, error } = await admin.rpc("svc_telegram_reply_prepare", {
    p_chat_id: chat, p_reply_to_message_id: msg.reply_to_message.message_id, p_body: text, p_update_id: u.update_id,
  });
  const p = prepData as {
    ok: boolean; reason?: string; duplicate?: boolean; status?: string; message_id?: string; tenant_id: string; user_id: string; connection_id: string;
    to: string; subject: string; thread_id: string; in_reply_to: string | null; references: string | null; ciphertext: string | null; from: string;
  } | null;
  if (error || !p) {
    await telegramSend(chat, "Não consegui preparar o envio agora. Tente de novo em instantes.", msg.message_id);
    return ok();
  }
  if (!p.ok) {
    const why = p.reason === "unknown_message" ? "essa mensagem não é um aviso de resposta de cliente"
      : p.reason === "not_linked" ? "este Telegram não está ligado à conta que enviou o e-mail"
      : (SEND_REASON_LABELS[p.reason ?? ""] ?? "o contato não pode receber");
    await telegramSend(chat, `Não enviado: ${why}.`, msg.message_id);
    return ok();
  }
  if (p.duplicate) {
    if (p.status !== "queued") await telegramSend(chat, "Esta resposta já tinha sido enviada.", msg.message_id);
    return ok();
  }

  const record = (status: "sent" | "sandbox" | "failed", providerId: string | null, err: string | null, threadId: string | null) =>
    admin.rpc("svc_email_record_result", {
      p_user: p.user_id, p_tenant: p.tenant_id, p_message: p.message_id, p_status: status, p_provider_id: providerId,
      p_error: err, p_thread_id: threadId,
    });

  if (sendingMode() === "sandbox") {
    await record("sandbox", null, null, p.thread_id);
    await telegramSend(chat, `Modo de teste: a resposta para ${p.to} foi registrada no histórico, mas não saiu.`, msg.message_id);
    return ok();
  }
  if (!p.ciphertext || !hasTokenKey()) {
    await record("failed", null, "sem conta conectada", null);
    await telegramSend(chat, "Conecte de novo a conta Google em Mensagens, no Rep360.", msg.message_id);
    return ok();
  }
  try {
    const { data: cc } = await admin.from("commercial_contexts").select("email_signature").eq("tenant_id", p.tenant_id).maybeSingle();
    const body = withSignature(text, (cc?.email_signature as string | null) ?? null);
    const access = await accessTokenFromRefresh(decryptToken(p.ciphertext));
    const raw = toBase64Url(buildMime({ from: p.from, to: p.to, subject: p.subject, body, inReplyTo: p.in_reply_to, references: p.references }));
    const sent = await gmailSend(access, raw, p.thread_id);
    await record("sent", sent.id, null, sent.threadId ?? p.thread_id);
    await telegramSend(chat, `✅ Enviado para ${p.to}, na mesma conversa de e-mail.`, msg.message_id);
  } catch (e) {
    const m = e instanceof Error ? e.message : "falha no envio";
    await record("failed", null, m, null);
    if (e instanceof GoogleAuthRevoked) {
      await admin.rpc("svc_gmail_set_state", { p_connection: p.connection_id, p_history_id: null, p_error: m }).then(() => undefined, () => undefined);
    }
    await telegramSend(chat, e instanceof GoogleAuthRevoked
      ? "O acesso ao Gmail expirou. Conecte a conta de novo em Mensagens, no Rep360."
      : "O Gmail não aceitou o envio. Tente de novo em instantes.", msg.message_id);
  }
  return ok();
}
