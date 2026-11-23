import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, hasTokenKey } from "./crypto";
import { GoogleAuthRevoked, accessTokenFromRefresh, gmailSend, sendingMode } from "./google";
import { buildMime, toBase64Url } from "./mime";

export const SEND_REASON_LABELS: Record<string, string> = {
  opted_out: "o contato pediu para não ser contatado",
  suppressed: "o endereço está na lista de supressão",
  no_email: "o contato não tem e-mail",
  no_contact: "a empresa não tem contato cadastrado",
  no_legal_basis: "o contato não tem base legal registrada",
  purpose_not_allowed: "a finalidade não está autorizada para este contato",
  consent_missing: "falta a evidência do consentimento",
  invalid_address: "o e-mail é inválido",
  daily_limit: "o limite diário de envios foi atingido",
  not_eligible: "o contato não pode receber",
  not_pending: "este destinatário não está mais na fila do lote",
};

export type SendInput = {
  tenantId: string;
  companyId: string;
  contactId: string;
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  purpose?: "prospecting" | "catalog_distribution";
  campaignRecipientId?: string | null;
  fromName?: string | null;
};

export type SendOutcome =
  | { ok: true; status: "sent" | "sandbox"; duplicate: boolean; from: string | null }
  | { ok: false; message: string };

/**
 * Envio direto: o banco confere elegibilidade e grava o registro (idempotente)
 * antes; depois envia pelo Gmail da conta conectada do usuário, ou só registra
 * em modo de teste. Nunca registra tokens nem conteúdo do token em log.
 */
export async function sendEmail(supabase: SupabaseClient, d: SendInput): Promise<SendOutcome> {
  const { data, error } = await supabase.rpc("email_prepare_send", {
    p_tenant: d.tenantId,
    p_company: d.companyId,
    p_contact: d.contactId,
    p_to: d.to,
    p_subject: d.subject,
    p_body: d.body,
    p_idempotency_key: d.idempotencyKey,
    p_purpose: d.purpose ?? "prospecting",
    p_campaign_recipient: d.campaignRecipientId ?? null,
  });
  if (error) return { ok: false, message: "Não foi possível preparar o envio." };
  const prep = data as { ok: boolean; reason?: string; message_id?: string; status?: string; duplicate?: boolean; from?: string | null };
  if (!prep.ok) return { ok: false, message: `Não enviado: ${SEND_REASON_LABELS[prep.reason ?? ""] ?? "o contato não pode receber"}.` };
  if (prep.duplicate) {
    // O mesmo envio já foi gravado: nunca manda de novo. "queued" é outro clique ainda em andamento.
    if (prep.status === "queued") return { ok: false, message: "Este envio já está em andamento." };
    return { ok: true, status: prep.status === "sent" ? "sent" : "sandbox", duplicate: true, from: prep.from ?? null };
  }

  const record = (status: "sent" | "sandbox" | "failed", providerId?: string, err?: string) =>
    supabase.rpc("email_record_result", { p_tenant: d.tenantId, p_message: prep.message_id, p_status: status, p_provider_id: providerId ?? null, p_error: err ?? null });

  if (sendingMode() === "sandbox") {
    await record("sandbox");
    return { ok: true, status: "sandbox", duplicate: false, from: prep.from ?? null };
  }

  const { data: secret } = await supabase.rpc("email_connection_secret", { p_tenant: d.tenantId });
  const conn = (secret as { email_address: string; ciphertext: string | null }[] | null)?.[0];
  if (!conn?.ciphertext || !hasTokenKey()) {
    await record("failed", undefined, "sem conta conectada");
    return { ok: false, message: "Conecte sua conta Google Workspace em Mensagens para enviar pelo sistema." };
  }
  try {
    const access = await accessTokenFromRefresh(decryptToken(conn.ciphertext));
    const raw = toBase64Url(buildMime({ from: conn.email_address, fromName: d.fromName, to: d.to, subject: d.subject, body: d.body }));
    const id = await gmailSend(access, raw);
    await record("sent", id);
    return { ok: true, status: "sent", duplicate: false, from: conn.email_address };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha no envio";
    await record("failed", undefined, msg);
    if (e instanceof GoogleAuthRevoked) {
      await supabase.rpc("email_connection_set_status", { p_tenant: d.tenantId, p_status: "error", p_error: msg });
      return { ok: false, message: "O acesso ao Gmail expirou ou foi revogado. Conecte a conta de novo em Mensagens." };
    }
    return { ok: false, message: "O Gmail não aceitou o envio. Tente de novo em instantes." };
  }
}
