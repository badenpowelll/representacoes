import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { effectiveRole, isTenantRole, type TenantRole } from "./permissions";

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type TenantContext = {
  userId: string;
  tenantId: string;
  /** Papel efetivo nesta sessão (use em can()). */
  role: TenantRole;
  /** Papel do vínculo, independentemente do MFA. */
  membershipRole: TenantRole;
  /** Administrador cuja sessão ainda não passou pelo segundo fator. */
  mfaPending: boolean;
};

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
  // O banco aplica a mesma regra (app.has_role lê o claim "aal" do JWT).
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const level = aal?.currentLevel ?? "aal1";
  return {
    userId: user.id,
    tenantId,
    membershipRole: data.role,
    role: effectiveRole(data.role, level),
    mfaPending: data.role === "tenant_admin" && level !== "aal2",
  };
}
