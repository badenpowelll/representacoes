import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/**
 * Sincronização de produtos pelo site da indústria (ADR 0008): produto novo
 * entra sem preço, o que sai do site fica inativo, o que volta é reativado,
 * desativação manual é respeitada e coletas suspeitas não mudam nada.
 */
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, other: string;
let tenant: string, beta: string, ind: string, source: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const item = (key: string, name = `Produto ${key}`, extra: Record<string, unknown> = {}) => ({
  key, name, url: `https://industria.example/produtos.php?produto_id=${key}`, category: "Nutracêuticos",
  image_url: `https://img.example/${key}.png`, ...extra,
});
const sync = async (items: unknown[], src = source) =>
  (await pool.query("select * from app.sync_product_source($1, $2::jsonb)", [src, JSON.stringify(items)])).rows[0];
const products = async () =>
  (await pool.query(
    "select sku, name, active, inactive_reason, source_key, authorized_price, description, source_documents from public.products where source_id = $1 order by source_key",
    [source],
  )).rows;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@sync.test");
  rep = await createUser(pool, "rep@sync.test");
  other = await createUser(pool, "admin@outro-sync.test");
  tenant = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('Sync', 'sync-prod') as id")));
  beta = await asUser(pool, other, (db) => id(db.query("select public.create_tenant('Outro', 'outro-sync-prod') as id")));
  await asUser(pool, admin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative')", [tenant, rep]));
  ind = await asUser(pool, admin, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Nutri') returning id", [tenant])));
  source = await asUser(pool, admin, (db) =>
    id(db.query(
      "insert into public.product_sources (tenant_id, industry_id, url, label, last_status, last_found) values ($1, $2, 'https://industria.example/produtos.php', 'Linha geral', 'ok', 999) returning id",
      [tenant, ind],
    )));
});
afterAll(async () => drop?.());

describe("fontes de produtos", () => {
  it("usuário não forja a situação da coleta; representante não cadastra fonte; outro tenant não vê", async () => {
    const row = (await pool.query("select last_status, last_found, created_by from public.product_sources where id = $1", [source])).rows[0];
    expect(row).toMatchObject({ last_status: null, last_found: null, created_by: admin });
    const byRep = await tryAsUser(pool, rep, (db) =>
      db.query("insert into public.product_sources (tenant_id, industry_id, url) values ($1, $2, 'https://x.example/p')", [tenant, ind]));
    expect(byRep.ok).toBe(false);
    const seen = await asUser(pool, other, async (db) => (await db.query("select count(*)::int n from public.product_sources")).rows[0].n);
    expect(seen).toBe(0);
    const cross = await tryAsUser(pool, other, (db) =>
      db.query("insert into public.product_sources (tenant_id, industry_id, url) values ($1, $2, 'https://x.example/p')", [beta, ind]));
    expect(cross.ok).toBe(false);
  });

  it("URL precisa ser http(s)", async () => {
    const bad = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.product_sources (tenant_id, industry_id, url) values ($1, $2, 'javascript:alert(1)')", [tenant, ind]));
    expect(bad).toMatchObject({ ok: false, code: "23514" });
  });

  it("funções do robô não são executáveis pelo app", async () => {
    const r = await tryAsUser(pool, admin, (db) => db.query("select app.sync_product_source($1, '[]'::jsonb)", [source]));
    expect(r.ok).toBe(false);
  });
});

