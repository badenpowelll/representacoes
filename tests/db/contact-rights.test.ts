import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/**
 * Parecer 004-complemento, P1-2/3/4: oposição e exclusão por RPC com
 * verificação, auditoria minimizada, supressão fail-closed e base legal
 * garantida no banco.
 */
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, viewer: string, other: string;
let alfa: string, beta: string, company: string, company2: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const LI = "'legitimate_interest', '{prospecting}', 'Interesse comercial B2B no segmento atendido', 'cadastro manual'";
const newContact = (email: string | null, comp = company) =>
  asUser(pool, rep, (db) =>
    id(db.query(
      `insert into public.contacts (tenant_id, company_id, name, email, legal_basis, purposes, legal_basis_note, source)
       values ($1, $2, 'Fulano', $3, ${LI}) returning id`, [alfa, comp, email])),
  );
const eligibility = (user: string, tenant: string, purpose = "prospecting") =>
  asUser(pool, user, async (db) =>
    (await db.query("select contact_id, eligible, reason from public.contact_eligibility($1, null, $2::public.contact_purpose)", [tenant, purpose])).rows as {
      contact_id: string; eligible: boolean; reason: string | null;
    }[]);

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@direitos.test");
  rep = await createUser(pool, "rep@direitos.test");
  viewer = await createUser(pool, "leitura@direitos.test");
  other = await createUser(pool, "admin@outro.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('Direitos', 'direitos') as id")));
  beta = await asUser(pool, other, (db) => id(db.query("select public.create_tenant('Outro', 'outro') as id")));
  await asUser(pool, admin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [alfa, rep, viewer]));
  company = await asUser(pool, rep, (db) => id(db.query("insert into public.companies (tenant_id, legal_name) values ($1, 'Cliente A') returning id", [alfa])));
  company2 = await asUser(pool, rep, (db) => id(db.query("insert into public.companies (tenant_id, legal_name) values ($1, 'Cliente B') returning id", [alfa])));
});
afterAll(async () => drop?.());

describe("base legal no banco (sem padrão)", () => {
  const ins = (cols: string, vals: string) =>
    tryAsUser(pool, rep, (db) =>
      db.query(`insert into public.contacts (tenant_id, company_id, name${cols}) values ($1, $2, 'X'${vals})`, [alfa, company]));

  it("recusa contato sem base legal, sem finalidade ou sem origem", async () => {
    expect(await ins("", "")).toMatchObject({ ok: false, code: "23514" });
    expect(await ins(", legal_basis, source", ", 'contract', 'manual'")).toMatchObject({ ok: false, message: expect.stringMatching(/finalidade/) });
    expect(await ins(", legal_basis, purposes", ", 'contract', '{support}'")).toMatchObject({ ok: false, message: expect.stringMatching(/origem/) });
  });
  it("legítimo interesse exige justificativa; consentimento exige data e evidência", async () => {
    expect(await ins(", legal_basis, purposes, source", ", 'legitimate_interest', '{prospecting}', 'manual'"))
      .toMatchObject({ ok: false, message: expect.stringMatching(/justificativa/) });
    expect(await ins(", legal_basis, purposes, source, consent_at", ", 'consent', '{prospecting}', 'manual', now()"))
      .toMatchObject({ ok: false, message: expect.stringMatching(/evidência/) });
    expect(await ins(", legal_basis, purposes, source, consent_at, consent_evidence",
      ", 'consent', '{prospecting}', 'manual', now(), 'formulário da feira, 10/11'")).toMatchObject({ ok: true });
  });
});

describe("oposição (opt_out_contact)", () => {
  it("exige a empresa certa e falha explicitamente para contato inexistente", async () => {
    const c = await newContact("op1@cliente.test");
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.opt_out_contact($1, $2, $3)", [alfa, company2, c])))
      .toMatchObject({ ok: false, code: "P0002" });
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.opt_out_contact($1, $2, gen_random_uuid())", [alfa, company])))
      .toMatchObject({ ok: false, code: "P0002" });
  });
  it("leitura e outro tenant não registram oposição", async () => {
    const c = await newContact("op2@cliente.test");
    expect(await tryAsUser(pool, viewer, (db) => db.query("select public.opt_out_contact($1, $2, $3)", [alfa, company, c])))
      .toMatchObject({ ok: false, code: "42501" });
    expect(await tryAsUser(pool, other, (db) => db.query("select public.opt_out_contact($1, $2, $3)", [alfa, company, c])))
      .toMatchObject({ ok: false, code: "42501" });
  });
  it("registra uma vez, é idempotente, suprime e audita sem dados pessoais", async () => {
    const c = await newContact("op3@cliente.test");
    const at1 = await asUser(pool, rep, async (db) => (await db.query("select public.opt_out_contact($1, $2, $3) at", [alfa, company, c])).rows[0].at);
    const at2 = await asUser(pool, rep, async (db) => (await db.query("select public.opt_out_contact($1, $2, $3) at", [alfa, company, c])).rows[0].at);
    expect(at1).toEqual(at2);
    const el = (await eligibility(rep, alfa)).find((r) => r.contact_id === c);
    expect(el).toMatchObject({ eligible: false, reason: "opted_out" });
    const logs = (await pool.query("select action, metadata from public.audit_logs where entity_id = $1", [c])).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("contact.opted_out");
    expect(JSON.stringify(logs[0].metadata)).not.toMatch(/@|Fulano/);
  });
});

