import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, alfaViewer: string, betaAdmin: string;
let alfa: string, beta: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const insert = `insert into public.cnpj_registry (tenant_id, cnpj, legal_name, state_code, municipality_id, phones, partners, raw)
  values ($1, '11444777000161', 'Empresa Exemplo Ltda', $2, $3, $4, '[{"name":"FULANA"}]', '{"razao_social":"x"}') returning id`;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  alfaAdmin = await createUser(pool, "admin@alfa.test");
  alfaViewer = await createUser(pool, "leitura@alfa.test");
  betaAdmin = await createUser(pool, "admin@beta.test");
  alfa = await asUser(pool, alfaAdmin, (db) => id(db.query("select public.create_tenant('Alfa', 'alfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('Beta', 'beta') as id")));
  await asUser(pool, alfaAdmin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'viewer')", [alfa, alfaViewer]),
  );
  await asUser(pool, alfaAdmin, (db) => db.query(insert, [alfa, "RN", 2408102, ["8432221234"]]));
});

afterAll(async () => drop?.());

describe("cnpj_registry", () => {
  it("Beta não lê, altera nem exclui a consulta de Alfa", async () => {
    const res = await asUser(pool, betaAdmin, async (db) => ({
      sel: (await db.query("select * from public.cnpj_registry where tenant_id = $1", [alfa])).rowCount,
      upd: (await db.query("update public.cnpj_registry set legal_name = 'x' where tenant_id = $1", [alfa])).rowCount,
      del: (await db.query("delete from public.cnpj_registry where tenant_id = $1", [alfa])).rowCount,
    }));
    expect(res).toEqual({ sel: 0, upd: 0, del: 0 });
  });

  it("Beta não grava consulta no tenant de Alfa, mas pode ter a sua do mesmo CNPJ", async () => {
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query(insert, [alfa, null, null, []]))).ok).toBe(false);
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query(insert, [beta, null, null, []]))).ok).toBe(true);
  });

  it("um registro por CNPJ no tenant (upsert atualiza)", async () => {
    expect((await tryAsUser(pool, alfaAdmin, (db) => db.query(insert, [alfa, null, null, []]))).ok).toBe(false);
    const n = await asUser(pool, alfaAdmin, async (db) => {
      await db.query(
        `insert into public.cnpj_registry (tenant_id, cnpj, legal_name, raw) values ($1, '11444777000161', 'Nome Novo', '{}')
         on conflict (tenant_id, cnpj) do update set legal_name = excluded.legal_name`,
        [alfa],
      );
      return (await db.query("select legal_name from public.cnpj_registry where tenant_id = $1", [alfa])).rows;
    });
    expect(n).toEqual([{ legal_name: "Nome Novo" }]);
  });

  it("leitura vê, mas não grava", async () => {
    const seen = await asUser(pool, alfaViewer, async (db) => (await db.query("select 1 from public.cnpj_registry where tenant_id = $1", [alfa])).rowCount);
    expect(seen).toBe(1);
    const w = await tryAsUser(pool, alfaViewer, (db) =>
      db.query("insert into public.cnpj_registry (tenant_id, cnpj, legal_name, raw) values ($1, '11222333000181', 'X', '{}')", [alfa]),
    );
    expect(w.ok).toBe(false);
  });

  it("município de outra UF é descartado; telefone fora do formato é recusado", async () => {
    const mun = await asUser(pool, alfaAdmin, async (db) => {
      await db.query(
        "insert into public.cnpj_registry (tenant_id, cnpj, legal_name, state_code, municipality_id, raw) values ($1, '11222333000181', 'Y', 'SP', 2408102, '{}')",
        [alfa],
      );
      return (await db.query("select municipality_id from public.cnpj_registry where tenant_id = $1 and cnpj = '11222333000181'", [alfa])).rows[0];
    });
    expect(mun.municipality_id).toBeNull();
    const bad = await tryAsUser(pool, alfaAdmin, (db) =>
      db.query("insert into public.cnpj_registry (tenant_id, cnpj, legal_name, phones, raw) values ($1, '19131243000197', 'Z', '{123}', '{}')", [alfa]),
    );
    expect(bad.ok).toBe(false);
  });
});
