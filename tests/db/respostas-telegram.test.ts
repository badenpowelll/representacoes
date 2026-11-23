import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

// Robô de respostas + bot do Telegram: só conversas do sistema, oposição por "SAIR",
// resposta pelo Telegram passa pelas mesmas checagens e só do chat ligado.
let pool: Pool;
let drop: () => Promise<void>;
let rep: string, other: string, betaAdmin: string;
let alfa: string, company: string, contact: string, conn: string, sentMsg: string;
const CHAT = 5550001;
const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const hash = (c: string) => createHash("sha256").update(c).digest("hex");

/** Como o servidor com a chave de serviço (webhooks). */
async function asService<T>(sql: string, params: unknown[]): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows[0]?.r as T;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

const record = (gmailId: string, thread: string, from: string, body: string, optOut = false) =>
  asService<Record<string, unknown>>(
    "select public.svc_inbound_record($1, $2, $3, '<r1@cli.test>', '<o@x.test>', $4, 'Re: Catálogo', $5, now(), $6) as r",
    [conn, gmailId, thread, from, body, optOut],
  );

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  const admin = await createUser(pool, "admin@resp.test");
  rep = await createUser(pool, "rep@resp.test");
  other = await createUser(pool, "outro@resp.test");
  betaAdmin = await createUser(pool, "admin@respbeta.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('RespAlfa', 'respalfa') as id")));
  await asUser(pool, betaAdmin, (db) => db.query("select public.create_tenant('RespBeta', 'respbeta')"));
  await asUser(pool, admin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'representative')", [alfa, rep, other]);
    company = await id(db.query("insert into public.companies (tenant_id, legal_name, kind) values ($1, 'Hospital Resp', 'prospect') returning id", [alfa]));
    contact = await id(db.query(
      `insert into public.contacts (tenant_id, company_id, name, email, legal_basis, purposes, legal_basis_note, source)
       values ($1, $2, 'Compras', 'compras@hospital.test', 'legitimate_interest', '{prospecting}', 'Interesse comercial B2B', 'cadastro manual') returning id`,
      [alfa, company],
    ));
  });
  // O representante conecta o Gmail (com leitura) e envia um e-mail pelo sistema.
  await asUser(pool, rep, async (db) => {
    conn = await id(db.query("select public.email_connection_save($1, 'rep@respalfa.test', 'v1.aaaaaaaa.bbbbbbbb.cccc') as id", [alfa]));
    await db.query("select public.email_connection_set_inbox($1, true, '100')", [alfa]);
    const p = (await db.query("select public.email_prepare_send($1, $2, $3, 'compras@hospital.test', 'Catálogo', 'Olá', 'teste:resp-1') as r", [alfa, company, contact])).rows[0].r;
    sentMsg = p.message_id;
    await db.query("select public.email_record_result($1, $2, 'sent', 'gm-out-1', null, 'thread-1')", [alfa, sentMsg]);
  });
});
afterAll(async () => drop?.());

describe("svc_inbound_record", () => {
  it("só guarda respostas a conversas iniciadas pelo sistema, uma vez só", async () => {
    expect(await record("in-x", "thread-desconhecida", "compras@hospital.test", "oi")).toMatchObject({ ok: false, reason: "not_our_thread" });
    expect(await record("in-own", "thread-1", "rep@respalfa.test", "minha")).toMatchObject({ ok: false, reason: "own_message" });
    const r = await record("in-1", "thread-1", "Compras@Hospital.test", "Tenho interesse");
    expect(r).toMatchObject({ ok: true, duplicate: false, company: "Hospital Resp", chat_id: null });
    expect(await record("in-1", "thread-1", "compras@hospital.test", "Tenho interesse")).toMatchObject({ ok: true, duplicate: true });
    const acts = await pool.query("select count(*)::int as n from public.activities where metadata ->> 'direction' = 'inbound' and tenant_id = $1", [alfa]);
    expect(acts.rows[0].n).toBe(1);
  });

  it("navegador não chama as funções do servidor", async () => {
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.svc_inbound_record($1, 'a', 'thread-1', null, null, 'x@y.test', 's', 'b', now(), false)", [conn])))
      .toMatchObject({ ok: false, code: "42501" });
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.svc_telegram_reply_prepare(1, 1, 'oi', 1)"))).toMatchObject({ ok: false, code: "42501" });
    expect(await tryAsUser(pool, rep, (db) => db.query("select * from public.svc_gmail_connections(null)"))).toMatchObject({ ok: false, code: "42501" });
    const seen = await asUser(pool, betaAdmin, async (db) => (await db.query("select count(*)::int as n from public.email_inbound")).rows[0].n);
    expect(seen).toBe(0);
  });
});

