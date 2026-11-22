import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/**
 * Isolamento multi-tenant: dois tenants fictícios (Alfa e Beta) não podem
 * ler, alterar, listar ou excluir dados um do outro.
 */
let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, alfaRep: string, betaAdmin: string, outsider: string;
let alfa: string, beta: string;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  alfaAdmin = await createUser(pool, "admin@alfa.test");
  alfaRep = await createUser(pool, "rep@alfa.test");
  betaAdmin = await createUser(pool, "admin@beta.test");
  outsider = await createUser(pool, "ninguem@exemplo.test");

  alfa = await asUser(pool, alfaAdmin, async (db) =>
    (await db.query("select public.create_tenant('Alfa Representações', 'alfa') as id")).rows[0].id,
  );
  beta = await asUser(pool, betaAdmin, async (db) =>
    (await db.query("select public.create_tenant('Beta Representações', 'beta') as id")).rows[0].id,
  );
  await asUser(pool, alfaAdmin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative')", [
      alfa,
      alfaRep,
    ]),
  );
});

afterAll(async () => {
  await drop?.();
});

describe("perfis", () => {
  it("são criados automaticamente ao cadastrar o usuário", async () => {
    const { rows } = await pool.query("select email from public.profiles where id = $1", [alfaAdmin]);
    expect(rows[0].email).toBe("admin@alfa.test");
  });

  it("usuário vê o próprio perfil e colegas, mas não usuários de outro tenant", async () => {
    const ids = await asUser(pool, alfaRep, async (db) =>
      (await db.query("select id from public.profiles")).rows.map((r) => r.id),
    );
    expect(ids).toEqual(expect.arrayContaining([alfaRep, alfaAdmin]));
    expect(ids).not.toContain(betaAdmin);
    expect(ids).not.toContain(outsider);
  });
});

describe("tenants", () => {
  it("cada usuário lista apenas os tenants dos quais é membro", async () => {
    const alfaSees = await asUser(pool, alfaAdmin, async (db) =>
      (await db.query("select slug from public.tenants")).rows.map((r) => r.slug),
    );
    const betaSees = await asUser(pool, betaAdmin, async (db) =>
      (await db.query("select slug from public.tenants")).rows.map((r) => r.slug),
    );
    expect(alfaSees).toEqual(["alfa"]);
    expect(betaSees).toEqual(["beta"]);
  });

  it("usuário sem vínculo e anônimo não veem nenhum tenant", async () => {
    const outsiderCount = await asUser(pool, outsider, async (db) =>
      (await db.query("select count(*)::int as n from public.tenants")).rows[0].n,
    );
    expect(outsiderCount).toBe(0);
    const anon = await tryAsUser(pool, null, (db) => db.query("select * from public.tenants"));
    expect(anon.ok).toBe(false);
  });

  it("admin de Beta não consegue alterar Alfa (0 linhas afetadas)", async () => {
    const affected = await asUser(pool, betaAdmin, async (db) =>
      (await db.query("update public.tenants set name = 'Invadido' where id = $1", [alfa])).rowCount,
    );
    expect(affected).toBe(0);
    const { rows } = await pool.query("select name from public.tenants where id = $1", [alfa]);
    expect(rows[0].name).toBe("Alfa Representações");
  });

  it("representante não altera dados do próprio tenant", async () => {
    const affected = await asUser(pool, alfaRep, async (db) =>
      (await db.query("update public.tenants set name = 'X' where id = $1", [alfa])).rowCount,
    );
    expect(affected).toBe(0);
  });

  it("ninguém exclui tenant pela API", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) => db.query("delete from public.tenants where id = $1", [alfa]));
    expect(r.ok).toBe(false);
  });

  it("anônimo não cria tenant", async () => {
    const r = await tryAsUser(pool, null, (db) => db.query("select public.create_tenant('X', 'x')"));
    expect(r.ok).toBe(false);
  });
});

