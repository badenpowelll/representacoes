import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
});
afterAll(async () => drop?.());

describe("referência de municípios do IBGE", () => {
  it("carrega municípios em todas as 27 UFs, com código coerente com a UF", async () => {
    // Sem fixar 5.570: o número de municípios muda com novas emancipações.
    const { rows } = await pool.query(`
      select count(*)::int as total,
             count(distinct m.state_code)::int as ufs,
             count(*) filter (where m.ibge_code / 100000 <> s.ibge_code)::int as incoerentes
      from ref.municipalities m join ref.states s on s.code = m.state_code`);
    expect(rows[0].total).toBeGreaterThan(5500);
    expect(rows[0].ufs).toBe(27);
    expect(rows[0].incoerentes).toBe(0);
  });

  it("nomes com acento e apóstrofo preservados", async () => {
    const { rows } = await pool.query(
      "select ibge_code, name, state_code from ref.municipalities where ibge_code in (2408102, 2408003, 1100015) order by ibge_code",
    );
    expect(rows).toEqual([
      { ibge_code: 1100015, name: "Alta Floresta D'Oeste", state_code: "RO" },
      { ibge_code: 2408003, name: "Mossoró", state_code: "RN" },
      { ibge_code: 2408102, name: "Natal", state_code: "RN" },
    ]);
  });

  it("usuário autenticado lê pela view pública, mas não altera", async () => {
    const u = await createUser(pool, "leitor@ref.test");
    const n = await asUser(pool, u, async (db) =>
      (await db.query("select count(*)::int as n from public.ref_municipalities where state_code = 'RN'")).rows[0].n,
    );
    expect(n).toBeGreaterThan(100);
    await expect(
      asUser(pool, u, (db) => db.query("update ref.municipalities set name = 'X' where ibge_code = 2408102")),
    ).rejects.toThrow();
  });
});
