import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/** Regressões do parecer 002 (P1) sobre aceite de convites. */
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, manager: string, tenant: string;

const invite = (by: string, email: string, role = "assistant") =>
  asUser(pool, by, async (db) =>
    (await db.query("select * from public.create_invitation($1, $2, $3)", [tenant, email, role])).rows[0] as { invitation_id: string; token: string },
  );
const accept = (user: string, token: string) => tryAsUser(pool, user, (db) => db.query("select public.accept_invitation($1)", [token]));

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@omega.test");
  manager = await createUser(pool, "gerente@omega.test");
  tenant = await asUser(pool, admin, async (db) => (await db.query("select public.create_tenant('Omega', 'omega') as id")).rows[0].id);
  await asUser(pool, admin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'manager')", [tenant, manager]),
  );
});
afterAll(async () => drop?.());

describe("aceite de convite endurecido", () => {
  it("e-mail não confirmado não aceita", async () => {
    const u = await createUser(pool, "naoconfirmado@omega.test", { confirmed: false });
    const { token } = await invite(admin, "naoconfirmado@omega.test");
    expect((await accept(u, token)).ok).toBe(false);
    await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
    expect((await accept(u, token)).ok).toBe(true);
  });

  it("convite não altera o papel de quem já é membro", async () => {
    const { token } = await invite(admin, "gerente@omega.test", "tenant_admin");
    const r = await accept(manager, token);
    expect(r.ok).toBe(false);
    const { rows } = await pool.query("select role from public.memberships where user_id = $1", [manager]);
    expect(rows[0].role).toBe("manager");
  });

  it("convite antigo não reativa vínculo revogado", async () => {
    const u = await createUser(pool, "ex@omega.test");
    const old = await invite(admin, "ex@omega.test", "viewer");
    expect((await accept(u, old.token)).ok).toBe(true);
    await asUser(pool, admin, (db) => db.query("update public.memberships set status = 'revoked' where user_id = $1", [u]));
    const again = await invite(admin, "ex@omega.test", "viewer");
    expect((await accept(u, again.token)).ok).toBe(false);
    const { rows } = await pool.query("select status from public.memberships where user_id = $1", [u]);
    expect(rows[0].status).toBe("revoked");
  });

  it("convite perde validade quando quem convidou perde a autorização", async () => {
    const u = await createUser(pool, "novo@omega.test");
    const { token } = await invite(manager, "novo@omega.test", "representative");
    await asUser(pool, admin, (db) => db.query("update public.memberships set role = 'viewer' where user_id = $1", [manager]));
    expect((await accept(u, token)).ok).toBe(false);
    await asUser(pool, admin, (db) => db.query("update public.memberships set role = 'manager' where user_id = $1", [manager]));
    expect((await accept(u, token)).ok).toBe(true);
  });
});
