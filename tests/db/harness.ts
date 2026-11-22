import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool, type PoolClient } from "pg";

const ROOT = join(__dirname, "..", "..");
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

/** Cria um banco descartável, aplica o stub do Supabase e todas as migrations. */
export async function createTestDatabase(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  const dbName = `rep360_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const pool = new Pool({ connectionString: url.toString(), max: 4 });

  await pool.query(readFileSync(join(ROOT, "supabase", "tests", "supabase_stub.sql"), "utf8"));
  const migrationsDir = join(ROOT, "supabase", "migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pool.query(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Falha ao aplicar migration ${file}: ${(error as Error).message}`);
    }
  }

  return {
    pool,
    drop: async () => {
      await pool.end();
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${dbName} with (force)`);
      await a.end();
    },
  };
}

export async function createUser(pool: Pool, email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: email.split("@")[0] })],
  );
  return rows[0].id;
}

/**
 * Executa `fn` como um usuário autenticado (papel `authenticated` + claims do JWT),
 * exatamente como o PostgREST faz no Supabase. A transação sofre rollback no fim.
 */
export async function asUser<T>(
  pool: Pool,
  userId: string | null,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Igual a asUser, mas sempre faz rollback (útil para tentar ações que devem falhar). */
export async function tryAsUser(
  pool: Pool,
  userId: string | null,
  fn: (db: PoolClient) => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; code?: string; message: string }> {
  try {
    await asUser(pool, userId, fn);
    return { ok: true };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { ok: false, code: e.code, message: e.message };
  }
}
