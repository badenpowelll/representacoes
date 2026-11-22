"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formToObject, prospectSchema } from "@/lib/validation/schemas";

export async function registerProspect(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "crm.write")) throw new AuthorizationError("Você não tem permissão para registrar prospects.", 403);
    const parsed = prospectSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const d = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("register_prospect", {
      p_tenant: ctx.tenantId,
      p_industry: d.industry_id,
      p_legal_name: d.legal_name,
      p_source: d.source,
      p_source_date: d.source_date,
      p_cnpj: d.cnpj,
      p_cnae: d.cnae,
      p_state: d.state_code,
      p_municipality: d.municipality_id,
      p_segment: d.segment,
    });
    if (error) {
      const fieldErrors: Record<string, string> | undefined =
        error.code === "23505"
          ? { industry_id: "Já existe um lead desta empresa para esta indústria." }
          : error.code === "23514" && /munic/i.test(error.message ?? "")
            ? { municipality_id: "O município não pertence à UF escolhida." }
            : undefined;
      return withValues(fieldErrors ? { fieldErrors } : { message: dbErrorMessage(error) }, form);
    }
    revalidatePath(`/app/${ctx.tenantId}/leads`);
    const existed = (data as { company_existed?: boolean } | null)?.company_existed;
    return {
      ok: true,
      nonce: Date.now(),
      message: existed ? "Lead registrado para uma empresa já cadastrada (mesmo CNPJ)." : "Prospect e lead registrados.",
    };
  } catch (e) {
    if (e instanceof AuthorizationError) return withValues({ message: e.message }, form);
    throw e;
  }
}

const statusSchema = z.object({ lead_id: z.uuid(), status: z.enum(["new", "qualified", "discarded"]) });

export async function setLeadStatus(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "crm.write")) return;
  const parsed = statusSchema.safeParse(formToObject(form));
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("leads").update({ status: parsed.data.status }).eq("tenant_id", ctx.tenantId).eq("id", parsed.data.lead_id);
  revalidatePath(`/app/${ctx.tenantId}/leads`);
}

/** Leva o lead ao funil: cria um negócio na etapa "Novo" vinculado ao lead. */
export async function leadToDeal(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "deals.write")) return;
  const leadId = z.uuid().safeParse(form.get("lead_id"));
  if (!leadId.success) return;
  const supabase = await createSupabaseServerClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, company_id, industry_id, companies(legal_name), industries(name), deals(id)")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", leadId.data)
    .maybeSingle();
  const l = lead as unknown as {
    id: string; company_id: string; industry_id: string; companies: { legal_name: string } | null;
    industries: { name: string } | null; deals: { id: string }[];
  } | null;
  if (!l || l.deals.length > 0) return; // idempotente: um negócio por lead
  await supabase.from("deals").insert({
    tenant_id: ctx.tenantId,
    company_id: l.company_id,
    industry_id: l.industry_id,
    lead_id: l.id,
    title: `${l.companies?.legal_name ?? "Empresa"} · ${l.industries?.name ?? "Indústria"}`.slice(0, 300),
  });
  await supabase.from("leads").update({ status: "qualified" }).eq("tenant_id", ctx.tenantId).eq("id", l.id);
  revalidatePath(`/app/${ctx.tenantId}/leads`);
  revalidatePath(`/app/${ctx.tenantId}/funil`);
}
