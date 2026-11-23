import "server-only";
import { fetchCnpjFromBrasilApi, LOOKUP_ERROR_MESSAGES } from "@/lib/cnpj/brasilapi";
import { fromRegistryRow, REGISTRY_COLUMNS, toRegistryRow, type CnpjRegistryData, type RegistryRow } from "@/lib/cnpj/registry";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type CnpjLookupResponse =
  | { ok: true; data: CnpjRegistryData & { fetchedAt: string }; cached: boolean }
  | { ok: false; message: string };

/** Reaproveita a consulta salva por até 30 dias (a Receita atualiza mensalmente). */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Consulta um CNPJ já validado: usa a consulta salva na representação (RLS por
 * tenant) ou chama a BrasilAPI e guarda o resultado. Quem chama já conferiu
 * vínculo e permissão.
 */
export async function lookupCnpjCached(
  supabase: Supabase,
  ctx: { tenantId: string; userId: string },
  cnpj: string,
  opts: { refresh?: boolean } = {},
): Promise<CnpjLookupResponse> {
  const { data: saved } = await supabase
    .from("cnpj_registry")
    .select(REGISTRY_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .eq("cnpj", cnpj)
    .maybeSingle();
  if (saved && !opts.refresh && Date.now() - new Date(saved.fetched_at).getTime() < MAX_AGE_MS) {
    return { ok: true, data: fromRegistryRow(saved as RegistryRow), cached: true };
  }

  const result = await fetchCnpjFromBrasilApi(cnpj);
  if (!result.ok) {
    // Sem a API, a última consulta salva (mesmo antiga) ainda ajuda.
    if (saved) return { ok: true, data: fromRegistryRow(saved as RegistryRow), cached: true };
    return { ok: false, message: LOOKUP_ERROR_MESSAGES[result.reason] };
  }

  const fetchedAt = new Date().toISOString();
  // Falha ao salvar não impede o preenchimento: o formulário ainda é validado no envio.
  await supabase.from("cnpj_registry").upsert(
    { ...toRegistryRow(result.data, result.raw), tenant_id: ctx.tenantId, fetched_by: ctx.userId, fetched_at: fetchedAt, provider: "brasilapi" },
    { onConflict: "tenant_id,cnpj" },
  );
  return { ok: true, data: { ...result.data, fetchedAt }, cached: false };
}
