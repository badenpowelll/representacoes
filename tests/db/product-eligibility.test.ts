import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/**
 * Parecer 004-complemento, P1-5: preço verificável (origem, referência,
 * responsável e data gravados pelo servidor), histórico e elegibilidade
 * centralizada para comunicação comercial.
 */
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, manager: string, rep: string, other: string;
let tenant: string, beta: string, ind: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
type Row = { product_id: string; eligible: boolean; reason: string | null; authorized_price: string | null };
const elig = (user: string, t = tenant, on?: string) =>
  asUser(pool, user, async (db) =>
    (await db.query("select * from public.product_eligibility($1, null, $2::date)", [t, on ?? null])).rows as Row[]);
const product = (sku: string, extra = "", vals = "") =>
  asUser(pool, manager, (db) =>
    id(db.query(`insert into public.products (tenant_id, industry_id, sku, name${extra}) values ($1, $2, $3, 'P'${vals}) returning id`, [tenant, ind, sku])));
const PRICED = ", authorized_price, price_valid_until, price_source, price_reference";
const pricedVals = (until: string) => `, 10.50, '${until}', 'tabela da indústria', 'TAB-2026-11'`;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@precos.test");
  manager = await createUser(pool, "gerente@precos.test");
  rep = await createUser(pool, "rep@precos.test");
  other = await createUser(pool, "admin@outro-precos.test");
  tenant = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('Preços', 'precos') as id")));
  beta = await asUser(pool, other, (db) => id(db.query("select public.create_tenant('Outro', 'outro-precos') as id")));
  await asUser(pool, admin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'representative')", [tenant, manager, rep]));
  ind = await asUser(pool, admin, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind') returning id", [tenant])));
});
afterAll(async () => drop?.());

describe("procedência do preço", () => {
  it("preço sem origem ou referência é recusado; vigência sem preço também", async () => {
    const semRef = await tryAsUser(pool, manager, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, sku, name, authorized_price, price_source) values ($1, $2, 'S1', 'P', 5, 'tabela')", [tenant, ind]));
    expect(semRef).toMatchObject({ ok: false, code: "23514" });
    const semPreco = await tryAsUser(pool, manager, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, sku, name, price_valid_until) values ($1, $2, 'S2', 'P', '2099-01-01')", [tenant, ind]));
    expect(semPreco).toMatchObject({ ok: false, code: "23514" });
  });

  it("responsável e data são do servidor e não podem ser forjados; histórico registra mudanças", async () => {
    const pid = await product("H1", PRICED + ", price_authorized_by, price_authorized_at", pricedVals("2099-12-31") + `, '${admin}', '2000-01-01'`);
    let row = (await pool.query("select price_authorized_by, price_authorized_at from public.products where id = $1", [pid])).rows[0];
    expect(row.price_authorized_by).toBe(manager);
    expect(new Date(row.price_authorized_at).getFullYear()).toBeGreaterThan(2000);
    // Mudar outra coluna não reescreve quem autorizou.
    await asUser(pool, manager, (db) =>
      db.query("update public.products set name = 'Novo', price_authorized_by = $2 where id = $1", [pid, admin]));
    row = (await pool.query("select price_authorized_by from public.products where id = $1", [pid])).rows[0];
    expect(row.price_authorized_by).toBe(manager);
    await asUser(pool, manager, (db) => db.query("update public.products set authorized_price = 11 where id = $1", [pid]));
    const hist = (await pool.query("select authorized_price from public.product_price_history where product_id = $1 order by changed_at, id", [pid])).rows;
    expect(hist.map((h) => Number(h.authorized_price)).sort()).toEqual([10.5, 11]);
  });

  it("histórico é só leitura e isolado por tenant", async () => {
    const w = await tryAsUser(pool, manager, (db) =>
      db.query("insert into public.product_price_history (tenant_id, product_id) select tenant_id, id from public.products limit 1"));
    expect(w).toMatchObject({ ok: false, code: "42501" });
    const seen = await asUser(pool, other, async (db) => (await db.query("select count(*)::int n from public.product_price_history")).rows[0].n);
    expect(seen).toBe(0);
  });
});

describe("elegibilidade (product_eligibility)", () => {
  it("só ativo, com preço, vigência não vencida e procedência é elegível", async () => {
    const ok = await product("E1", PRICED, pricedVals("2099-12-31"));
    const semPreco = await product("E2");
    const vencido = await product("E3", PRICED, pricedVals("2020-01-01"));
    const semVigencia = await product("E4", ", authorized_price, price_source, price_reference", ", 3, 'tabela', 'TAB-9'");
    const inativo = await product("E5", PRICED + ", active", pricedVals("2099-12-31") + ", false");
    const rows = await elig(rep);
    const by = (p: string) => rows.find((r) => r.product_id === p);
    expect(by(ok)).toMatchObject({ eligible: true, reason: null, authorized_price: "10.50" });
    expect(by(semPreco)).toMatchObject({ eligible: false, reason: "no_price", authorized_price: null });
    expect(by(vencido)).toMatchObject({ eligible: false, reason: "price_expired", authorized_price: null });
    expect(by(semVigencia)).toMatchObject({ eligible: false, reason: "no_validity" });
    expect(by(inativo)).toMatchObject({ eligible: false, reason: "inactive" });
    // Vigência avaliada na data informada (dry-run de campanha futura).
    expect((await elig(rep, tenant, "2100-01-01")).find((r) => r.product_id === ok)).toMatchObject({ reason: "price_expired" });
  });

  it("procedência apagada por fora (dado legado) torna inelegível", async () => {
    const pid = await product("L1", PRICED, pricedVals("2099-12-31"));
    await pool.query("alter table public.products disable trigger user");
    await pool.query("update public.products set price_reference = null where id = $1", [pid]);
    await pool.query("alter table public.products enable trigger user");
    expect((await elig(rep)).find((r) => r.product_id === pid)).toMatchObject({ eligible: false, reason: "no_provenance" });
  });

  it("outro tenant não vê produtos nem preços", async () => {
    expect(await elig(other)).toEqual([]);
    expect(await elig(rep, beta)).toEqual([]);
  });
});
