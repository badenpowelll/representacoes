/**
 * Matriz de permissões por papel dentro de uma representação (tenant).
 * Espelha as políticas RLS do banco; o banco continua sendo a autoridade final.
 */
export const TENANT_ROLES = ["tenant_admin", "manager", "representative", "assistant", "viewer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const ROLE_LABELS: Record<TenantRole, string> = {
  tenant_admin: "Administrador da representação",
  manager: "Gerente",
  representative: "Representante",
  assistant: "Assistente",
  viewer: "Leitura",
};

export type Permission =
  | "tenant.update"
  | "members.manage"
  | "invitations.manage"
  | "audit.read"
  | "catalog.write"
  | "crm.write"
  | "deals.write"
  | "campaigns.approve"
  | "data.read";

const MATRIX: Record<TenantRole, readonly Permission[]> = {
  tenant_admin: [
    "tenant.update",
    "members.manage",
    "invitations.manage",
    "audit.read",
    "catalog.write",
    "crm.write",
    "deals.write",
    "campaigns.approve",
    "data.read",
  ],
  manager: ["invitations.manage", "catalog.write", "crm.write", "deals.write", "campaigns.approve", "data.read"],
  representative: ["crm.write", "deals.write", "data.read"],
  assistant: ["crm.write", "data.read"],
  viewer: ["data.read"],
};

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === "string" && (TENANT_ROLES as readonly string[]).includes(value);
}

export function can(role: TenantRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role].includes(permission);
}

/** Papéis que um usuário com `role` pode atribuir em convites. */
export function assignableRoles(role: TenantRole): TenantRole[] {
  if (role === "tenant_admin") return [...TENANT_ROLES];
  if (role === "manager") return TENANT_ROLES.filter((r) => r !== "tenant_admin");
  return [];
}

/** Nível de garantia da sessão do Supabase Auth. */
export type AssuranceLevel = "aal1" | "aal2";

/**
 * Papel efetivo da sessão. Espelha app.has_role no banco: administrador sem
 * MFA verificado na sessão (AAL1) atua como "leitura" até concluir o segundo fator.
 */
export function effectiveRole(role: TenantRole, aal: string | null | undefined, mfaRequired = true): TenantRole {
  return role === "tenant_admin" && mfaRequired && aal !== "aal2" ? "viewer" : role;
}
