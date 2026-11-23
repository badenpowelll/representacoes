import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;
let alfaAdmin: string, betaAdmin: string, alfa: string, industry: string, company: string;
const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  alfaAdmin = await createUser(pool, "admin@alfa.test");
  betaAdmin = await createUser(pool, "admin@beta.test");
  alfa = await asUser(pool, alfaAdmin, (db) => id(db.query("select public.create_tenant('Alfa', 'alfa') as id")));
  await asUser(pool, betaAdmin, (db) => db.query("select public.create_tenant('Beta', 'beta')"));
  industry = await asUser(pool, alfaAdmin, (db) =>
    id(db.query("insert into public.industries (tenant_id, name, website) values ($1, 'Proc9', 'https://proc9.com.br') returning id", [alfa])),
  );
  company = await asUser(pool, alfaAdmin, (db) =>
    id(db.query("insert into public.companies (tenant_id, legal_name) values ($1, 'Cliente') returning id", [alfa])),
  );
});
afterAll(async () => drop?.());

const channels = JSON.stringify([
  { kind: "phone", label: "Comercial", value: "(51) 3478-2085", source: "manual" },
  { kind: "email", label: "Licitações", value: "licita@proc9.com.br", source: "manual" },
]);

describe("site e canais de contato", () => {
  it("site sem origem informada conta como manual; sem site, sem origem", async () => {
    const r = await asUser(pool, alfaAdmin, async (db) => {
      const a = (await db.query("select website_source from public.industries where id = $1", [industry])).rows[0];
      await db.query("update public.industries set website = null where id = $1", [industry]);
      const b = (await db.query("select website_source from public.industries where id = $1", [industry])).rows[0];
      return [a.website_source, b.website_source];
    });
    expect(r).toEqual(["manual", null]);
  });

  it("guarda vários canais rotulados em indústria e empresa", async () => {
    const ok = await tryAsUser(pool, alfaAdmin, async (db) => {
      await db.query("update public.industries set contact_channels = $2 where id = $1", [industry, channels]);
      await db.query("update public.companies set contact_channels = $2, website = 'https://cliente.com.br' where id = $1", [company, channels]);
    });
    expect(ok.ok).toBe(true);
  });

  it("recusa canal fora do formato", async () => {
    for (const bad of [
      [{ kind: "fax", label: "", value: "1", source: "manual" }],
      [{ kind: "email", label: "", value: "sem-arroba", source: "manual" }],
      [{ kind: "phone", label: "", value: "", source: "manual" }],
      [{ kind: "phone", label: "", value: "51 3478 2085", source: "inventada" }],
      { kind: "phone" },
    ]) {
      const r = await tryAsUser(pool, alfaAdmin, (db) =>
        db.query("update public.industries set contact_channels = $2 where id = $1", [industry, JSON.stringify(bad)]),
      );
      expect(r.ok).toBe(false);
    }
  });

  it("outra representação não altera os contatos", async () => {
    const n = await asUser(pool, betaAdmin, async (db) =>
      (await db.query("update public.industries set contact_channels = '[]' where id = $1", [industry])).rowCount,
    );
    expect(n).toBe(0);
  });
});
