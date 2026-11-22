import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, alfaRep: string, alfaViewer: string, betaAdmin: string;
let alfa: string, beta: string, alfaIndustry: string, betaIndustry: string, alfaRepMembership: string;

const one = async <T = Record<string, unknown>>(p: Promise<{ rows: T[] }>) => (await p).rows[0];

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  await pool.query(
    "insert into ref.municipalities (ibge_code, state_code, name) values (2408102, 'RN', 'Natal'), (2408003, 'RN', 'Mossoró'), (2304400, 'CE', 'Fortaleza')",
  );
  alfaAdmin = await createUser(pool, "admin@alfa.test");
  alfaRep = await createUser(pool, "rep@alfa.test");
  alfaViewer = await createUser(pool, "leitura@alfa.test");
  betaAdmin = await createUser(pool, "admin@beta.test");
  alfa = (await asUser(pool, alfaAdmin, (db) => one(db.query("select public.create_tenant('Alfa', 'alfa') as id")))).id as string;
  beta = (await asUser(pool, betaAdmin, (db) => one(db.query("select public.create_tenant('Beta', 'beta') as id")))).id as string;
  await asUser(pool, alfaAdmin, async (db) => {
    alfaRepMembership = (
      await one(
        db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative') returning id", [
          alfa,
          alfaRep,
        ]),
      )
    ).id as string;
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'viewer')", [alfa, alfaViewer]);
    alfaIndustry = (
      await one(db.query("insert into public.industries (tenant_id, name, cnpj) values ($1, 'Metalúrgica Alfa', '11222333000181') returning id", [alfa]))
    ).id as string;
  });
  betaIndustry = (
    await asUser(pool, betaAdmin, (db) =>
      one(db.query("insert into public.industries (tenant_id, name) values ($1, 'Têxtil Beta') returning id", [beta])),
    )
  ).id as string;
});

afterAll(async () => drop?.());

describe("referência global", () => {
  it("UFs estão disponíveis para leitura e não podem ser alteradas", async () => {
    const n = await asUser(pool, alfaRep, async (db) => (await db.query("select * from ref.states")).rowCount);
    expect(n).toBe(27);
    const r = await tryAsUser(pool, alfaAdmin, (db) => db.query("update ref.states set name = 'X' where code = 'RN'"));
    expect(r.ok).toBe(false);
  });
});

describe("contexto comercial", () => {
  it("admin grava; leitura lê; representante não altera; Beta não vê", async () => {
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.commercial_contexts (tenant_id, segments, cnaes, communication_tone) values ($1, $2, $3, 'consultivo')", [
        alfa,
        ["metalurgia"],
        ["2511000"],
      ]),
    );
    const seen = await asUser(pool, alfaViewer, async (db) => (await db.query("select tone from (select communication_tone as tone from public.commercial_contexts) t")).rows);
    expect(seen).toEqual([{ tone: "consultivo" }]);
    const upd = await asUser(pool, alfaRep, async (db) =>
      (await db.query("update public.commercial_contexts set goals = 'x' where tenant_id = $1", [alfa])).rowCount,
    );
    expect(upd).toBe(0);
    const beta = await asUser(pool, betaAdmin, async (db) => (await db.query("select * from public.commercial_contexts")).rowCount);
    expect(beta).toBe(0);
  });

  it("rejeita CNAE em formato inválido", async () => {
    const r = await tryAsUser(pool, betaAdmin, (db) =>
      db.query("insert into public.commercial_contexts (tenant_id, cnaes) values ($1, $2)", [beta, ["25.11-0"]]),
    );
    expect(r.ok).toBe(false);
  });
});

