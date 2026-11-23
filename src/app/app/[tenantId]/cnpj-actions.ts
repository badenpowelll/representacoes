"use server";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { fetchCnpjFromBrasilApi, LOOKUP_ERROR_MESSAGES } from "@/lib/cnpj/brasilapi";
import { fromRegistryRow, REGISTRY_COLUMNS, toRegistryRow, type CnpjRegistryData, type RegistryRow } from "@/lib/cnpj/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidCnpj, normalizeCnpj } from "@/lib/validation/cnpj";

export type CnpjLookupResponse =
  | { ok: true; data: CnpjRegistryData & { fetchedAt: string }; cached: boolean }
  | { ok: false; message: string };

/** Reaproveita a consulta salva por até 30 dias (a Receita atualiza mensalmente). */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Consulta um CNPJ e guarda o resultado na representação (RLS por tenant).
 * Valida vínculo e permissão no servidor; o tenant vem do cliente só como
 * pedido e é conferido em requireTenantContext.
 */
export async function lookupCnpj(tenantId: string, cnpjInput: string, opts: { refresh?: boolean } = {}): Promise<CnpjLookupResponse> {
  let ctx;
  try {
    ctx = await requireTenantContext(String(tenantId));
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, message: e.message };
    throw e;
  }
  if (!can(ctx.role, "crm.write") && !can(ctx.role, "catalog.write")) {
    return { ok: false, message: "Você não tem permissão para consultar CNPJ." };
  }
  const cnpj = normalizeCnpj(String(cnpjInput ?? ""));
  if (!isValidCnpj(cnpj)) return { ok: false, message: "CNPJ inválido." };

  const supabase = await createSupabaseServerClient();
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
  const { error } = await supabase.from("cnpj_registry").upsert(
    { ...toRegistryRow(result.data, result.raw), tenant_id: ctx.tenantId, fetched_by: ctx.userId, fetched_at: fetchedAt, provider: "brasilapi" },
    { onConflict: "tenant_id,cnpj" },
  );
  // Falha ao salvar não impede o preenchimento: o formulário ainda é validado no envio.
  if (!error && opts.refresh) revalidatePath(`/app/${ctx.tenantId}`, "layout");
  return { ok: true, data: { ...result.data, fetchedAt }, cached: false };
}