describe("memberships", () => {
  it("admin de Beta não se adiciona a Alfa", async () => {
    const r = await tryAsUser(pool, betaAdmin, (db) =>
      db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'tenant_admin')", [
        alfa,
        betaAdmin,
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("42501");
  });

  it("representante não promove a si mesmo", async () => {
    const affected = await asUser(pool, alfaRep, async (db) =>
      (
        await db.query("update public.memberships set role = 'tenant_admin' where user_id = $1 and tenant_id = $2", [
          alfaRep,
          alfa,
        ])
      ).rowCount,
    );
    expect(affected).toBe(0);
  });

  it("admin de Beta não enxerga vínculos de Alfa", async () => {
    const n = await asUser(pool, betaAdmin, async (db) =>
      (await db.query("select count(*)::int as n from public.memberships where tenant_id = $1", [alfa])).rows[0].n,
    );
    expect(n).toBe(0);
  });

  it("vínculo não pode ser movido para outro tenant", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("update public.memberships set tenant_id = $1 where user_id = $2", [beta, alfaRep]),
    );
    expect(r.ok).toBe(false);
  });

  it("o último administrador não pode ser removido nem rebaixado", async () => {
    const del = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("delete from public.memberships where user_id = $1 and tenant_id = $2", [alfaAdmin, alfa]),
    );
    expect(del.ok).toBe(false);
    const demote = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("update public.memberships set role = 'viewer' where user_id = $1 and tenant_id = $2", [alfaAdmin, alfa]),
    );
    expect(demote.ok).toBe(false);
  });

  it("vínculo revogado perde o acesso", async () => {
    const temp = await createUser(pool, "temp@alfa.test");
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'viewer')", [alfa, temp]),
    );
    const before = await asUser(pool, temp, async (db) => (await db.query("select id from public.tenants")).rowCount);
    expect(before).toBe(1);
    await asUser(pool, alfaAdmin, (db) =>
      db.query("update public.memberships set status = 'revoked' where user_id = $1", [temp]),
    );
    const after = await asUser(pool, temp, async (db) => (await db.query("select id from public.tenants")).rowCount);
    expect(after).toBe(0);
  });
});

describe("convites", () => {
  it("admin convida no próprio tenant, mas não no de outro", async () => {
    const own = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query(
        "insert into public.invitations (tenant_id, email, role, token_hash, invited_by) values ($1, 'novo@alfa.test', 'assistant', 'h1', $2)",
        [alfa, alfaAdmin],
      ),
    );
    expect(own.ok).toBe(true);
    const cross = await tryAsUser(pool, betaAdmin, (db) =>
      db.query(
        "insert into public.invitations (tenant_id, email, role, token_hash, invited_by) values ($1, 'x@beta.test', 'assistant', 'h2', $2)",
        [alfa, betaAdmin],
      ),
    );
    expect(cross.ok).toBe(false);
  });

  it("representante não lê nem cria convites", async () => {
    const n = await asUser(pool, alfaRep, async (db) => (await db.query("select * from public.invitations")).rowCount);
    expect(n).toBe(0);
    const r = await tryAsUser(pool, alfaRep, (db) =>
      db.query(
        "insert into public.invitations (tenant_id, email, role, token_hash, invited_by) values ($1, 'y@alfa.test', 'viewer', 'h3', $2)",
        [alfa, alfaRep],
      ),
    );
    expect(r.ok).toBe(false);
  });
});

describe("auditoria", () => {
  it("criação de tenant é auditada e só o admin do tenant lê o log", async () => {
    const alfaLogs = await asUser(pool, alfaAdmin, async (db) =>
      (await db.query("select action, tenant_id from public.audit_logs")).rows,
    );
    expect(alfaLogs).toEqual([{ action: "tenant.created", tenant_id: alfa }]);
    const repLogs = await asUser(pool, alfaRep, async (db) => (await db.query("select * from public.audit_logs")).rowCount);
    expect(repLogs).toBe(0);
  });

  it("usuário não grava nem apaga log diretamente", async () => {
    const ins = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.audit_logs (tenant_id, action, entity) values ($1, 'fake', 'x')", [alfa]),
    );
    expect(ins.ok).toBe(false);
    const del = await tryAsUser(pool, alfaAdmin, (db) => db.query("delete from public.audit_logs"));
    expect(del.ok).toBe(false);
  });
});

describe("cobertura de RLS", () => {
  it("toda tabela do schema public tem RLS habilitado", async () => {
    const { rows } = await pool.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("platform_admins é inacessível para usuários autenticados", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) => db.query("select * from public.platform_admins"));
    expect(r.ok).toBe(false);
  });
});
