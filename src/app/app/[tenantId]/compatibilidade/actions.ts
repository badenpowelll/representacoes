"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Um só passo para o usuário: escolhe a indústria (ou "todas, por cliente"),
 * o sistema recalcula com a carteira atual e mostra o resultado.
 */
export async function showCompatible(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  const choice = String(form.get("industria") ?? "");
  const all = choice === "clientes";
  const industry = z.uuid().safeParse(choice);
  const target = `/app/${ctx.tenantId}/compatibilidade${all ? "?industria=clientes" : industry.success ? `?industria=${industry.data}` : ""}`;
  if (can(ctx.role, "deals.write") && (all || industry.success)) {
    const supabase = await createSupabaseServerClient();
    const ids = all
      ? ((await supabase.from("industries").select("id").eq("tenant_id", ctx.tenantId).eq("active", true)).data ?? []).map((i) => i.id as string)
      : [industry.data!];
    for (const id of ids) await supabase.rpc("compute_matches", { p_tenant: ctx.tenantId, p_industry: id });
    revalidatePath(`/app/${ctx.tenantId}/compatibilidade`);
  }
  redirect(`${target}${target.includes("?") ? "&" : "?"}calculado=1`);
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
