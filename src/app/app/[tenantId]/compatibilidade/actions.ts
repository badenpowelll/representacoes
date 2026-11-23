"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function recompute(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "deals.write")) return;
  const industry = z.uuid().safeParse(form.get("industry_id"));
  if (!industry.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("compute_matches", { p_tenant: ctx.tenantId, p_industry: industry.data });
  revalidatePath(`/app/${ctx.tenantId}/compatibilidade`);
}

/** Calcula a compatibilidade de todas as indústrias ativas de uma vez (mix por cliente). */
export async function recomputeAll(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "deals.write")) return;
  const supabase = await createSupabaseServerClient();
  const { data: industries } = await supabase.from("industries").select("id").eq("tenant_id", ctx.tenantId).eq("active", true);
  for (const i of industries ?? []) {
    await supabase.rpc("compute_matches", { p_tenant: ctx.tenantId, p_industry: i.id });
  }
  revalidatePath(`/app/${ctx.tenantId}/compatibilidade`);
}

/** Revisão humana: aprovar cria o lead (com origem registrada); rejeitar só marca. */
export async function review(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "deals.write")) return;
  const parsed = z
    .object({ match_id: z.uuid(), decision: z.enum(["approved", "rejected"]) })
    .safeParse({ match_id: form.get("match_id"), decision: form.get("decision") });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: match } = await supabase
    .from("matches")
    .update({ review: parsed.data.decision, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
    .eq("id", parsed.data.match_id)
    .eq("tenant_id", ctx.tenantId)
    .select("company_id, industry_id, score")
    .single();
  if (match && parsed.data.decision === "approved") {
    await supabase.from("leads").upsert(
      {
        tenant_id: ctx.tenantId,
        company_id: match.company_id,
        industry_id: match.industry_id,
        status: "qualified",
        source: `Motor de compatibilidade (score ${match.score}), aprovado manualmente`,
      },
      { onConflict: "tenant_id,company_id,industry_id", ignoreDuplicates: true },
    );
  }
  revalidatePath(`/app/${ctx.tenantId}/compatibilidade`);
}
