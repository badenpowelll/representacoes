import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, alfaRep: string, betaAdmin: string;
let alfa: string, beta: string, alfaIndustry: string, betaIndustry: string, alfaCatalog: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  alfaAdmin = await createUser(pool, "admin@alfa.test");
  alfaRep = await createUser(pool, "rep@alfa.test");
  betaAdmin = await createUser(pool, "admin@beta.test");
  alfa = await asUser(pool, alfaAdmin, (db) => id(db.query("select public.create_tenant('Alfa', 'alfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('Beta', 'beta') as id")));
  await asUser(pool, alfaAdmin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative')", [alfa, alfaRep]),
  );
  alfaIndustry = await asUser(pool, alfaAdmin, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind Alfa') returning id", [alfa])));
  betaIndustry = await asUser(pool, betaAdmin, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind Beta') returning id", [beta])));
  alfaCatalog = await asUser(pool, alfaAdmin, (db) =>
    id(db.query("insert into public.catalogs (tenant_id, industry_id, title) values ($1, $2, 'Linha 2027') returning id", [alfa, alfaIndustry])),
  );
});
afterAll(async () => drop?.());

describe("catálogos e versões", () => {
  it("versão precisa apontar para arquivo sob o prefixo do próprio tenant", async () => {
    const ok = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.catalog_versions (tenant_id, catalog_id, version, storage_path) values ($1, $2, 1, $3)", [
        alfa,
        alfaCatalog,
        `${alfa}/linha-2027-v1.pdf`,
      ]),
    );
    expect(ok.ok).toBe(true);
    const foreign = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.catalog_versions (tenant_id, catalog_id, version, storage_path) values ($1, $2, 2, $3)", [
        alfa,
        alfaCatalog,
        `${beta}/roubado.pdf`,
      ]),
    );
    expect(foreign.ok).toBe(false);
  });

  it("catálogo de Alfa não pode ser criado sobre indústria de Beta", async () => {
    const r = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.catalogs (tenant_id, industry_id, title) values ($1, $2, 'X')", [alfa, betaIndustry]),
    );
    expect(r.ok).toBe(false);
  });

  it("Beta não lista catálogos nem versões de Alfa; representante não publica", async () => {
    const n = await asUser(pool, betaAdmin, async (db) => ({
      c: (await db.query("select * from public.catalogs")).rowCount,
      v: (await db.query("select * from public.catalog_versions")).rowCount,
    }));
    expect(n).toEqual({ c: 0, v: 0 });
    const pub = await asUser(pool, alfaRep, async (db) =>
      (await db.query("update public.catalog_versions set status = 'published', published_at = now()")).rowCount,
    );
    expect(pub).toBe(0);
  });
});

describe("produtos", () => {
  it("SKU é único por indústria e preço negativo é rejeitado", async () => {
    await asUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, sku, name, authorized_price) values ($1, $2, 'A-1', 'Parafuso', 1.50)", [
        alfa,
        alfaIndustry,
      ]),
    );
    const dup = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, sku, name) values ($1, $2, 'A-1', 'Outro')", [alfa, alfaIndustry]),
    );
    const neg = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, sku, name, authorized_price) values ($1, $2, 'A-2', 'X', -1)", [
        alfa,
        alfaIndustry,
      ]),
    );
    expect([dup.ok, neg.ok]).toEqual([false, false]);
  });

  it("Beta não lê nem altera preços de Alfa", async () => {
    const r = await asUser(pool, betaAdmin, async (db) => ({
      sel: (await db.query("select * from public.products")).rowCount,
      upd: (await db.query("update public.products set authorized_price = 0")).rowCount,
    }));
    expect(r).toEqual({ sel: 0, upd: 0 });
  });
});

describe("storage privado", () => {
  const put = (user: string, path: string) =>
    tryAsUser(pool, user, (db) => db.query("insert into storage.objects (bucket_id, name, owner) values ('catalogs', $1, $2)", [path, user]));

  it("bucket de catálogos é privado", async () => {
    const { rows } = await pool.query("select public from storage.buckets where id = 'catalogs'");
    expect(rows[0].public).toBe(false);
  });

  it("admin envia arquivo só no prefixo do próprio tenant; representante não envia", async () => {
    expect((await put(alfaAdmin, `${alfa}/a.pdf`)).ok).toBe(true);
    expect((await put(alfaAdmin, `${beta}/a.pdf`)).ok).toBe(false);
    expect((await put(alfaAdmin, `sem-prefixo.pdf`)).ok).toBe(false);
    expect((await put(alfaRep, `${alfa}/b.pdf`)).ok).toBe(false);
  });

  it("Beta não lista, baixa nem apaga arquivos de Alfa", async () => {
    const r = await asUser(pool, betaAdmin, async (db) => ({
      sel: (await db.query("select * from storage.objects where bucket_id = 'catalogs'")).rowCount,
      del: (await db.query("delete from storage.objects where bucket_id = 'catalogs'")).rowCount,
    }));
    expect(r).toEqual({ sel: 0, del: 0 });
    const repSees = await asUser(pool, alfaRep, async (db) => (await db.query("select name from storage.objects")).rowCount);
    expect(repSees).toBe(1);
  });
});