describe("indústrias", () => {
  it("cada tenant lista só as próprias indústrias", async () => {
    const names = await asUser(pool, betaAdmin, async (db) => (await db.query("select name from public.industries")).rows.map((r) => r.name));
    expect(names).toEqual(["Têxtil Beta"]);
  });

  it("Beta não cria indústria em Alfa nem altera/exclui a de Alfa", async () => {
    const ins = await tryAsUser(pool, betaAdmin, (db) => db.query("insert into public.industries (tenant_id, name) values ($1, 'Intrusa')", [alfa]));
    expect(ins.ok).toBe(false);
    const counts = await asUser(pool, betaAdmin, async (db) => ({
      upd: (await db.query("update public.industries set name = 'X' where id = $1", [alfaIndustry])).rowCount,
      del: (await db.query("delete from public.industries where id = $1", [alfaIndustry])).rowCount,
    }));
    expect(counts).toEqual({ upd: 0, del: 0 });
  });

  it("indústria não pode ser movida para outro tenant", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) => db.query("update public.industries set tenant_id = $1 where id = $2", [beta, alfaIndustry]));
    expect(r.ok).toBe(false);
  });

  it("representante lê mas não cria indústria", async () => {
    const r = await tryAsUser(pool, alfaRep, (db) => db.query("insert into public.industries (tenant_id, name) values ($1, 'Nova')", [alfa]));
    expect(r.ok).toBe(false);
  });

  it("CNPJ duplicado no mesmo tenant é rejeitado", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.industries (tenant_id, name, cnpj) values ($1, 'Outra', '11222333000181')", [alfa]),
    );
    expect(r.ok).toBe(false);
  });
});

describe("FKs compostas impedem relações entre tenants", () => {
  it("Alfa não vincula contato, acordo ou território à indústria de Beta", async () => {
    const contact = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.industry_contacts (tenant_id, industry_id, name) values ($1, $2, 'X')", [alfa, betaIndustry]),
    );
    const agreement = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.representation_agreements (tenant_id, industry_id, valid_from) values ($1, $2, current_date)", [alfa, betaIndustry]),
    );
    const territory = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN')", [alfa, betaIndustry]),
    );
    expect([contact.ok, agreement.ok, territory.ok]).toEqual([false, false, false]);
  });

  it("território de Beta não pode apontar para representante de Alfa", async () => {
    const r = await tryAsUser(pool, betaAdmin, (db) =>
      db.query("insert into public.territories (tenant_id, industry_id, state_code, membership_id) values ($1, $2, 'RN', $3)", [
        beta,
        betaIndustry,
        alfaRepMembership,
      ]),
    );
    expect(r.ok).toBe(false);
  });
});

describe("acordos de representação", () => {
  it("representante não vê condições comerciais; vigência inválida é rejeitada", async () => {
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.representation_agreements (tenant_id, industry_id, commission_pct, valid_from) values ($1, $2, 5, '2026-01-01')", [
        alfa,
        alfaIndustry,
      ]),
    );
    const n = await asUser(pool, alfaRep, async (db) => (await db.query("select * from public.representation_agreements")).rowCount);
    expect(n).toBe(0);
    const bad = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.representation_agreements (tenant_id, industry_id, valid_from, valid_until) values ($1, $2, '2026-06-01', '2026-01-01')", [
        alfa,
        alfaIndustry,
      ]),
    );
    expect(bad.ok).toBe(false);
  });
});

describe("territórios", () => {
  it("aceita município da UF e rejeita município de outra UF", async () => {
    const ok = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.territories (tenant_id, industry_id, state_code, municipality_id, membership_id, exclusive) values ($1, $2, 'RN', 2408102, $3, true)", [
        alfa,
        alfaIndustry,
        alfaRepMembership,
      ]),
    );
    expect(ok.ok).toBe(true);
    const bad = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.territories (tenant_id, industry_id, state_code, municipality_id) values ($1, $2, 'RN', 2304400)", [alfa, alfaIndustry]),
    );
    expect(bad.ok).toBe(false);
  });

  it("cobertura duplicada é rejeitada", async () => {
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'CE')", [alfa, alfaIndustry]),
    );
    const dup = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'CE')", [alfa, alfaIndustry]),
    );
    expect(dup.ok).toBe(false);
  });

  it("Beta não lista territórios de Alfa", async () => {
    const n = await asUser(pool, betaAdmin, async (db) => (await db.query("select * from public.territories")).rowCount);
    expect(n).toBe(0);
  });
});
