import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/**
 * Parecer 002 (P1): privilégios de administrador exigem sessão AAL2.
 * Com AAL1 o administrador só lê; gerentes e demais papéis não mudam.
 */
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, manager: string, tenant: string;
const aal1 = { aal: "aal1" as const };

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@mfa.test");
  manager = await createUser(pool, "gerente@mfa.test");
  tenant = await asUser(pool, admin, async (db) => (await db.query("select public.create_tenant('Mfa', 'mfa') as id")).rows[0].id);
  await asUser(pool, admin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'manager')", [tenant, manager]),
  );
});
afterAll(async () => drop?.());

describe("administrador com sessão AAL1", () => {
  it("continua lendo os dados da representação", async () => {
    const rows = await asUser(pool, admin, async (db) => (await db.query("select id from public.tenants")).rows, aal1);
    expect(rows).toHaveLength(1);
    const members = await asUser(pool, admin, async (db) => (await db.query("select id from public.memberships")).rows, aal1);
    expect(members).toHaveLength(2);
  });

  it("não altera a representação nem cadastra indústrias", async () => {
    const upd = await asUser(pool, admin, async (db) =>
      (await db.query("update public.tenants set name = 'X' where id = $1", [tenant])).rowCount, aal1);
    expect(upd).toBe(0);
    const ins = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind')", [tenant]), aal1);
    expect(ins).toMatchObject({ ok: false, code: "42501" });
  });

  it("não gerencia membros, convites nem lê auditoria", async () => {
    const upd = await asUser(pool, admin, async (db) =>
      (await db.query("update public.memberships set role = 'viewer' where user_id = $1", [manager])).rowCount, aal1);
    expect(upd).toBe(0);
    const inv = await tryAsUser(pool, admin, (db) =>
      db.query("select * from public.create_invitation($1, 'x@mfa.test', 'viewer')", [tenant]), aal1);
    expect(inv).toMatchObject({ ok: false, code: "42501" });
    const audit = await asUser(pool, admin, async (db) => (await db.query("select 1 from public.audit_logs")).rows, aal1);
    expect(audit).toHaveLength(0);
    const auditAal2 = await asUser(pool, admin, async (db) => (await db.query("select 1 from public.audit_logs")).rows);
    expect(auditAal2.length).toBeGreaterThan(0);
  });

  it("claim ausente conta como AAL1 (sem bypass)", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
      const { rowCount } = await client.query("update public.tenants set name = 'Y' where id = $1", [tenant]);
      expect(rowCount).toBe(0);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("com AAL2 recupera os privilégios", async () => {
    const upd = await asUser(pool, admin, async (db) =>
      (await db.query("update public.tenants set name = 'Mfa 2' where id = $1", [tenant])).rowCount);
    expect(upd).toBe(1);
  });
});

describe("demais papéis não dependem de AAL2", () => {
  it("gerente com AAL1 cadastra indústria e convida", async () => {
    const ins = await tryAsUser(pool, manager, (db) =>
      db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind Gerente')", [tenant]), aal1);
    expect(ins.ok).toBe(true);
    const inv = await tryAsUser(pool, manager, (db) =>
      db.query("select * from public.create_invitation($1, 'y@mfa.test', 'viewer')", [tenant]), aal1);
    expect(inv.ok).toBe(true);
  });
});
