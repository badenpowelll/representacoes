import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let admin: string, tenant: string, indA: string, indB: string, catA: string, verA: string;
const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@sigma.test");
  tenant = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('Sigma', 'sigma') as id")));
  await asUser(pool, admin, async (db) => {
    indA = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind A') returning id", [tenant]));
    indB = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind B') returning id", [tenant]));
    catA = await id(db.query("insert into public.catalogs (tenant_id, industry_id, title) values ($1, $2, 'Cat A') returning id", [tenant, indA]));
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('catalogs', $1, $2)", [`${tenant}/a.pdf`, admin]);
    verA = await id(
      db.query("insert into public.catalog_versions (tenant_id, catalog_id, version, storage_path, file_sha256) values ($1, $2, 1, $3, $4) returning id", [
        tenant,
        catA,
        `${tenant}/a.pdf`,
        "a".repeat(64),
      ]),
    );
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('catalogs', $1, $2)", [`${tenant}/orfao.pdf`, admin]);
  });
  await pool.query("update storage.objects set created_at = now() - interval '2 hours'");
});
afterAll(async () => drop?.());

describe("imutabilidade das versões", () => {
  it("não troca caminho nem hash de uma versão", async () => {
    const path = await tryAsUser(pool, admin, (db) => db.query("update public.catalog_versions set storage_path = $1 where id = $2", [`${tenant}/b.pdf`, verA]));
    const hash = await tryAsUser(pool, admin, (db) => db.query("update public.catalog_versions set file_sha256 = $1 where id = $2", ["b".repeat(64), verA]));
    expect([path.ok, hash.ok]).toEqual([false, false]);
  });

  it("publicada não volta para rascunho nem pode ser excluída", async () => {
    await asUser(pool, admin, (db) => db.query("update public.catalog_versions set status = 'published', published_at = now() where id = $1", [verA]));
    const back = await tryAsUser(pool, admin, (db) => db.query("update public.catalog_versions set status = 'draft' where id = $1", [verA]));
    const del = await tryAsUser(pool, admin, (db) => db.query("delete from public.catalog_versions where id = $1", [verA]));
    expect([back.ok, del.ok]).toEqual([false, false]);
  });
});

describe("storage", () => {
  it("objeto referenciado por versão não pode ser apagado nem sobrescrito", async () => {
    const del = await asUser(pool, admin, async (db) =>
      (await db.query("delete from storage.objects where name = $1", [`${tenant}/a.pdf`])).rowCount,
    );
    expect(del).toBe(0);
    const upd = await asUser(pool, admin, async (db) =>
      (await db.query("update storage.objects set owner = null where name = $1", [`${tenant}/a.pdf`])).rowCount,
    );
    expect(upd).toBe(0);
  });

  it("reconciliação lista só órfãos antigos do próprio tenant e eles podem ser apagados", async () => {
    const orphans = await asUser(pool, admin, async (db) =>
      (await db.query("select name from public.orphan_catalog_objects($1)", [tenant])).rows.map((r) => r.name),
    );
    expect(orphans).toEqual([`${tenant}/orfao.pdf`]);
    const del = await asUser(pool, admin, async (db) =>
      (await db.query("delete from storage.objects where name = $1", [`${tenant}/orfao.pdf`])).rowCount,
    );
    expect(del).toBe(1);
  });

  it("outro usuário sem vínculo não consulta órfãos do tenant", async () => {
    const other = await createUser(pool, "x@outro.test");
    const r = await tryAsUser(pool, other, (db) => db.query("select * from public.orphan_catalog_objects($1)", [tenant]));
    expect(r.ok).toBe(false);
  });
});

describe("produto e versão da mesma indústria", () => {
  it("rejeita produto da indústria B apontando para versão do catálogo da indústria A", async () => {
    const bad = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, catalog_version_id, sku, name) values ($1, $2, $3, 'X1', 'X')", [tenant, indB, verA]),
    );
    expect(bad.ok).toBe(false);
    const ok = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.products (tenant_id, industry_id, catalog_version_id, sku, name) values ($1, $2, $3, 'A1', 'A')", [tenant, indA, verA]),
    );
    expect(ok.ok).toBe(true);
  });

  it("catálogo com versões não muda de indústria", async () => {
    const r = await tryAsUser(pool, admin, (db) => db.query("update public.catalogs set industry_id = $1 where id = $2", [indB, catA]));
    expect(r.ok).toBe(false);
  });
});
