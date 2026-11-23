"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ELIGIBILITY_REASON_LABELS, UF_CODES } from "@/lib/validation/schemas";
import { buildMailto, buildWhatsAppUrl, normalizePhone, unresolvedVariables, withOptOut } from "@/lib/prospeccao/messages";
import { findPreset, parseCnaeList } from "@/lib/prospeccao/presets";

const path = (tenantId: string) => `/app/${tenantId}/prospeccao`;
const authError = (e: unknown, form?: FormData): ActionState => {
  if (e instanceof AuthorizationError) return form ? withValues({ message: e.message }, form) : { message: e.message };
  throw e;
};

/** Primeiro uso: cria a indústria com um perfil pronto (CNAEs) e as UFs atendidas. */
export async function startIndustry(_: ActionState, form: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) return { message: "Só administradores e gerentes cadastram indústrias." };
    const parsed = z
      .object({
        name: z.string().trim().min(2, "Informe o nome da indústria").max(200),
        preset: z.string().optional(),
        ufs: z.array(z.enum(UF_CODES)).min(1, "Escolha ao menos uma UF atendida"),
      })
      .safeParse({ name: form.get("name"), preset: form.get("preset") ?? undefined, ufs: form.getAll("ufs") });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
      return withValues({ fieldErrors }, form);
    }
    const preset = findPreset(parsed.data.preset);
    const supabase = await createSupabaseServerClient();
    const { data: ind, error } = await supabase
      .from("industries")
      .insert({ tenant_id: ctx.tenantId, name: parsed.data.name, segment: preset?.segment ?? null, target_cnaes: preset?.cnaes ?? [] })
      .select("id")
      .single();
    if (error || !ind) {
      return withValues(
        error?.code === "23505" ? { fieldErrors: { name: "Já existe uma indústria com este nome." } } : { message: dbErrorMessage(error) },
        form,
      );
    }
    const { error: tErr } = await supabase
      .from("territories")
      .insert(parsed.data.ufs.map((uf) => ({ tenant_id: ctx.tenantId, industry_id: ind.id, state_code: uf })));
    if (tErr) return { message: "Indústria criada, mas não foi possível gravar os territórios. Ajuste em Territórios." };
    target = `${path(ctx.tenantId)}?industria=${ind.id}`;
    revalidatePath(path(ctx.tenantId));
  } catch (e) {
    return authError(e, form);
  }
  redirect(target);
}

/** CNAEs-alvo da indústria (o que define quem aparece na tabela). */
export async function saveTargetCnaes(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) return { message: "Só administradores e gerentes alteram o perfil de busca." };
    const industry = z.uuid().safeParse(form.get("industry_id"));
    if (!industry.success) return { message: "Indústria inválida." };
    const { codes, invalid } = parseCnaeList(String(form.get("cnaes") ?? ""));
    if (invalid.length) return withValues({ fieldErrors: { cnaes: `Códigos inválidos: ${invalid.join(", ")}` } }, form);
    if (codes.length > 60) return withValues({ fieldErrors: { cnaes: "Use no máximo 60 CNAEs." } }, form);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("industries")
      .update({ target_cnaes: codes })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", industry.data);
    if (error) return withValues({ message: dbErrorMessage(error) }, form);
    revalidatePath(path(ctx.tenantId));
    return { ok: true, nonce: Date.now(), message: `Perfil salvo com ${codes.length} CNAE(s).` };
  } catch (e) {
    return authError(e, form);
  }
}

const templateSchema = z
  .object({
    industry_id: z.uuid(),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(10, "Escreva ao menos 10 caracteres").max(5000),
  })
  .refine((v) => v.channel !== "email" || (v.subject?.length ?? 0) >= 3, { path: ["subject"], message: "Informe o assunto" });

export async function saveTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "deals.write")) return { message: "Você não tem permissão para editar os modelos." };
    const parsed = templateSchema.safeParse({
      industry_id: form.get("industry_id"),
      channel: form.get("channel"),
      subject: form.get("subject") ?? undefined,
      body: form.get("body"),
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
      return withValues({ fieldErrors }, form);
    }
    const d = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("message_templates").upsert(
      {
        tenant_id: ctx.tenantId,
        industry_id: d.industry_id,
        channel: d.channel,
        subject: d.channel === "email" ? d.subject : null,
        body: d.body,
        updated_by: ctx.userId,
      },
      { onConflict: "tenant_id,industry_id,channel" },
    );
    if (error) return withValues({ message: dbErrorMessage(error) }, form);
    revalidatePath(path(ctx.tenantId));
    return { ok: true, nonce: Date.now(), message: d.channel === "email" ? "Modelo de e-mail salvo." : "Modelo de WhatsApp salvo." };
  } catch (e) {
    return authError(e, form);
  }
}

const CNPJ_RE = /^\d{14}$/;

