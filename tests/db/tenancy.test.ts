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
  const invite = (user: string, tenant: string, email: string, role = "assistant") =>
    asUser(pool, user, async (db) =>
      (await db.query("select * from public.create_invitation($1, $2, $3)", [tenant, email, role])).rows[0] as {
        invitation_id: string;
        token: string;
      },
    );

  it("admin convida no próprio tenant; o banco guarda só o hash do token", async () => {
    const { invitation_id, token } = await invite(alfaAdmin, alfa, "Novo@Alfa.test");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const { rows } = await pool.query("select email, token_hash from public.invitations where id = $1", [invitation_id]);
    expect(rows[0].email).toBe("novo@alfa.test");
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("admin de Beta não convida em Alfa", async () => {
    const r = await tryAsUser(pool, betaAdmin, (db) =>
      db.query("select * from public.create_invitation($1, 'x@beta.test', 'assistant')", [alfa]),
    );
    expect(r.ok).toBe(false);
  });

  it("representante não lê nem cria convites; insert direto na tabela é negado", async () => {
    const n = await asUser(pool, alfaRep, async (db) => (await db.query("select * from public.invitations")).rowCount);
    expect(n).toBe(0);
    const rpc = await tryAsUser(pool, alfaRep, (db) =>
      db.query("select * from public.create_invitation($1, 'y@alfa.test', 'viewer')", [alfa]),
    );
    expect(rpc.ok).toBe(false);
    const direct = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query(
        "insert into public.invitations (tenant_id, email, role, token_hash, invited_by) values ($1, 'z@alfa.test', 'viewer', 'h', $2)",
        [alfa, alfaAdmin],
      ),
    );
    expect(direct.ok).toBe(false);
  });

  it("gerente não convida administrador nem altera o papel de um convite", async () => {
    const manager = await createUser(pool, "gerente@alfa.test");
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'manager')", [alfa, manager]),
    );
    const r = await tryAsUser(pool, manager, (db) =>
      db.query("select * from public.create_invitation($1, 'chefe@alfa.test', 'tenant_admin')", [alfa]),
    );
    expect(r.ok).toBe(false);
    const { invitation_id } = await invite(manager, alfa, "aux@alfa.test", "viewer");
    const up = await tryAsUser(pool, manager, (db) =>
      db.query("update public.invitations set role = 'tenant_admin' where id = $1", [invitation_id]),
    );
    expect(up.ok).toBe(false);
  });

  it("convidado aceita uma vez; reutilizar o token falha", async () => {
    const guest = await createUser(pool, "convidado@alfa.test");
    const { token } = await invite(alfaAdmin, alfa, "convidado@alfa.test", "representative");
    const tenant = await asUser(pool, guest, async (db) =>
      (await db.query("select public.accept_invitation($1) as t", [token])).rows[0].t,
    );
    expect(tenant).toBe(alfa);
    const role = (await pool.query("select role from public.memberships where user_id = $1", [guest])).rows[0].role;
    expect(role).toBe("representative");
    const again = await tryAsUser(pool, guest, (db) => db.query("select public.accept_invitation($1)", [token]));
    expect(again.ok).toBe(false);
  });

  it("token de outro e-mail, expirado, revogado ou inexistente é rejeitado", async () => {
    const { token: forOther } = await invite(alfaAdmin, alfa, "outra@alfa.test");
    const wrongUser = await tryAsUser(pool, outsider, (db) => db.query("select public.accept_invitation($1)", [forOther]));
    expect(wrongUser.ok).toBe(false);

    const exp = await createUser(pool, "expira@alfa.test");
    const { invitation_id, token: expired } = await invite(alfaAdmin, alfa, "expira@alfa.test");
    await pool.query("update public.invitations set expires_at = now() - interval '1 minute' where id = $1", [
      invitation_id,
    ]);
    const r1 = await tryAsUser(pool, exp, (db) => db.query("select public.accept_invitation($1)", [expired]));
    expect(r1.ok).toBe(false);

    const rev = await createUser(pool, "revogado@alfa.test");
    const inv = await invite(alfaAdmin, alfa, "revogado@alfa.test");
    await asUser(pool, alfaAdmin, (db) => db.query("select public.revoke_invitation($1)", [inv.invitation_id]));
    const r2 = await tryAsUser(pool, rev, (db) => db.query("select public.accept_invitation($1)", [inv.token]));
    expect(r2.ok).toBe(false);

    const r3 = await tryAsUser(pool, rev, (db) => db.query("select public.accept_invitation('nao-existe')"));
    expect(r3.ok).toBe(false);
  });

  it("admin de Beta não revoga convite de Alfa", async () => {
    const { invitation_id } = await invite(alfaAdmin, alfa, "protegido@alfa.test");
    const r = await tryAsUser(pool, betaAdmin, (db) => db.query("select public.revoke_invitation($1)", [invitation_id]));
    expect(r.ok).toBe(false);
  });
});

describe("concorrência", () => {
  it("duas transações simultâneas não removem os dois últimos administradores", async () => {
    const admin1 = await createUser(pool, "a1@gama.test");
    const admin2 = await createUser(pool, "a2@gama.test");
    const gama = await asUser(pool, admin1, async (db) =>
      (await db.query("select public.create_tenant('Gama', 'gama') as id")).rows[0].id,
    );
    await asUser(pool, admin1, (db) =>
      db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'tenant_admin')", [gama, admin2]),
    );

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    const begin = async (c: typeof c1, uid: string) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
    };
    try {
      await begin(c1, admin1);
      await begin(c2, admin2);
      // cada admin rebaixa a si mesmo; ambos enxergam o outro ainda ativo
      await c1.query("update public.memberships set role = 'viewer' where user_id = $1 and tenant_id = $2", [admin1, gama]);
      await c2.query("update public.memberships set role = 'viewer' where user_id = $1 and tenant_id = $2", [admin2, gama]);
      const results = await Promise.allSettled([c1.query("commit"), c2.query("commit")]);
      const failed = results.filter((r) => r.status === "rejected");
      expect(failed).toHaveLength(1);
    } finally {
      c1.release();
      c2.release();
    }
    const { rows } = await pool.query(
      "select count(*)::int as n from public.memberships where tenant_id = $1 and role = 'tenant_admin' and status = 'active'",
      [gama],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("auditoria", () => {
  it("criação de tenant é auditada e só o admin do tenant lê o log", async () => {
    const alfaLogs = await asUser(pool, alfaAdmin, async (db) =>
      (await db.query("select action, tenant_id from public.audit_logs")).rows,
    );
    expect(alfaLogs).toContainEqual({ action: "tenant.created", tenant_id: alfa });
    expect(alfaLogs.every((l) => l.tenant_id === alfa)).toBe(true);
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
