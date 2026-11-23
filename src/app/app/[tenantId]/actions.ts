"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can, type Permission } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contactInfoSchema, withSources } from "@/lib/cnpj/contact-info";
import { companySchema, dealSchema, formToObject, industrySchema, moveDealSchema } from "@/lib/validation/schemas";

/** Valida vínculo e permissão no servidor antes de qualquer escrita. */
async function authorize(form: FormData, permission: Permission) {
  const tenantId = String(form.get("tenant_id") ?? "");
  const ctx = await requireTenantContext(tenantId);
  if (!can(ctx.role, permission)) throw new AuthorizationError("Você não tem permissão para esta ação.", 403);
  return ctx;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Telefones e e-mail da última consulta à Receita (para marcar a origem dos campos). */
async function receitaContact(supabase: Supabase, tenantId: string, cnpj: string | null | undefined) {
  if (!cnpj) return null;
  const { data } = await supabase.from("cnpj_registry").select("phones, email").eq("tenant_id", tenantId).eq("cnpj", cnpj).maybeSingle();
  return data ? { phones: (data.phones as string[] | null) ?? [], email: data.email as string | null } : null;
}

async function guarded(form: FormData, fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return withValues(await fn(), form);
  } catch (e) {
    if (e instanceof AuthorizationError) return withValues({ message: e.message }, form);
    throw e;
  }
}

export async function createIndustry(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(form, async () => {
    const ctx = await authorize(form, "catalog.write");
    const parsed = industrySchema.safeParse(formToObject(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues) };
    const supabase = await createSupabaseServerClient();
    const contact = withSources(parsed.data, await receitaContact(supabase, ctx.tenantId, parsed.data.cnpj));
    const { error } = await supabase.from("industries").insert({ ...parsed.data, ...contact, tenant_id: ctx.tenantId });
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(`/app/${ctx.tenantId}/industrias`);
    return { ok: true, message: "Indústria cadastrada." };
  });
}

export async function createCompany(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(form, async () => {
    const ctx = await authorize(form, "crm.write");
    const raw = formToObject(form);
    const parsed = companySchema.safeParse({ ...raw, state_code: raw.state_code || null });
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues) };
    const supabase = await createSupabaseServerClient();
    const contact = withSources(parsed.data, await receitaContact(supabase, ctx.tenantId, parsed.data.cnpj));
    const { error } = await supabase.from("companies").insert({
      ...parsed.data,
      ...contact,
      tenant_id: ctx.tenantId,
      source_date: new Date().toISOString().slice(0, 10),
      legal_basis: "legitimate_interest",
    });
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(`/app/${ctx.tenantId}/empresas`);
    return { ok: true, message: "Empresa cadastrada." };
  });
}

export async function createDeal(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(form, async () => {
    const ctx = await authorize(form, "deals.write");
    const parsed = dealSchema.safeParse(formToObject(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues) };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("deals").insert({ ...parsed.data, tenant_id: ctx.tenantId });
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(`/app/${ctx.tenantId}/funil`);
    return { ok: true, message: "Negócio criado." };
  });
}

export async function moveDeal(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(form, async () => {
    const ctx = await authorize(form, "deals.write");
    const parsed = moveDealSchema.safeParse(formToObject(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues) };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("deals")
      .update({ stage: parsed.data.stage, lost_reason: parsed.data.stage === "lost" ? parsed.data.lost_reason : null })
      .eq("id", parsed.data.deal_id)
      .eq("tenant_id", ctx.tenantId)
      .select("id");
    if (error) return { message: dbErrorMessage(error) };
    if (!data?.length) return { message: "Negócio não encontrado." };
    revalidatePath(`/app/${ctx.tenantId}/funil`);
    return { ok: true };
  });
}

/** Edita site e canais de contato (telefones, WhatsApp, e-mails...) de uma indústria ou empresa. Nunca mexe nos dados da Receita. */
export async function updateContactInfo(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(form, async () => {
    const entity = String(form.get("entity") ?? "");
    if (entity !== "industry" && entity !== "company") return { message: "Cadastro inválido." };
    const ctx = await authorize(form, entity === "industry" ? "catalog.write" : "crm.write");
    const id = String(form.get("id") ?? "");
    const parsed = contactInfoSchema.safeParse(formToObject(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues) };
    const supabase = await createSupabaseServerClient();
    const table = entity === "industry" ? "industries" : "companies";
    const { data: row } = await supabase.from(table).select("id, cnpj").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
    if (!row) return { message: "Cadastro não encontrado." };
    const contact = withSources(parsed.data, await receitaContact(supabase, ctx.tenantId, row.cnpj as string | null));
    const { error } = await supabase
      .from(table)
      .update(contact)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id);
    if (error) return { message: dbErrorMessage(error) };
    const base = `/app/${ctx.tenantId}/${entity === "industry" ? "industrias" : "empresas"}`;
    revalidatePath(base);
    revalidatePath(`${base}/${id}`);
    return { ok: true, message: "Site e canais de contato salvos." };
  });
}
