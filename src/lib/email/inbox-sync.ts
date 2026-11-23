import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, hasTokenKey } from "./crypto";
import { GmailNotFound, GoogleAuthRevoked, accessTokenFromRefresh, gmailMessage, gmailNewInboxMessages, gmailProfile, gmailWatch } from "./google";
import { parseInbound, telegramNotice } from "./inbound";
import { telegramSend } from "@/lib/telegram/bot";

type Conn = { connection_id: string; tenant_id: string; user_id: string; email_address: string; ciphertext: string; last_history_id: string | null };

/**
 * Lê o que chegou na caixa desde a última leitura e guarda/avisa só as respostas
 * a conversas iniciadas pelo sistema. Nunca registra tokens nem o conteúdo em log.
 */
export async function syncConnection(admin: SupabaseClient, c: Conn): Promise<{ notified: number; error?: string }> {
  if (!hasTokenKey()) return { notified: 0, error: "sem chave" };
  let access: string;
  try {
    access = await accessTokenFromRefresh(decryptToken(c.ciphertext));
  } catch (e) {
    if (e instanceof GoogleAuthRevoked) await admin.rpc("svc_gmail_set_state", { p_connection: c.connection_id, p_history_id: null, p_error: e.message });
    return { notified: 0, error: "acesso" };
  }
  let start = c.last_history_id;
  if (!start) {
    // Primeira leitura: começa de agora (não reprocessa a caixa antiga).
    const p = await gmailProfile(access);
    await admin.rpc("svc_gmail_set_state", { p_connection: c.connection_id, p_history_id: p.historyId });
    return { notified: 0 };
  }
  let list: { ids: string[]; historyId: string };
  try {
    list = await gmailNewInboxMessages(access, start);
  } catch (e) {
    if (!(e instanceof GmailNotFound)) throw e;
    // Histórico expirado (mais de ~7 dias sem leitura): recomeça de agora.
    const p = await gmailProfile(access);
    start = p.historyId;
    await admin.rpc("svc_gmail_set_state", { p_connection: c.connection_id, p_history_id: p.historyId });
    return { notified: 0 };
  }
  let notified = 0;
  for (const id of list.ids.slice(0, 200)) {
    let msg;
    try {
      msg = await gmailMessage(access, id);
    } catch (e) {
      if (e instanceof GmailNotFound) continue;
      throw e;
    }
    if (msg.labelIds?.includes("SENT") || msg.labelIds?.includes("DRAFT")) continue;
    const m = parseInbound(msg);
    if (!m.from || m.automatic) continue;
    const { data } = await admin.rpc("svc_inbound_record", {
      p_connection: c.connection_id, p_gmail_message_id: m.gmailMessageId, p_gmail_thread_id: m.threadId,
      p_rfc_message_id: m.rfcMessageId, p_references: m.references, p_from: m.from, p_subject: m.subject,
      p_body: m.text, p_received_at: m.receivedAt, p_is_opt_out: m.optOut,
    });
    const r = data as { ok: boolean; duplicate?: boolean; inbound_id?: string; chat_id?: number | null; company?: string | null; opted_out?: boolean } | null;
    if (!r?.ok || r.duplicate || !r.inbound_id || !r.chat_id) continue;
    const tgId = await telegramSend(r.chat_id, telegramNotice({ company: r.company ?? null, from: m.from, subject: m.subject, text: m.text, optedOut: Boolean(r.opted_out) }));
    if (tgId) {
      await admin.rpc("svc_inbound_notified", { p_inbound: r.inbound_id, p_chat_id: r.chat_id, p_message_id: tgId });
      notified++;
    }
  }
  await admin.rpc("svc_gmail_set_state", { p_connection: c.connection_id, p_history_id: list.historyId });
  return { notified };
}

export async function syncAll(admin: SupabaseClient, email?: string | null) {
  const { data } = await admin.rpc("svc_gmail_connections", { p_email: email ?? null });
  let notified = 0;
  let failed = 0;
  for (const c of (data ?? []) as Conn[]) {
    try {
      notified += (await syncConnection(admin, c)).notified;
    } catch {
      failed++;
    }
  }
  return { connections: (data ?? []).length, notified, failed };
}

/** Renova o aviso do Gmail (Pub/Sub). Sem tópico configurado, não faz nada. */
export async function renewWatches(admin: SupabaseClient) {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic || !hasTokenKey()) return 0;
  const { data } = await admin.rpc("svc_gmail_connections", { p_email: null });
  let n = 0;
  for (const c of (data ?? []) as Conn[]) {
    try {
      const access = await accessTokenFromRefresh(decryptToken(c.ciphertext));
      const w = await gmailWatch(access, topic);
      await admin.rpc("svc_gmail_set_state", {
        p_connection: c.connection_id, p_history_id: c.last_history_id ? null : w.historyId,
        p_watch_expires: new Date(Number(w.expiration)).toISOString(),
      });
      n++;
    } catch {
      // segue para as outras conexões
    }
  }
  return n;
}