describe("exclusão (delete_contact)", () => {
  it("apaga, mantém a supressão e um recadastro do mesmo e-mail continua bloqueado", async () => {
    const c = await newContact("del@cliente.test");
    await asUser(pool, rep, (db) => db.query("select public.delete_contact($1, $2, $3)", [alfa, company, c]));
    expect((await pool.query("select 1 from public.contacts where id = $1", [c])).rowCount).toBe(0);
    const again = await newContact("DEL@cliente.test", company2);
    const el = (await eligibility(rep, alfa)).find((r) => r.contact_id === again);
    expect(el).toMatchObject({ eligible: false, reason: "suppressed" });
    const logs = (await pool.query("select action, metadata from public.audit_logs where entity_id = $1", [c])).rows;
    expect(logs).toEqual([{ action: "contact.deleted", metadata: { company_id: company, suppressed: true } }]);
  });
  it("empresa errada, contato inexistente, leitura e outro tenant falham sem apagar", async () => {
    const c = await newContact("del2@cliente.test");
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.delete_contact($1, $2, $3)", [alfa, company2, c])))
      .toMatchObject({ ok: false, code: "P0002" });
    expect(await tryAsUser(pool, viewer, (db) => db.query("select public.delete_contact($1, $2, $3)", [alfa, company, c])))
      .toMatchObject({ ok: false, code: "42501" });
    expect(await tryAsUser(pool, other, (db) => db.query("select public.delete_contact($1, $2, $3)", [alfa, company, c])))
      .toMatchObject({ ok: false, code: "42501" });
    expect((await pool.query("select 1 from public.contacts where id = $1", [c])).rowCount).toBe(1);
  });
});

describe("elegibilidade (contact_eligibility)", () => {
  it("bloqueia por domínio suprimido, falta de e-mail e finalidade não autorizada", async () => {
    const dom = await newContact("ana@bloqueado.test");
    const semEmail = await newContact(null);
    const ok = await newContact("ok@cliente.test");
    await asUser(pool, admin, (db) =>
      db.query("insert into public.suppression_list (tenant_id, domain, reason) values ($1, 'bloqueado.test', 'manual')", [alfa]));
    const rows = await eligibility(rep, alfa);
    const by = (cid: string) => rows.find((r) => r.contact_id === cid);
    expect(by(dom)).toMatchObject({ eligible: false, reason: "suppressed" });
    expect(by(semEmail)).toMatchObject({ eligible: false, reason: "no_email" });
    expect(by(ok)).toMatchObject({ eligible: true, reason: null });
    expect((await eligibility(rep, alfa, "catalog_distribution")).find((r) => r.contact_id === ok))
      .toMatchObject({ eligible: false, reason: "purpose_not_allowed" });
  });
  it("outro tenant não vê contatos nem supressões", async () => {
    expect(await eligibility(other, alfa)).toEqual([]);
    expect(await eligibility(rep, beta)).toEqual([]);
  });
  it("oposição de contato antigo sem base legal nunca é bloqueada pelo trigger", async () => {
    const c = await newContact("antigo@cliente.test");
    await pool.query("alter table public.contacts disable trigger contacts_lawful_basis");
    await pool.query("update public.contacts set legal_basis = null, purposes = '{}' where id = $1", [c]);
    await pool.query("alter table public.contacts enable trigger contacts_lawful_basis");
    await asUser(pool, rep, (db) => db.query("select public.opt_out_contact($1, $2, $3)", [alfa, company, c]));
    expect((await pool.query("select opted_out_at from public.contacts where id = $1", [c])).rows[0].opted_out_at).not.toBeNull();
  });
});