describe("sincronização", () => {
  it("primeira coleta cadastra os produtos sem preço, com origem e data", async () => {
    const run = await sync([item("10"), item("11"), item("12"), item("13"), item("13"), { key: "", name: "x" }]);
    expect(run).toMatchObject({ status: "ok", found: 4, added: 4, deactivated: 0 });
    const rows = await products();
    expect(rows.map((r) => r.sku)).toEqual(["SITE-10", "SITE-11", "SITE-12", "SITE-13"]);
    expect(rows.every((r) => r.active && r.authorized_price === null)).toBe(true);
    const src = (await pool.query("select last_status, last_found from public.product_sources where id = $1", [source])).rows[0];
    expect(src).toEqual({ last_status: "ok", last_found: 4 });
    const audit = (await pool.query("select count(*)::int n from public.audit_logs where action = 'product_source.sync'")).rows[0].n;
    expect(audit).toBe(1);
  });

  it("produto que sai fica inativo; produto novo entra; nome atualiza", async () => {
    const run = await sync([item("10", "Produto 10 novo nome"), item("11"), item("12"), item("14")]);
    expect(run).toMatchObject({ status: "ok", found: 4, added: 1, updated: 1, deactivated: 1 });
    const rows = await products();
    expect(rows.find((r) => r.source_key === "13")).toMatchObject({ active: false, inactive_reason: "removed_from_source" });
    expect(rows.find((r) => r.source_key === "10")?.name).toBe("Produto 10 novo nome");
  });

  it("produto que volta ao site é reativado; desativado à mão continua inativo", async () => {
    await asUser(pool, admin, (db) =>
      db.query("update public.products set active = false where source_id = $1 and source_key = '12'", [source]));
    const run = await sync([item("10"), item("11"), item("12"), item("13"), item("14")]);
    expect(run).toMatchObject({ reactivated: 1 });
    const rows = await products();
    expect(rows.find((r) => r.source_key === "13")).toMatchObject({ active: true, inactive_reason: null });
    expect(rows.find((r) => r.source_key === "12")).toMatchObject({ active: false, inactive_reason: "manual" });
  });

  it("coleta vazia ou com menos da metade não muda nada", async () => {
    const empty = await sync([]);
    expect(empty).toMatchObject({ status: "error", found: 0 });
    const few = await sync([item("10")]);
    expect(few).toMatchObject({ status: "skipped_safety", found: 1, deactivated: 0 });
    expect((await products()).filter((r) => r.active).length).toBe(4);
  });

  it("descrição e fichas só mudam quando a página do produto foi lida", async () => {
    const docs = [{ kind: "FT", label: "Ficha técnica", url: "https://files.example/ft.pdf" }, { kind: "FDS", url: "javascript:x" }];
    await sync([item("10", undefined, { details: true, description: "Desc", documents: docs }), item("11"), item("13"), item("14")]);
    let p10 = (await products()).find((r) => r.source_key === "10");
    expect(p10?.description).toBe("Desc");
    expect(p10?.source_documents).toEqual([{ kind: "FT", label: "Ficha técnica", url: "https://files.example/ft.pdf" }]);
    await sync([item("10"), item("11"), item("13"), item("14")]);
    p10 = (await products()).find((r) => r.source_key === "10");
    expect(p10?.source_documents).toHaveLength(1);
  });

  it("SKU publicado pelo site é usado; substitui o provisório; não colide", async () => {
    await sync([item("10"), item("11", undefined, { sku: "1.0571.0120" }), item("13"), item("14"), item("15", undefined, { sku: "1.0571.0120" })]);
    const rows = await products();
    expect(rows.find((r) => r.source_key === "11")?.sku).toBe("1.0571.0120");
    expect(rows.find((r) => r.source_key === "15")?.sku).toMatch(/^SITE-/);
  });

  it("usuário não forja colunas de origem nem fichas", async () => {
    const pid = await asUser(pool, admin, (db) =>
      id(db.query(
        "insert into public.products (tenant_id, industry_id, sku, name, source_id, source_key, source_documents) values ($1, $2, 'MAN-1', 'Manual', $3, '99', '[{\"url\":\"https://evil.example\"}]') returning id",
        [tenant, ind, source],
      )));
    let row = (await pool.query("select source_id, source_key, source_documents from public.products where id = $1", [pid])).rows[0];
    expect(row).toEqual({ source_id: null, source_key: null, source_documents: [] });
    await asUser(pool, admin, (db) =>
      db.query("update public.products set source_url = 'https://evil.example', source_documents = '[{\"url\":\"https://evil.example\"}]' where source_id = $1 and source_key = '10'", [source]));
    row = (await pool.query("select source_url, source_documents from public.products where source_id = $1 and source_key = '10'", [source])).rows[0];
    expect(row.source_url).toBe("https://industria.example/produtos.php?produto_id=10");
    expect(row.source_documents).toHaveLength(1);
  });

  it("histórico de coletas é só leitura e isolado por tenant", async () => {
    const mine = await asUser(pool, rep, async (db) => (await db.query("select count(*)::int n from public.product_sync_runs")).rows[0].n);
    expect(mine).toBeGreaterThan(0);
    const theirs = await asUser(pool, other, async (db) => (await db.query("select count(*)::int n from public.product_sync_runs")).rows[0].n);
    expect(theirs).toBe(0);
    const w = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.product_sync_runs (tenant_id, source_id, status) values ($1, $2, 'ok')", [tenant, source]));
    expect(w).toMatchObject({ ok: false, code: "42501" });
  });

  it("falha registrada aparece na fonte", async () => {
    await pool.query("select app.record_product_source_failure($1, 'robots.txt não permite')", [source]);
    const src = (await pool.query("select last_status, last_message from public.product_sources where id = $1", [source])).rows[0];
    expect(src).toEqual({ last_status: "error", last_message: "robots.txt não permite" });
  });
});

describe("modo vigiar página", () => {
  let watch: string;
  const record = async (text: string, summary: string | null = null) =>
    (await pool.query("select * from app.record_product_source_watch($1, $2, $3)", [watch, text, summary])).rows[0];

  beforeAll(async () => {
    watch = await asUser(pool, admin, (db) =>
      id(db.query(
        "insert into public.product_sources (tenant_id, industry_id, url, mode, watch_text) values ($1, $2, 'https://usina.example/alcool', 'watch', 'forjado') returning id",
        [tenant, ind],
      )));
  });

  it("usuário não forja o texto vigiado", async () => {
    const row = (await pool.query("select mode, watch_text from public.product_sources where id = $1", [watch])).rows[0];
    expect(row).toEqual({ mode: "watch", watch_text: null });
  });

  it("guarda a referência, não avisa sem mudança e avisa quando muda", async () => {
    expect(await record("Álcool 70 1 L\nÁlcool 46 500 mL")).toMatchObject({ status: "ok", message: expect.stringContaining("referência") });
    expect(await record("Álcool 70 1 L\nÁlcool 46 500 mL")).toMatchObject({ status: "ok", message: expect.stringContaining("sem mudanças") });
    const changed = await record("Álcool 70 1 L\nÁlcool 46 500 mL\nÁlcool 70 Gel 5 L", "Entrou: Álcool 70 Gel 5 L");
    expect(changed).toMatchObject({ status: "changed", message: expect.stringContaining("Entrou: Álcool 70 Gel 5 L") });
    const src = (await pool.query("select last_status, watch_changed_at from public.product_sources where id = $1", [watch])).rows[0];
    expect(src.last_status).toBe("changed");
    expect(src.watch_changed_at).not.toBeNull();
    expect(await record("")).toMatchObject({ status: "error" });
    expect((await pool.query("select watch_text from public.product_sources where id = $1", [watch])).rows[0].watch_text).toContain("Gel 5 L");
  });

  it("função do robô não é executável pelo app", async () => {
    const r = await tryAsUser(pool, admin, (db) => db.query("select app.record_product_source_watch($1, 'x')", [watch]));
    expect(r.ok).toBe(false);
  });
});