/** Adiciona à carteira (empresa + lead + contato institucional) as empresas marcadas. */
export async function addToPortfolio(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "crm.write")) return { message: "Você não tem permissão para adicionar empresas." };
    const industry = z.uuid().safeParse(form.get("industry_id"));
    const cnpjs = [...new Set(form.getAll("cnpj").map(String))].filter((c) => CNPJ_RE.test(c));
    if (!industry.success || cnpjs.length === 0) return { message: "Marque ao menos uma empresa." };
    if (cnpjs.length > 200) return { message: "Adicione no máximo 200 empresas por vez." };
    const supabase = await createSupabaseServerClient();
    let created = 0;
    let existing = 0;
    let failed = 0;
    for (const cnpj of cnpjs) {
      const { data, error } = await supabase.rpc("prospect_add", { p_tenant: ctx.tenantId, p_industry: industry.data, p_cnpj: cnpj });
      if (error) failed++;
      else if ((data as { lead_created?: boolean }).lead_created) created++;
      else existing++;
    }
    revalidatePath(path(ctx.tenantId));
    revalidatePath(`/app/${ctx.tenantId}/leads`);
    const parts = [`${created} adicionada(s) à carteira`];
    if (existing) parts.push(`${existing} já estava(m)`);
    if (failed) parts.push(`${failed} não puderam ser adicionadas`);
    return { ok: failed === 0, nonce: Date.now(), message: parts.join(", ") + "." };
  } catch (e) {
    return authError(e);
  }
}

const outreachSchema = z.object({
  tenantId: z.uuid(),
  industryId: z.uuid(),
  cnpj: z.string().regex(CNPJ_RE),
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().trim().min(1, "Informe o destinatário").max(254),
  originalTo: z.string().trim().max(254).optional(),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(5, "Escreva a mensagem").max(5000),
});

export type OutreachResult = { ok: true; url: string; message: string } | { ok: false; message: string };

/**
 * Prepara um envio manual: garante empresa/lead/contato na carteira, checa no
 * servidor a elegibilidade (oposição, supressão, base legal e finalidade),
 * registra a atividade e devolve o link (mailto: ou wa.me) para o usuário enviar.
 * Nada é enviado automaticamente.
 */
export async function prepareOutreach(input: z.input<typeof outreachSchema>): Promise<OutreachResult> {
  const parsed = outreachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  try {
    const ctx = await requireTenantContext(d.tenantId);
    if (!can(ctx.role, "crm.write")) return { ok: false, message: "Você não tem permissão para fazer contatos." };
    if (unresolvedVariables(`${d.subject ?? ""} ${d.body}`).length) {
      return { ok: false, message: "Ainda há variáveis {{...}} sem valor no texto. Edite antes de enviar." };
    }
    let to = d.to;
    if (d.channel === "email") {
      to = to.toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, message: "E-mail inválido." };
      if ((d.subject?.length ?? 0) < 3) return { ok: false, message: "Informe o assunto." };
    } else {
      const phone = normalizePhone(to);
      if (!phone) return { ok: false, message: "Telefone inválido. Use DDD + número." };
      to = phone;
    }
    const original = d.originalTo ? (d.channel === "email" ? d.originalTo.toLowerCase() : normalizePhone(d.originalTo)) : null;
    const changed = to !== original;

    const supabase = await createSupabaseServerClient();
    const { data: added, error: addError } = await supabase.rpc("prospect_add", {
      p_tenant: ctx.tenantId,
      p_industry: d.industryId,
      p_cnpj: d.cnpj,
      p_email: d.channel === "email" && changed ? to : null,
      p_phone: d.channel === "whatsapp" && changed ? to : null,
    });
    if (addError) return { ok: false, message: dbErrorMessage(addError) };
    const r = added as { company_id: string; contact_id: string | null };
    if (!r.contact_id) return { ok: false, message: "Não foi possível registrar o contato desta empresa." };

    const { data: elig, error: eligError } = await supabase.rpc("contact_eligibility", {
      p_tenant: ctx.tenantId,
      p_company: r.company_id,
      p_purpose: "prospecting",
      p_channel: d.channel,
    });
    if (eligError) return { ok: false, message: "Não foi possível verificar se o contato pode receber mensagens." };
    const row = (elig as { contact_id: string; eligible: boolean; reason: string | null }[]).find((x) => x.contact_id === r.contact_id);
    if (!row?.eligible) {
      const reason = ELIGIBILITY_REASON_LABELS[row?.reason ?? "unknown"] ?? row?.reason ?? "motivo desconhecido";
      return { ok: false, message: `Este contato não pode receber prospecção: ${reason}.` };
    }

    const body = withOptOut(d.body);
    const url = d.channel === "email" ? buildMailto(to, d.subject ?? "", body) : buildWhatsAppUrl(to, body);
    if (!url) return { ok: false, message: "Não foi possível montar o link." };
    const { error: actError } = await supabase.from("activities").insert({
      tenant_id: ctx.tenantId,
      kind: d.channel,
      company_id: r.company_id,
      subject: d.channel === "email" ? (d.subject ?? "E-mail") : "Mensagem de WhatsApp",
      body,
      done_at: new Date().toISOString(),
      metadata: { channel: d.channel, mode: "manual_link", industry_id: d.industryId, contact_id: r.contact_id },
    });
    if (actError) return { ok: false, message: "Não foi possível registrar o contato no histórico." };
    revalidatePath(path(ctx.tenantId));
    return {
      ok: true,
      url,
      message: d.channel === "email" ? "Abrindo seu programa de e-mail. O contato ficou registrado no histórico." : "Abrindo o WhatsApp. O contato ficou registrado no histórico.",
    };
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, message: e.message };
    throw e;
  }
}
