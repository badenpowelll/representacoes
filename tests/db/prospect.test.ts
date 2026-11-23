import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, viewer: string, betaAdmin: string;
let alfa: string, beta: string, ind: string, ind2: string, betaInd: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const register = (user: string, args: Record<string, unknown>) =>
  asUser(pool, user, async (db) =>
    (await db.query(
      `select public.register_prospect(p_tenant => $1, p_industry => $2, p_legal_name => $3, p_source => $4,
         p_source_date => $5, p_cnpj => $6, p_state => $7, p_municipality => $8) as r`,
      [args.tenant, args.industry, args.name ?? "Loja X", args.source ?? "Receita Federal - dados abertos",
       args.date ?? "2026-11-01", args.cnpj ?? null, args.state ?? null, args.municipality ?? null],
    )).rows[0].r as { company_id: string; lead_id: string; company_existed: boolean },
  );
const tryRegister = (user: string, args: Record<string, unknown>) =>
  register(user, args).then(() => ({ ok: true as const }), (e: { code?: string }) => ({ ok: false as const, code: e.code }));

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@p.test");
  rep = await createUser(pool, "rep@p.test");
  viewer = await createUser(pool, "viewer@p.test");
  betaAdmin = await createUser(pool, "admin@pbeta.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('PAlfa', 'palfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('PBeta', 'pbeta') as id")));
  await asUser(pool, admin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [alfa, rep, viewer]);
    ind = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind A') returning id", [alfa]));
    ind2 = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind B') returning id", [alfa]));
  });
  betaInd = await asUser(pool, betaAdmin, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind Beta') returning id", [beta])));
});
afterAll(async () => drop?.());

describe("register_prospect", () => {
  it("representante cria empresa e lead com fonte e data", async () => {
    const r = await register(rep, { tenant: alfa, industry: ind, cnpj: "11222333000181", state: "RN", municipality: 2408102 });
    expect(r.company_existed).toBe(false);
    const { rows } = await pool.query("select c.kind, c.source, c.source_date::text, l.status, l.source as lead_source from public.leads l join public.companies c on c.id = l.company_id where l.id = $1", [r.lead_id]);
    expect(rows[0]).toEqual({ kind: "prospect", source: "Receita Federal - dados abertos", source_date: "2026-11-01", status: "new", lead_source: "Receita Federal - dados abertos" });
  });

  it("CNPJ já cadastrado reaproveita a empresa; mesmo par empresa/indústria é recusado", async () => {
    const r = await register(rep, { tenant: alfa, industry: ind2, cnpj: "11222333000181", name: "Outro nome" });
    expect(r.company_existed).toBe(true);
    const { rows } = await pool.query("select count(*)::int as n from public.companies where tenant_id = $1", [alfa]);
    expect(rows[0].n).toBe(1);
    expect(await tryRegister(rep, { tenant: alfa, industry: ind2, cnpj: "11222333000181" })).toEqual({ ok: false, code: "23505" });
  });

  it("exige fonte e data não futura, sem deixar empresa órfã", async () => {
    expect(await tryRegister(rep, { tenant: alfa, industry: ind, source: " ", cnpj: "45723174000110" })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRegister(rep, { tenant: alfa, industry: ind, date: "2999-01-01", cnpj: "45723174000110" })).toMatchObject({ ok: false, code: "23514" });
    // falha no lead depois de criar a empresa (indústria de outro tenant): nada fica gravado
    expect((await tryRegister(rep, { tenant: alfa, industry: betaInd, cnpj: "45723174000110" })).ok).toBe(false);
    const { rows } = await pool.query("select count(*)::int as n from public.companies where cnpj = '45723174000110'");
    expect(rows[0].n).toBe(0);
  });

  it("município precisa ser da UF", async () => {
    expect(await tryRegister(rep, { tenant: alfa, industry: ind, state: "CE", municipality: 2408102 })).toMatchObject({ ok: false, code: "23514" });
  });

  it("leitura não registra; outro tenant não usa indústria de Alfa nem grava em Alfa", async () => {
    expect((await tryRegister(viewer, { tenant: alfa, industry: ind })).ok).toBe(false);
    expect((await tryRegister(betaAdmin, { tenant: alfa, industry: ind })).ok).toBe(false);
    expect((await tryRegister(betaAdmin, { tenant: beta, industry: ind })).ok).toBe(false);
    expect((await tryRegister(betaAdmin, { tenant: beta, industry: betaInd })).ok).toBe(true);
    const { rows } = await pool.query("select count(*)::int as n from public.leads where tenant_id = $1", [alfa]);
    expect(rows[0].n).toBe(2);
  });
});
