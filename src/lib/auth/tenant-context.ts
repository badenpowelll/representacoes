import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isTenantRole, type TenantRole } from "./permissions";

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type TenantContext = { userId: string; tenantId: string; role: TenantRole };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida, no servidor e a cada requisição, que o usuário autenticado possui
 * vínculo ativo com o tenant informado. Nunca confie no tenant_id do cliente
 * sem passar por aqui.
 */
export async function requireTenantContext(tenantId: string): Promise<TenantContext> {
  if (!UUID_RE.test(tenantId)) throw new AuthorizationError("Representação inválida", 403);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthorizationError("Sessão expirada ou inexistente", 401);

  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data || !isTenantRole(data.role)) {
    throw new AuthorizationError("Você não tem acesso a esta representação", 403);
  }
  return { userId: user.id, tenantId, role: data.role };
}
