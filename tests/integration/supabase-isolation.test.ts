import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Integração contra uma stack Supabase LOCAL (`npx supabase start`): Auth real,
 * PostgREST e Storage. Pulado quando as variáveis não estão definidas.
 * Nunca aponte para staging/produção: o teste cria usuários.
 */
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey && /^http:\/\/(127\.0\.0\.1|localhost)/.test(url ?? ""));

const run = Date.now().toString(36);
const password = `Senha-forte-${run}-!`;

async function signedInClient(admin: SupabaseClient, email: string) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return client;
}

describe.skipIf(!enabled)("isolamento via API real do Supabase local", () => {
  let a: SupabaseClient, b: SupabaseClient, anon: SupabaseClient;
  let tenantA: string, tenantB: string;

  beforeAll(async () => {
    const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    a = await signedInClient(admin, `a-${run}@alfa.test`);
    b = await signedInClient(admin, `b-${run}@beta.test`);
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const ra = await a.rpc("create_tenant", { p_name: "Alfa Int", p_slug: `alfa-${run}` });
    const rb = await b.rpc("create_tenant", { p_name: "Beta Int", p_slug: `beta-${run}` });
    if (ra.error || rb.error) throw ra.error ?? rb.error;
    tenantA = ra.data as string;
    tenantB = rb.data as string;
  });

  it("cada usuário lista só o próprio tenant pela API", async () => {
    const { data } = await a.from("tenants").select("id");
    expect(data?.map((t) => t.id)).toEqual([tenantA]);
    const { data: other } = await a.from("tenants").select("id").eq("id", tenantB);
    expect(other).toEqual([]);
  });

  it("anônimo não lê tenants", async () => {
    const { data, error } = await anon.from("tenants").select("id");
    expect(error ?? data?.length === 0).toBeTruthy();
  });

  it("B não cria indústria em A", async () => {
    const { error } = await b.from("industries").insert({ tenant_id: tenantA, name: "Intrusa" });
    expect(error).not.toBeNull();
  });

  it("Storage: A envia catálogo no próprio prefixo; B não lista nem baixa; B não envia no prefixo de A", async () => {
    const pdf = new Blob(["%PDF-1.4 teste"], { type: "application/pdf" });
    const up = await a.storage.from("catalogs").upload(`${tenantA}/catalogo-${run}.pdf`, pdf, { contentType: "application/pdf" });
    expect(up.error).toBeNull();

    const list = await b.storage.from("catalogs").list(tenantA);
    expect(list.data ?? []).toEqual([]);
    const dl = await b.storage.from("catalogs").download(`${tenantA}/catalogo-${run}.pdf`);
    expect(dl.error).not.toBeNull();

    const cross = await b.storage.from("catalogs").upload(`${tenantA}/intruso-${run}.pdf`, pdf, { contentType: "application/pdf" });
    expect(cross.error).not.toBeNull();

    const own = await a.storage.from("catalogs").download(`${tenantA}/catalogo-${run}.pdf`);
    expect(own.error).toBeNull();
  });

  it("bucket rejeita arquivo que não é PDF", async () => {
    const txt = new Blob(["oi"], { type: "text/plain" });
    const r = await a.storage.from("catalogs").upload(`${tenantA}/x-${run}.txt`, txt, { contentType: "text/plain" });
    expect(r.error).not.toBeNull();
  });
});
