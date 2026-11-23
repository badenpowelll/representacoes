"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { finalMessage, linkExpiry } from "@/lib/catalogos/envio";
import { buildMailto, buildWhatsAppUrl } from "@/lib/prospeccao/messages";
import { sendEmail } from "@/lib/email/send";
import { loadTenantTemplates } from "@/lib/mensagens/load";
import { withSignature } from "@/lib/mensagens/templates";

const createSchema = z.object({
  version_id: z.uuid(),
  channel: z.enum(["email", "whatsapp"]),
  name: z.string().trim().min(2).max(200),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(4000),
  days: z.coerce.number().int(),
  companies: z.array(z.uuid()).min(1).max(500),
});

/** Monta o lote (destinatários elegíveis e bloqueados) e abre a fila de envio. */
export async function createCampaign(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  const back = `/app/${ctx.tenantId}/envios/novo?versao=${encodeURIComponent(String(form.get("version_id") ?? ""))}&canal=${encodeURIComponent(String(form.get("channel") ?? "email"))}`;
  if (!can(ctx.role, "deals.write")) redirect(`${back}&erro=permissao`);
  const parsed = createSchema.safeParse({
    version_id: form.get("version_id"),
    channel: form.get("channel"),
    name: form.get("name"),
    subject: form.get("subject") ?? undefined,
    body: form.get("body"),
    days: form.get("days"),
    companies: form.getAll("company_id"),
  });
  if (!parsed.success) redirect(`${back}&erro=${parsed.error.issues.some((i) => i.path[0] === "companies") ? "clientes" : "dados"}`);
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_catalog_campaign", {
    p_tenant: ctx.tenantId,
    p_catalog_version: d.version_id,
    p_channel: d.channel,
    p_name: d.name,
    p_subject: d.channel === "email" ? (d.subject ?? null) : null,
    p_body: d.body,
    p_companies: d.companies,
    p_link_expires_at: linkExpiry(d.days).toISOString(),
  });
  if (error || !data) redirect(`${back}&erro=${error?.code === "P0002" ? "versao" : "falha"}`);
  revalidatePath(`/app/${ctx.tenantId}/envios`);
  redirect(`/app/${ctx.tenantId}/envios/${(data as { campaign_id: string }).campaign_id}`);
}

const sendSchema = z.object({
  tenantId: z.uuid(),
  recipientId: z.uuid(),
  subject: z.string().max(300).optional(),
  body: z.string().trim().min(1).max(4000),
  /** "direct": o próprio sistema envia pelo Gmail da conta conectada (só e-mail). */
  mode: z.enum(["link", "direct"]).default("link"),
});

export type SendResult = { ok: true; url: string | null; alreadySent: boolean; message?: string } | { ok: false; message: string };

/**
 * Um envio da fila: confere de novo a elegibilidade no banco, registra a
 * atividade (idempotente) e devolve o link mailto:/wa.me com o link do catálogo,
 * assinado com a sessão do usuário e válido até a data escolhida no lote.
 */
export async function sendToRecipient(input: z.input<typeof sendSchema>): Promise<SendResult> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Mensagem inválida." };
  const d = parsed.data;
  const ctx = await requireTenantContext(d.tenantId);
  if (!can(ctx.role, "deals.write")) return { ok: false, message: "Você não tem permissão para enviar." };
  const supabase = await createSupabaseServerClient();
  const { data: rc } = await supabase
    .from("campaign_recipients")
    .select("id, campaign_id, company_id, contact_id, contacts(email, phone), campaigns(channel, link_expires_at, catalog_versions(storage_path, status))")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", d.recipientId)
    .maybeSingle();
  type Rc = {
    campaign_id: string;
    company_id: string;
    contact_id: string | null;
    contacts: { email: string | null; phone: string | null } | null;
    campaigns: { channel: "email" | "whatsapp"; link_expires_at: string; catalog_versions: { storage_path: string; status: string } | null } | null;
  };
  const r = rc as unknown as Rc | null;
  const cv = r?.campaigns?.catalog_versions;
  if (!r || !r.campaigns || !cv) return { ok: false, message: "Destinatário não encontrado." };
  if (cv.status !== "published") return { ok: false, message: "O catálogo não está mais publicado." };
  const seconds = Math.floor((new Date(r.campaigns.link_expires_at).getTime() - Date.now()) / 1000);
  if (seconds < 60) return { ok: false, message: "O prazo do link deste lote acabou. Crie um novo envio." };
  const { data: signed, error: signError } = await supabase.storage.from("catalogs").createSignedUrl(cv.storage_path, seconds);
  if (signError || !signed?.signedUrl) return { ok: false, message: "Não foi possível gerar o link do catálogo." };

  const channel = r.campaigns.channel;
  if (d.mode === "direct") {
    if (channel !== "email") return { ok: false, message: "O envio pelo sistema é só para e-mail." };
    const to = r.contacts?.email;
    if (!to || !r.contact_id) return { ok: false, message: "Contato sem e-mail." };
    const { signature } = await loadTenantTemplates(supabase, ctx.tenantId);
    const sent = await sendEmail(supabase, {
      tenantId: ctx.tenantId,
      companyId: r.company_id,
      contactId: r.contact_id,
      to,
      subject: d.subject?.trim() || "Catálogo",
      body: withSignature(finalMessage(d.body, signed.signedUrl), signature),
      // Um envio por destinatário do lote, não importa quantas vezes clicar.
      idempotencyKey: `camp:${d.recipientId}`,
      purpose: "catalog_distribution",
      campaignRecipientId: d.recipientId,
    });
    revalidatePath(`/app/${ctx.tenantId}/envios/${r.campaign_id}`);
    if (!sent.ok) return { ok: false, message: sent.message };
    return {
      ok: true,
      url: null,
      alreadySent: sent.duplicate,
      message: sent.status === "sent"
        ? `E-mail enviado${sent.from ? ` por ${sent.from}` : ""}.`
        : "Modo de teste: registrado no histórico, mas o e-mail não saiu.",
    };
  }

  const body = finalMessage(d.body, signed.signedUrl);
  const to = channel === "email" ? r.contacts?.email : r.contacts?.phone;
  const url = to ? (channel === "email" ? buildMailto(to, d.subject ?? "Catálogo", body) : buildWhatsAppUrl(to, body)) : null;
  if (!url) return { ok: false, message: channel === "email" ? "Contato sem e-mail." : "Contato sem telefone válido." };

  const { data: res, error } = await supabase.rpc("campaign_record_send", {
    p_tenant: ctx.tenantId,
    p_recipient: d.recipientId,
    p_subject: channel === "email" ? (d.subject ?? null) : null,
    p_body: body,
  });
  revalidatePath(`/app/${ctx.tenantId}/envios/${r.campaign_id}`);
  if (error) return { ok: false, message: "Não foi possível registrar o envio." };
  const out = res as { ok: boolean; reason?: string; already_sent?: boolean };
  if (!out.ok) return { ok: false, message: `Bloqueado: ${out.reason === "opted_out" ? "o contato pediu para não ser contatado" : "o contato não pode mais receber"}.` };
  return { ok: true, url, alreadySent: Boolean(out.already_sent) };
}

/** Pular um destinatário (fica registrado como pulado). */
export async function skipRecipient(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "deals.write")) return;
  const id = z.uuid().safeParse(form.get("recipient_id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("campaign_recipients")
    .update({ status: "skipped", updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .eq("status", "pending")
    .select("campaign_id")
    .maybeSingle();
  if (data) revalidatePath(`/app/${ctx.tenantId}/envios/${data.campaign_id}`);
}