describe("Telegram", () => {
  it("liga o chat com código de uso único e vencimento", async () => {
    await asUser(pool, rep, (db) => db.query("select public.telegram_link_code_create($1, $2)", [alfa, hash("codigo-valido-123456")]));
    expect(await asService("select public.svc_telegram_link($1, $2, 'rep_tg') as r", [hash("codigo-errado-0000000"), CHAT])).toMatchObject({ ok: false });
    expect(await asService("select public.svc_telegram_link($1, $2, 'rep_tg') as r", [hash("codigo-valido-123456"), CHAT])).toMatchObject({ ok: true, tenant_name: "RespAlfa" });
    // Uso único.
    expect(await asService("select public.svc_telegram_link($1, $2, 'x') as r", [hash("codigo-valido-123456"), 999])).toMatchObject({ ok: false });
    // O próprio usuário vê o vínculo, outro não.
    expect(await asUser(pool, rep, async (db) => (await db.query("select username from public.telegram_links")).rows)).toEqual([{ username: "rep_tg" }]);
    expect(await asUser(pool, other, async (db) => (await db.query("select username from public.telegram_links")).rows)).toEqual([]);
  });

  it("aviso novo já sai com o chat; resposta pelo chat ligado vira e-mail na mesma conversa, uma vez só", async () => {
    const r = await record("in-2", "thread-1", "compras@hospital.test", "Pode mandar preço?");
    expect(r).toMatchObject({ ok: true, chat_id: CHAT });
    await asService("select public.svc_inbound_notified($1, $2, 77) as r", [r.inbound_id, CHAT]);

    // Outro chat respondendo à mesma mensagem: recusado.
    expect(await asService("select public.svc_telegram_reply_prepare(123, 77, 'Segue', 1) as r", [])).toMatchObject({ ok: false, reason: "unknown_message" });
    const p = await asService<Record<string, unknown>>("select public.svc_telegram_reply_prepare($1, 77, 'Segue a tabela.', 9001) as r", [CHAT]);
    expect(p).toMatchObject({ ok: true, duplicate: false, to: "compras@hospital.test", subject: "Re: Catálogo", thread_id: "thread-1", in_reply_to: "<r1@cli.test>" });
    expect(await asService("select public.svc_telegram_reply_prepare($1, 77, 'Segue a tabela.', 9001) as r", [CHAT])).toMatchObject({ ok: true, duplicate: true });
    const res = await asService("select public.svc_email_record_result($1, $2, $3, 'sent', 'gm-2', null, 'thread-1') as r", [rep, alfa, p.message_id]);
    expect(res).toMatchObject({ ok: true, status: "sent" });
    const { rows } = await pool.query("select created_by, in_reply_to_inbound, gmail_thread_id from public.email_messages where id = $1", [p.message_id]);
    expect(rows[0]).toEqual({ created_by: rep, in_reply_to_inbound: r.inbound_id, gmail_thread_id: "thread-1" });
  });

  it("\"SAIR\" registra a oposição e bloqueia a resposta seguinte", async () => {
    const r = await record("in-3", "thread-1", "compras@hospital.test", "SAIR", true);
    expect(r).toMatchObject({ ok: true, opted_out: true });
    const c = await pool.query("select opted_out_at is not null as out from public.contacts where id = $1", [contact]);
    expect(c.rows[0].out).toBe(true);
    await asService("select public.svc_inbound_notified($1, $2, 78) as r", [r.inbound_id, CHAT]);
    expect(await asService("select public.svc_telegram_reply_prepare($1, 78, 'Mas...', 9002) as r", [CHAT])).toMatchObject({ ok: false, reason: "opted_out" });
  });
});
