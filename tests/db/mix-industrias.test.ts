import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

// Um cliente, várias indústrias: busca e inclusão no mix (CNPJs fictícios).
const NATAL = 2408102;
const MOSSORO = 2408003;

let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, betaAdmin: string;
let alfa: string, beta: string, balmak: string, biobase: string, petribu: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
type Hit = { cnpj: string; industries: { id: string; name: string; lead_id: string | null }[]; industry_count: number; linked_count: number; company_id: string | null };
const mix = (user: string, tenant: string, opts: Record<string, unknown> = {}) =>
  asUser(pool, user, async (db) =>
    (await db.query("select * from public.prospect_search_mix(p_tenant => $1, p_hide_in_portfolio => $2, p_include_secondary => $3)", [
      tenant, opts.hide ?? false, opts.secondary ?? false,
    ])).rows as Hit[],
  );

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@mix.test");
  rep = await createUser(pool, "rep@mix.test");
  betaAdmin = await createUser(pool, "admin@mixbeta.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('MixAlfa', 'mixalfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('MixBeta', 'mixbeta') as id")));
  await asUser(pool, admin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative')", [alfa, rep]);
    balmak = await id(db.query("insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Balmak', '{8610101,8630503}') returning id", [alfa]));
    biobase = await id(db.query("insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Biobase', '{8630503,8640202}') returning id", [alfa]));
    petribu = await id(db.query("insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Petribu', '{8630503}') returning id", [alfa]));
    await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN'), ($1, $3, 'RN')", [alfa, balmak, biobase]);
    // Petribu só atende Natal: não deve aparecer para Mossoró.
    await db.query("insert into public.territories (tenant_id, industry_id, state_code, municipality_id) values ($1, $2, 'RN', $3)", [alfa, petribu, NATAL]);
  });
  await asUser(pool, betaAdmin, async (db) => {
    const i = await id(db.query("insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Beta', '{8610101}') returning id", [beta]));
    await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN')", [beta, i]);
  });
  await pool.query(
    `insert into ref.cnpj_establishments (cnpj, legal_name, is_headquarters, main_cnae, secondary_cnaes, state_code, municipality_id, phones, email, dataset_ref) values
     ('91000000000101', 'HOSPITAL MIX NATAL', true, '8610101', '{8640202}', 'RN', ${NATAL}, '{8432000000}', 'h@mix.test', '2026-10'),
     ('91000000000202', 'CLINICA MIX NATAL', true, '8630503', '{}', 'RN', ${NATAL}, '{84999990000}', 'c@mix.test', '2026-10'),
     ('91000000000303', 'CLINICA MIX MOSSORO', true, '8630503', '{}', 'RN', ${MOSSORO}, '{}', null, '2026-10'),
     ('91000000000404', 'PADARIA MIX', true, '1091102', '{}', 'RN', ${NATAL}, '{}', null, '2026-10')`,
  );
});
afterAll(async () => drop?.());

const names = (h: Hit | undefined) => h?.industries.map((i) => i.name);

describe("prospect_search_mix", () => {
  it("lista cada empresa uma vez com todas as indústrias compatíveis (CNAE + território)", async () => {
    const rows = await mix(rep, alfa);
    const by = new Map(rows.map((r) => [r.cnpj, r]));
    expect([...by.keys()].sort()).toEqual(["91000000000101", "91000000000202", "91000000000303"]);
    expect(names(by.get("91000000000101"))).toEqual(["Balmak"]);
    expect(names(by.get("91000000000202"))).toEqual(["Balmak", "Biobase", "Petribu"]);
    expect(names(by.get("91000000000303"))).toEqual(["Balmak", "Biobase"]);
    expect(rows[0].cnpj).toBe("91000000000202"); // mais indústrias primeiro
  });

  it("CNAE secundário amplia o mix quando pedido", async () => {
    const h = (await mix(rep, alfa, { secondary: true })).find((r) => r.cnpj === "91000000000101");
    expect(names(h)).toEqual(["Balmak", "Biobase"]);
  });

  it("outro tenant só vê as próprias indústrias e não consulta Alfa", async () => {
    expect((await mix(betaAdmin, beta)).map((r) => [r.cnpj, names(r)])).toEqual([["91000000000101", ["Beta"]]]);
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query("select * from public.prospect_search_mix($1)", [alfa]))).ok).toBe(false);
  });
});

describe("prospect_add_mix", () => {
  it("cria um lead por indústria compatível, com uma única empresa e contato", async () => {
    const r = await asUser(pool, rep, async (db) => (await db.query("select public.prospect_add_mix($1, $2) as r", [alfa, "91000000000202"])).rows[0].r);
    expect(r.leads_created).toBe(3);
    const { rows } = await pool.query(
      "select i.name from public.leads l join public.industries i on i.id = l.industry_id where l.company_id = $1 order by i.name",
      [r.company_id],
    );
    expect(rows.map((x) => x.name)).toEqual(["Balmak", "Biobase", "Petribu"]);
    const contacts = await pool.query("select count(*)::int as n from public.contacts where company_id = $1", [r.company_id]);
    expect(contacts.rows[0].n).toBe(1);
    const h = (await mix(rep, alfa)).find((x) => x.cnpj === "91000000000202");
    expect(h?.linked_count).toBe(3);
    expect((await mix(rep, alfa, { hide: true })).some((x) => x.cnpj === "91000000000202")).toBe(false);
  });

  it("pode limitar às indústrias escolhidas e ignora as incompatíveis", async () => {
    const r = await asUser(pool, rep, async (db) =>
      (await db.query("select public.prospect_add_mix($1, $2, $3::uuid[]) as r", [alfa, "91000000000303", [biobase, petribu]])).rows[0].r,
    );
    expect(r.industries).toEqual([biobase]);
  });

  it("recusa empresa sem indústria compatível", async () => {
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.prospect_add_mix($1, $2)", [alfa, "91000000000404"]))).toMatchObject({ ok: false, code: "P0002" });
  });
});

describe("company_industry_fit", () => {
  it("mostra o encaixe da empresa com cada indústria e os vínculos existentes", async () => {
    const { rows: c } = await pool.query("select id from public.companies where tenant_id = $1 and cnpj = '91000000000303'", [alfa]);
    const fit = await asUser(pool, rep, async (db) => (await db.query("select industry_name, cnae_match, territory_match, lead_id is not null as linked from public.company_industry_fit($1, $2)", [alfa, c[0].id])).rows);
    expect(fit).toEqual([
      { industry_name: "Biobase", cnae_match: true, territory_match: true, linked: true },
      { industry_name: "Balmak", cnae_match: true, territory_match: true, linked: false },
      { industry_name: "Petribu", cnae_match: true, territory_match: false, linked: false },
    ]);
    const other = await asUser(pool, betaAdmin, async (db) => (await db.query("select * from public.company_industry_fit($1, $2)", [alfa, c[0].id])).rows);
    expect(other).toEqual([]);
  });
});
