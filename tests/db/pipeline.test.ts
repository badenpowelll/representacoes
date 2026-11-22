import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, alfaRep: string, alfaViewer: string, betaAdmin: string;
let alfa: string, beta: string, ind: string, betaInd: string;
let natalCo: string, cearaCo: string, offTarget: string, betaCo: string;

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
    await db.query("insert into public.commercial_contexts (tenant_id, cnaes, segments) values ($1, '{4744001}', '{construção}')", [alfa]);
    ind = await id(db.query("insert into public.industries (tenant_id, name, segment) values ($1, 'Cimentos SA', 'construção') returning id", [alfa]));
    await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN')", [alfa, ind]);
    natalCo = await id(
      db.query("insert into public.companies (tenant_id, legal_name, cnae, segment, state_code) values ($1, 'Loja Natal', '4744001', 'construção', 'RN') returning id", [alfa]),
    );
    await db.query("insert into public.contacts (tenant_id, company_id, name, email) values ($1, $2, 'Compras', 'compras@lojanatal.test')", [alfa, natalCo]);
    offTarget = await id(
      db.query("insert into public.companies (tenant_id, legal_name, cnae, segment, state_code) values ($1, 'Padaria RN', '1091101', 'alimentos', 'RN') returning id", [alfa]),
    );
    cearaCo = await id(
      db.query("insert into public.companies (tenant_id, legal_name, cnae, state_code) values ($1, 'Loja CE', '4744001', 'CE') returning id", [alfa]),
    );
  });
  await asUser(pool, betaAdmin, async (db) => {
    betaInd = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind Beta') returning id", [beta]));
    betaCo = await id(db.query("insert into public.companies (tenant_id, legal_name, state_code) values ($1, 'Cliente Beta', 'RN') returning id", [beta]));
  });
});
afterAll(async () => drop?.());

describe("motor de compatibilidade", () => {
  it("pontua com explicação e ignora empresas fora do território", async () => {
    const n = await asUser(pool, alfaRep, async (db) => (await db.query("select public.compute_matches($1, $2) as n", [alfa, ind])).rows[0].n);
    expect(n).toBe(2);
    const rows = await asUser(pool, alfaRep, async (db) =>
      (await db.query("select company_id, score, reasons from public.matches order by score desc")).rows,
    );
    expect(rows.map((r) => r.company_id)).toEqual([natalCo, offTarget]);
    expect(rows[0].score).toBe(100);
    expect(rows[0].reasons.map((r: { criterion: string }) => r.criterion)).toEqual(["territory", "cnae", "segment", "reachable"]);
    expect(rows[1].score).toBe(40);
    expect(rows.map((r) => r.company_id)).not.toContain(cearaCo);
  });

  it("contato suprimido deixa de contar como alcançável; revisão humana é preservada", async () => {
    await asUser(pool, alfaRep, async (db) => {
      await db.query("update public.matches set review = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where company_id = $1", [natalCo]);
      await db.query("insert into public.suppression_list (tenant_id, domain, reason) values ($1, 'lojanatal.test', 'opt_out')", [alfa]);
      await db.query("select public.compute_matches($1, $2)", [alfa, ind]);
    });
    const { rows } = await pool.query("select score, review from public.matches where company_id = $1", [natalCo]);
    expect(rows[0]).toEqual({ score: 90, review: "approved" });
  });

  it("leitura não recalcula; Beta não calcula para Alfa nem vê os matches", async () => {
    const viewer = await tryAsUser(pool, alfaViewer, (db) => db.query("select public.compute_matches($1, $2)", [alfa, ind]));
    expect(viewer.ok).toBe(false);
    const cross = await tryAsUser(pool, betaAdmin, (db) => db.query("select public.compute_matches($1, $2)", [alfa, ind]));
    expect(cross.ok).toBe(false);
    const n = await asUser(pool, betaAdmin, async (db) => (await db.query("select * from public.matches")).rowCount);
    expect(n).toBe(0);
  });

  it("indústria de outro tenant não gera match", async () => {
    const n = await asUser(pool, alfaAdmin, async (db) => (await db.query("select public.compute_matches($1, $2) as n", [alfa, betaInd])).rows[0].n);
    expect(n).toBe(0);
  });
});

describe("funil", () => {
  it("lead exige fonte e é único por empresa e indústria", async () => {
    const noSource = await tryAsUser(pool, alfaRep, (db) =>
      db.query("insert into public.leads (tenant_id, company_id, industry_id, source) values ($1, $2, $3, null)", [alfa, natalCo, ind]),
    );
    expect(noSource.ok).toBe(false);
    await asUser(pool, alfaRep, (db) =>
      db.query("insert into public.leads (tenant_id, company_id, industry_id, source) values ($1, $2, $3, 'match aprovado')", [alfa, natalCo, ind]),
    );
    const dup = await tryAsUser(pool, alfaRep, (db) =>
      db.query("insert into public.leads (tenant_id, company_id, industry_id, source) values ($1, $2, $3, 'x')", [alfa, natalCo, ind]),
    );
    expect(dup.ok).toBe(false);
  });

  it("mudança de etapa gera histórico; perda exige motivo; ganho registra fechamento", async () => {
    const deal = await asUser(pool, alfaRep, (db) =>
      id(db.query("insert into public.deals (tenant_id, company_id, industry_id, title, amount) values ($1, $2, $3, 'Pedido inicial', 15000) returning id", [alfa, natalCo, ind])),
    );
    const lostNoReason = await tryAsUser(pool, alfaRep, (db) => db.query("update public.deals set stage = 'lost' where id = $1", [deal]));
    expect(lostNoReason.ok).toBe(false);
    await asUser(pool, alfaRep, async (db) => {
      await db.query("update public.deals set stage = 'negotiation' where id = $1", [deal]);
      await db.query("update public.deals set stage = 'won' where id = $1", [deal]);
    });
    const { rows } = await pool.query("select closed_at from public.deals where id = $1", [deal]);
    expect(rows[0].closed_at).not.toBeNull();
    const hist = await asUser(pool, alfaViewer, async (db) =>
      (await db.query("select metadata->>'to' as to from public.activities where deal_id = $1 and kind = 'stage_change' order by created_at", [deal])).rows.map(
        (r) => r.to,
      ),
    );
    expect(hist).toEqual(["negotiation", "won"]);
  });

  it("deal não referencia empresa de outro tenant; Beta não vê o funil de Alfa", async () => {
    const r = await tryAsUser(pool, alfaRep, (db) =>
      db.query("insert into public.deals (tenant_id, company_id, title) values ($1, $2, 'X')", [alfa, betaCo]),
    );
    expect(r.ok).toBe(false);
    const n = await asUser(pool, betaAdmin, async (db) => ({
      d: (await db.query("select * from public.deals")).rowCount,
      a: (await db.query("select * from public.activities")).rowCount,
      l: (await db.query("select * from public.leads")).rowCount,
    }));
    expect(n).toEqual({ d: 0, a: 0, l: 0 });
  });

  it("leitura não move cards", async () => {
    const n = await asUser(pool, alfaViewer, async (db) => (await db.query("update public.deals set stage = 'proposal'")).rowCount);
    expect(n).toBe(0);
  });
});
