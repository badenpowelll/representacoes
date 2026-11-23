import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase } from "./harness";

let pool: Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  await pool.query(readFileSync(join(__dirname, "..", "..", "supabase", "seed.sql"), "utf8"));
});
afterAll(async () => drop?.());

it("seed sintético aplica sobre as migrations e respeita o isolamento", async () => {
  const slugs = await asUser(pool, "00000000-0000-4000-8000-00000000b001", async (db) =>
    (await db.query("select slug from public.tenants")).rows.map((r) => r.slug),
  );
  expect(slugs).toEqual(["beta"]);
});
