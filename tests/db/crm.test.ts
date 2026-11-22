import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, alfaRep: string, alfaViewer: string, betaAdmin: string;
let alfa: string, beta: string, alfaCompany: string, betaCompany: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  alfaAdmin = await createUser(pool, "admin@alfa.test");
  alfaRep = await createUser(pool, "rep@alfa.test");
  alfaViewer = await createUser(pool, "leitura@alfa.test");
  betaAdmin = await createUser(pool, "admin@beta.test");
  alfa = await asUser(pool, alfaAdmin, (db) => id(db.query("select public.create_tenant('Alfa', 'alfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('Beta', 'beta') as id")));
  await asUser(pool, alfaAdmin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [
      alfa,
      alfaRep,
      alfaViewer,
    ]);
  });
  alfaCompany = await asUser(pool, alfaRep, (db) =>
    id(
      db.query(
        "insert into public.companies (tenant_id, legal_name, cnpj, cnae, state_code, source, source_date, legal_basis) values ($1, 'Cliente Alfa Ltda', '11444777000161', '4744001', 'RN', 'cadastro manual', current_date, 'legitimate_interest') returning id",
        [alfa],
      ),
    ),
  );
  betaCompany = await asUser(pool, betaAdmin, (db) =>
    id(db.query("insert into public.companies (tenant_id, legal_name, cnpj) values ($1, 'Cliente Beta', '11444777000161') returning id", [beta])),
  );
});

afterAll(async () => drop?.());

describe("empresas", () => {
  it("mesmo CNPJ pode existir em tenants diferentes, mas não duplicado no mesmo tenant", async () => {
    const dup = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.companies (tenant_id, legal_name, cnpj) values ($1, 'Duplicada', '11444777000161')", [alfa]),
    );
    expect(dup.ok).toBe(false);
    expect(betaCompany).toBeTruthy();
  });

  it("Beta não lê, altera nem exclui empresas de Alfa", async () => {
    const res = await asUser(pool, betaAdmin, async (db) => ({
      sel: (await db.query("select * from public.companies where id = $1", [alfaCompany])).rowCount,
      upd: (await db.query("update public.companies set notes = 'x' where id = $1", [alfaCompany])).rowCount,
      del: (await db.query("delete from public.companies where id = $1", [alfaCompany])).rowCount,
    }));
    expect(res).toEqual({ sel: 0, upd: 0, del: 0 });
  });

  it("leitura não cria empresa", async () => {
    const r = await tryAsUser(pool, alfaViewer, (db) => db.query("insert into public.companies (tenant_id, legal_name) values ($1, 'X')", [alfa]));
    expect(r.ok).toBe(false);
  });
});

describe("contatos", () => {
  it("contato não pode ser vinculado a empresa de outro tenant", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.contacts (tenant_id, company_id, name) values ($1, $2, 'X')", [alfa, betaCompany]),
    );
    expect(r.ok).toBe(false);
  });

  it("base legal 'consentimento' exige data do consentimento", async () => {
    const r = await tryAsUser(pool, alfaRep, (db) =>
      db.query("insert into public.contacts (tenant_id, company_id, name, legal_basis) values ($1, $2, 'Y', 'consent')", [alfa, alfaCompany]),
    );
    expect(r.ok).toBe(false);
  });

  it("opt-out do contato entra na lista de supressão do próprio tenant", async () => {
    await asUser(pool, alfaRep, async (db) => {
      const cid = await id(
        db.query("insert into public.contacts (tenant_id, company_id, name, email, legal_basis, purposes, legal_basis_note, source) values ($1, $2, 'Maria', 'Maria@Cliente.test', 'legitimate_interest', '{prospecting}', 'Interesse comercial B2B no segmento atendido', 'cadastro manual') returning id", [
          alfa,
          alfaCompany,
        ]),
      );
      await db.query("update public.contacts set opted_out_at = now() where id = $1", [cid]);
    });
    const alfaSup = await asUser(pool, alfaRep, async (db) =>
      (await db.query("select public.is_suppressed($1, 'maria@cliente.test') as s", [alfa])).rows[0].s,
    );
    expect(alfaSup).toBe(true);
    const betaSup = await asUser(pool, betaAdmin, async (db) =>
      (await db.query("select public.is_suppressed($1, 'maria@cliente.test') as s", [beta])).rows[0].s,
    );
    expect(betaSup).toBe(false);
  });
});

describe("lista de supressão", () => {
  it("bloqueio por domínio vale para qualquer e-mail do domínio", async () => {
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.suppression_list (tenant_id, domain, reason) values ($1, 'concorrente.test', 'manual')", [alfa]),
    );
    const s = await asUser(pool, alfaRep, async (db) =>
      (await db.query("select public.is_suppressed($1, 'joao@CONCORRENTE.test') as s", [alfa])).rows[0].s,
    );
    expect(s).toBe(true);
  });

  it("representante bloqueia mas não desbloqueia; Beta não consulta a lista de Alfa", async () => {
    const del = await asUser(pool, alfaRep, async (db) => (await db.query("delete from public.suppression_list")).rowCount);
    expect(del).toBe(0);
    const cross = await tryAsUser(pool, betaAdmin, (db) => db.query("select public.is_suppressed($1, 'x@concorrente.test')", [alfa]));
    expect(cross.ok).toBe(false);
    const list = await asUser(pool, betaAdmin, async (db) => (await db.query("select * from public.suppression_list")).rowCount);
    expect(list).toBe(0);
  });
});
