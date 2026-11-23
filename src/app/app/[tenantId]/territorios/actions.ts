"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type CoberturaExistente, MAX_LINHAS_POR_ENVIO, montarLinhas, resumoSelecao, selecaoTerritorioSchema } from "@/lib/territorios/selecao";
import { formToObject } from "@/lib/validation/schemas";

const PAGINA = 1000;

/**
 * Salva a escolha em cascata Região → Estados → Municípios. Cada UF vira uma
 * cobertura "UF inteira" ou uma cobertura por município escolhido, para a
 * indústria escolhida (ou todas as ativas). O tenant vem da associação
 * validada no servidor; o banco ainda confere RLS, FK por tenant e se o
 * município pertence à UF. A inserção é um único comando (tudo ou nada).
 */
export async function addTerritories(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) throw new AuthorizationError("Você não tem permissão para editar territórios.", 403);
    const parsed = selecaoTerritorioSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const sel = parsed.data;
    const supabase = await createSupabaseServerClient();

    let industryIds: string[];
    if (sel.industry_id === "all") {
      const { data, error } = await supabase.from("industries").select("id").eq("tenant_id", ctx.tenantId).eq("active", true);
      if (error) return withValues({ message: dbErrorMessage(error) }, form);
      industryIds = (data ?? []).map((i) => i.id as string);
      if (!industryIds.length) return withValues({ fieldErrors: { industry_id: "Cadastre uma indústria antes." } }, form);
    } else {
      industryIds = [sel.industry_id];
    }

    // Coberturas já cadastradas nessas UFs, para não duplicar (paginado: o PostgREST limita a 1000 linhas).
    const existentes: CoberturaExistente[] = [];
    for (let from = 0; ; from += PAGINA) {
      const { data, error } = await supabase
        .from("territories")
        .select("industry_id, state_code, municipality_id, membership_id")
        .eq("tenant_id", ctx.tenantId)
        .in("industry_id", industryIds)
        .in("state_code", sel.selection.map((s) => s.uf))
        .order("id")
        .range(from, from + PAGINA - 1);
      if (error) return withValues({ message: dbErrorMessage(error) }, form);
      existentes.push(...((data ?? []) as CoberturaExistente[]));
      if (!data || data.length < PAGINA) break;
    }

    const { linhas, jaExistiam } = montarLinhas(sel, industryIds, existentes);
    if (!linhas.length) return withValues({ message: "Esta cobertura já está cadastrada." }, form);
    if (linhas.length > MAX_LINHAS_POR_ENVIO) {
      return withValues({ message: `Seleção grande demais (${linhas.length} coberturas). Divida em partes ou marque estados inteiros.` }, form);
    }

    const { error } = await supabase.from("territories").insert(linhas.map((l) => ({ ...l, tenant_id: ctx.tenantId })));
    if (error) {
      return withValues(
        {
          message:
            error.code === "23514" && /munic/i.test(error.message ?? "")
              ? "Algum município escolhido não pertence à UF. Recarregue a página e tente de novo."
              : error.code === "23505"
                ? "Parte desta cobertura foi cadastrada agora há pouco. Recarregue a página e tente de novo."
                : dbErrorMessage(error),
        },
        form,
      );
    }
    revalidatePath(`/app/${ctx.tenantId}/territorios`);
    const extra = jaExistiam ? ` ${jaExistiam} já existiam e foram mantidas.` : "";
    return {
      ok: true,
      nonce: Date.now(),
      message: `Cobertura adicionada: ${resumoSelecao(sel.selection)}.${extra}`,
    };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}

/** Remove uma cobertura (um município ou uma UF inteira). */
export async function removeTerritory(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("territories").delete().eq("id", String(form.get("territory_id") ?? "")).eq("tenant_id", ctx.tenantId);
  revalidatePath(`/app/${ctx.tenantId}/territorios`);
}

/** Remove de uma vez todas as coberturas de um grupo (mesma indústria, UF e responsável). */
export async function removeTerritoryGroup(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const ids = String(form.get("territory_ids") ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return;
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < ids.length; i += 200) {
    await supabase.from("territories").delete().eq("tenant_id", ctx.tenantId).in("id", ids.slice(i, i + 200));
  }
  revalidatePath(`/app/${ctx.tenantId}/territorios`);
}
