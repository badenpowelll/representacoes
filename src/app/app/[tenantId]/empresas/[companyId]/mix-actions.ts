"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Liga o cliente a mais uma indústria (cria o lead empresa × indústria).
 * Só dentro do território da indústria; a origem registra o vínculo manual.
 */
export async function linkIndustry(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "crm.write")) return;
  const parsed = z.object({ company_id: z.uuid(), industry_id: z.uuid() }).safeParse({
    company_id: form.get("company_id"),
    industry_id: form.get("industry_id"),
  });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  const { data: fit } = await supabase.rpc("company_industry_fit", { p_tenant: ctx.tenantId, p_company: parsed.data.company_id });
  const row = ((fit ?? []) as { industry_id: string; territory_match: boolean; cnae_match: boolean; lead_id: string | null }[]).find(
    (f) => f.industry_id === parsed.data.industry_id,
  );
  if (!row || row.lead_id || !row.territory_match) return;
  await supabase.from("leads").insert({
    tenant_id: ctx.tenantId,
    company_id: parsed.data.company_id,
    industry_id: parsed.data.industry_id,
    status: "new",
    source: row.cnae_match
      ? "Mix de indústrias: cliente da carteira com CNAE-alvo da indústria, no território"
      : "Mix de indústrias: vínculo manual pelo representante (CNAE fora do perfil da indústria)",
  });
  revalidatePath(`/app/${ctx.tenantId}/empresas/${parsed.data.company_id}`);
  revalidatePath(`/app/${ctx.tenantId}/leads`);
}
