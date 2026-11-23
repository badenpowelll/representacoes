import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

// Envio direto por e-mail: conexão (segredo não exposto), checagens antes do envio e idempotência.
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, viewer: string, betaAdmin: string;
let alfa: string, beta: string, company: string, contact: string, optedCompany: string, optedContact: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@mail.test");
  rep = await createUser(pool, "rep@mail.test");
  viewer = await createUser(pool, "viewer@mail.test");
  betaAdmin = await createUser(pool, "admin@mailbeta.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('MailAlfa', 'mailalfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('MailBeta', 'mailbeta') as id")));
  await asUser(pool, admin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [alfa, rep, viewer]);
    const mk = async (name: string, email: string) => {
      const co = await id(db.query("insert into public.companies (tenant_id, legal_name, kind) values ($1, $2, 'prospect') returning id", [alfa, name]));
      const ct = await id(db.query(
        `insert into public.contacts (tenant_id, company_id, name, email, legal_basis, purposes, legal_basis_note, source)
         values ($1, $2, 'Compras', $3, 'legitimate_interest', '{prospecting}', 'Interesse comercial B2B', 'cadastro manual') returning id`,
        [alfa, co, email],
      ));
      return [co, ct];
    };
    [company, contact] = await mk("Empresa Mail", "compras@empresa.test");
    [optedCompany, optedContact] = await mk("Empresa Oposicao", "compras@oposicao.test");
    await db.query("select public.opt_out_contact($1, $2, $3)", [alfa, optedCompany, optedContact]);
  });
});
afterAll(async () => drop?.());

const prepare = (user: string, key: string, over: Partial<{ to: string; company: string; contact: string; limit: number }> = {}) =>
  asUser(pool, user, async (db) =>
    (await db.query("select public.email_prepare_send($1, $2, $3, $4, 'Assunto', 'Corpo', $5, 'prospecting', null, $6) as r", [
      alfa, over.company ?? company, over.contact ?? contact, over.to ?? "compras@empresa.test", key, over.limit ?? 500,
    ])).rows[0].r,
  );
const record = (user: string, msg: string, status: string) =>
  asUser(pool, user, async (db) => (await db.query("select public.email_record_result($1, $2, $3, 'gm-1', null) as r", [alfa, msg, status])).rows[0].r);

describe("email_connections", () => {
  it("guarda a conexão do próprio usuário sem expor o token cifrado na tabela", async () => {
    await asUser(pool, rep, (db) => db.query("select public.email_connection_save($1, 'rep@mailalfa.test', 'v1.aaaaaaaa.bbbbbbbb.cccc')", [alfa]));
    const denied = await tryAsUser(pool, rep, (db) => db.query("select refresh_token_ciphertext from public.email_connections"));
    expect(denied).toMatchObject({ ok: false, code: "42501" });
    const own = await asUser(pool, rep, async (db) => (await db.query("select * from public.email_connection_secret($1)", [alfa])).rows);
    expect(own).toMatchObject([{ email_address: "rep@mailalfa.test", ciphertext: "v1.aaaaaaaa.bbbbbbbb.cccc" }]);
    // O admin vê que existe a conexão, mas não recebe o segredo do representante.
    const other = await asUser(pool, admin, async (db) => (await db.query("select * from public.email_connection_secret($1)", [alfa])).rows);
    expect(other).toEqual([]);
    expect(await tryAsUser(pool, viewer, (db) => db.query("select public.email_connection_save($1, 'v@mailalfa.test', 'x')", [alfa])))
      .toMatchObject({ ok: false, code: "42501" });
    const seen = await asUser(pool, betaAdmin, async (db) => (await db.query("select count(*)::int as n from public.email_connections")).rows[0].n);
    expect(seen).toBe(0);
  });
});

describe("email_prepare_send / email_record_result", () => {
  it("grava uma vez só por chave e registra a atividade", async () => {
    const a = await prepare(rep, "teste:chave-1");
    expect(a).toMatchObject({ ok: true, status: "queued", duplicate: false, from: "rep@mailalfa.test" });
    // Clique repetido enquanto o primeiro ainda está em andamento: não cria outro.
    expect(await prepare(rep, "teste:chave-1")).toMatchObject({ ok: true, duplicate: true, status: "queued", message_id: a.message_id });
    expect(await record(rep, a.message_id, "sandbox")).toMatchObject({ ok: true, status: "sandbox" });
    expect(await record(rep, a.message_id, "sent")).toMatchObject({ ok: true, status: "sandbox" });
    expect(await prepare(rep, "teste:chave-1")).toMatchObject({ ok: true, duplicate: true, status: "sandbox" });
    const acts = await pool.query("select count(*)::int as n from public.activities where metadata ->> 'email_message_id' = $1", [a.message_id]);
    expect(acts.rows[0].n).toBe(1);
  });

  it("um envio que falhou pode ser tentado de novo com a mesma chave", async () => {
    const a = await prepare(rep, "teste:chave-falha");
    await record(rep, a.message_id, "failed");
    const b = await prepare(rep, "teste:chave-falha");
    expect(b).toMatchObject({ ok: true, duplicate: false, status: "queued", message_id: a.message_id });
  });

  it("bloqueia oposição, supressão do endereço digitado, contato de outra empresa e limite diário", async () => {
    expect(await prepare(rep, "teste:oposicao", { company: optedCompany, contact: optedContact, to: "compras@oposicao.test" }))
      .toMatchObject({ ok: false, reason: "opted_out" });
    await asUser(pool, admin, (db) => db.query("insert into public.suppression_list (tenant_id, email, reason) values ($1, 'outro@suprimido.test', 'manual')", [alfa]));
    expect(await prepare(rep, "teste:suprimido", { to: "Outro@Suprimido.test" })).toMatchObject({ ok: false, reason: "suppressed" });
    expect(await prepare(rep, "teste:cruzado", { contact: optedContact })).toMatchObject({ ok: false, reason: "no_contact" });
    expect(await prepare(rep, "teste:invalido", { to: "sem-arroba" })).toMatchObject({ ok: false, reason: "invalid_address" });
    expect(await prepare(rep, "teste:limite", { limit: 1 })).toMatchObject({ ok: false, reason: "daily_limit" });
  });

  it("recusa leitor, outro tenant e registrar resultado de e-mail alheio", async () => {
    expect(await tryAsUser(pool, viewer, (db) => db.query("select public.email_prepare_send($1, $2, $3, 'a@b.test', 's', 'b', 'teste:leitor')", [alfa, company, contact])))
      .toMatchObject({ ok: false, code: "42501" });
    expect(await tryAsUser(pool, betaAdmin, (db) => db.query("select public.email_prepare_send($1, $2, $3, 'a@b.test', 's', 'b', 'teste:beta')", [alfa, company, contact])))
      .toMatchObject({ ok: false, code: "42501" });
    // Beta, no próprio tenant, não alcança o contato de Alfa.
    expect(await asUser(pool, betaAdmin, async (db) =>
      (await db.query("select public.email_prepare_send($1, $2, $3, 'compras@empresa.test', 's', 'b', 'teste:beta2') as r", [beta, company, contact])).rows[0].r))
      .toMatchObject({ ok: false, reason: "no_contact" });
    const a = await prepare(rep, "teste:alheio");
    expect(await tryAsUser(pool, admin, (db) => db.query("select public.email_record_result($1, $2, 'sent')", [alfa, a.message_id])))
      .toMatchObject({ ok: false, code: "P0002" });
  });
});
