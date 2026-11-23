import { describe, expect, it } from "vitest";
import { assignableRoles, can, effectiveRole, isTenantRole } from "./permissions";

describe("permissões", () => {
  it("leitura só lê", () => {
    expect(can("viewer", "data.read")).toBe(true);
    expect(can("viewer", "crm.write")).toBe(false);
  });

  it("somente administrador gerencia membros e lê auditoria", () => {
    expect(can("tenant_admin", "members.manage")).toBe(true);
    expect(can("manager", "members.manage")).toBe(false);
    expect(can("manager", "audit.read")).toBe(false);
  });

  it("sem papel não há permissão", () => {
    expect(can(null, "data.read")).toBe(false);
  });

  it("gerente não atribui papel de administrador", () => {
    expect(assignableRoles("manager")).not.toContain("tenant_admin");
    expect(assignableRoles("representative")).toEqual([]);
  });

  it("valida papéis desconhecidos", () => {
    expect(isTenantRole("tenant_admin")).toBe(true);
    expect(isTenantRole("platform_admin")).toBe(false);
  });
});

describe("effectiveRole (MFA)", () => {
  it("administrador sem AAL2 atua como leitura", () => {
    expect(effectiveRole("tenant_admin", "aal1")).toBe("viewer");
    expect(effectiveRole("tenant_admin", undefined)).toBe("viewer");
    expect(effectiveRole("tenant_admin", "aal2")).toBe("tenant_admin");
    expect(effectiveRole("tenant_admin", "aal1", false)).toBe("tenant_admin");
    expect(effectiveRole("tenant_admin", "aal1", true)).toBe("viewer");
  });
  it("demais papéis não dependem do nível da sessão", () => {
    expect(effectiveRole("manager", "aal1")).toBe("manager");
    expect(effectiveRole("viewer", "aal2")).toBe("viewer");
  });
});
