"use server";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { lookupCnpjCached, type CnpjLookupResponse } from "@/lib/cnpj/lookup";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidCnpj, normalizeCnpj } from "@/lib/validation/cnpj";

export type { CnpjLookupResponse };

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
  const res = await lookupCnpjCached(supabase, ctx, cnpj, opts);
  if (res.ok && !res.cached && opts.refresh) revalidatePath(`/app/${ctx.tenantId}`, "layout");
  return res;
}
