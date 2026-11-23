"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contactSchema, formToObject } from "@/lib/validation/schemas";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(form: FormData) {
  const company = String(form.get("company_id") ?? "");
  const contact = String(form.get("contact_id") ?? "");
  return UUID_RE.test(company) && UUID_RE.test(contact) ? { company, contact } : null;
}

function rightsError(error: { code?: string; message?: string }): string {
  if (error.code === "P0002") return "Contato não encontrado nesta empresa. Nada foi alterado.";
  if (error.code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir. Nada foi alterado; tente novamente.";
}

async function authorizeCrm(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "crm.write")) throw new AuthorizationError("Você não tem permissão para editar contatos.", 403);
  return ctx;
}

export async function createContact(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await authorizeCrm(form);
    const parsed = contactSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const { consent, consent_evidence, ...data } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const now = new Date();
    const { error } = await supabase.from("contacts").insert({
      ...data,
      tenant_id: ctx.tenantId,
      email: data.email?.toLowerCase() ?? null,
      source_date: now.toISOString().slice(0, 10),
      consent_at: data.legal_basis === "consent" && consent ? now.toISOString() : null,
      consent_evidence: data.legal_basis === "consent" ? consent_evidence : null,
    });
    if (error) {
      return withValues(
        error.code === "23505"
          ? { fieldErrors: { email: "Já existe um contato com este e-mail nesta representação." } }
          : { message: error.code === "23514" ? `Regra de LGPD: ${error.message}` : dbErrorMessage(error) },
        form,
      );
    }
    revalidatePath(`/app/${ctx.tenantId}/empresas/${data.company_id}`);
    return { ok: true, nonce: Date.now(), message: "Contato cadastrado." };
  } catch (e) {
    if (e instanceof AuthorizationError) return withValues({ message: e.message }, form);
    throw e;
  }
}

/**
 * Oposição (opt-out) via RPC: confere papel, empresa e contato, é idempotente,
 * põe o e-mail na supressão e grava auditoria sem dados pessoais.
 */
export async function optOutContact(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await authorizeCrm(form);
    const target = ids(form);
    if (!target) return { message: "Contato inválido. Nada foi alterado.", nonce: Date.now() };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("opt_out_contact", {
      p_tenant: ctx.tenantId, p_company: target.company, p_contact: target.contact,
    });
    if (error) return { message: rightsError(error), nonce: Date.now() };
    revalidatePath(`/app/${ctx.tenantId}/empresas/${target.company}`);
    return { ok: true, message: "Oposição registrada. Este contato não receberá comunicações.", nonce: Date.now() };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message, nonce: Date.now() };
    throw e;
  }
}

/** Exclusão a pedido do titular, via RPC. O e-mail fica na supressão para não ser recontatado. */
export async function deleteContact(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await authorizeCrm(form);
    const target = ids(form);
    if (!target) return { message: "Contato inválido. Nada foi alterado.", nonce: Date.now() };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("delete_contact", {
      p_tenant: ctx.tenantId, p_company: target.company, p_contact: target.contact,
    });
    if (error) return { message: rightsError(error), nonce: Date.now() };
    revalidatePath(`/app/${ctx.tenantId}/empresas/${target.company}`);
    return { ok: true, message: "Dados do contato excluídos. O e-mail segue bloqueado para comunicações.", nonce: Date.now() };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message, nonce: Date.now() };
    throw e;
  }
}
