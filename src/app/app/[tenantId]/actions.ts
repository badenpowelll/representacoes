"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can, type Permission } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companySchema, dealSchema, formToObject, industrySchema, moveDealSchema } from "@/lib/validation/schemas";

/** Valida vínculo e permissão no servidor antes de qualquer escrita. */
async function authorize(form: FormData, permission: Permission) {
  const tenantId = String(form.get("tenant_id") ?? "");
  const ctx = await requireTenantContext(tenantId);
  if (!can(ctx.role, permission)) throw new AuthorizationError("Você não tem permissão para esta ação.", 403);
  return ctx;
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
    const { error } = await supabase.from("industries").insert({ ...parsed.data, tenant_id: ctx.tenantId });
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
    const { error } = await supabase.from("companies").insert({
      ...parsed.data,
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
