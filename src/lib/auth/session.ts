import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthorizationError, requireTenantContext, type TenantContext } from "./tenant-context";

/** Usuário autenticado ou redireciona para o login. */
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");
  return { supabase, user };
}

/** Contexto do tenant para páginas: 401 → login; 403 → lista de representações. */
export async function requireTenantPage(tenantId: string): Promise<TenantContext> {
  try {
    return await requireTenantContext(tenantId);
  } catch (e) {
    if (e instanceof AuthorizationError && e.status === 401) redirect("/entrar");
    redirect("/app?acesso=negado");
  }
}
