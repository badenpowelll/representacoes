import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

// Base pública sintética (CNPJs fictícios, nunca reais).
const NATAL = 2408102;
const MOSSORO = 2408003;
const FORTALEZA = 2304400;

let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, viewer: string, betaAdmin: string;
let alfa: string, beta: string, hosp: string, semCnae: string, betaInd: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

type Hit = {
  cnpj: string; legal_name: string; email: string | null; phones: string[]; company_id: string | null; lead_id: string | null;
  email_suppressed: boolean; phone_suppressed: boolean; total_count: string; main_cnae_description: string | null; municipality_name: string;
};
const search = (user: string, tenant: string, industry: string, opts: Record<string, unknown> = {}) =>
  asUser(pool, user, async (db) =>
    (await db.query(
      `select * from public.prospect_search(p_tenant => $1, p_industry => $2, p_municipality => $3, p_query => $4,
         p_with_email => $5, p_with_phone => $6, p_include_secondary => $7, p_hide_in_portfolio => $8)`,
      [tenant, industry, opts.municipality ?? null, opts.query ?? null, opts.withEmail ?? false, opts.withPhone ?? false,
       opts.secondary ?? false, opts.hide ?? false],
    )).rows as Hit[],
  );
const add = (user: string, tenant: string, industry: string, cnpj: string, email: string | null = null, phone: string | null = null) =>
  asUser(pool, user, async (db) =>
    (await db.query("select public.prospect_add($1, $2, $3, $4, $5) as r", [tenant, industry, cnpj, email, phone])).rows[0].r as {
      company_id: string; lead_id: string; contact_id: string | null; company_created: boolean; lead_created: boolean;
    },
  );

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@pr.test");
  rep = await createUser(pool, "rep@pr.test");
  viewer = await createUser(pool, "viewer@pr.test");
  betaAdmin = await createUser(pool, "admin@prbeta.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('PrAlfa', 'pralfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('PrBeta', 'prbeta') as id")));
  await asUser(pool, admin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [alfa, rep, viewer]);
    hosp = await id(db.query("insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Material hospitalar', '{8610101,8630503}') returning id", [alfa]));
    semCnae = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Sem CNAE') returning id", [alfa]));
    await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN')", [alfa, hosp]);
    await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN')", [alfa, semCnae]);
  });
  betaInd = await asUser(pool, betaAdmin, async (db) => {
    const i = await id(db.query("insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Beta hosp', '{8610101}') returning id", [beta]));
    await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'CE')", [beta, i]);
    return i;
  });
  // Carga do importador (papel de serviço).
  await pool.query(
    `insert into ref.cnpj_establishments (cnpj, legal_name, trade_name, is_headquarters, main_cnae, secondary_cnaes, state_code,
       municipality_id, phones, email, dataset_ref) values
     ('90000000000101', 'HOSPITAL FICTICIO NATAL LTDA', 'Hospital Natal', true, '8610101', '{}', 'RN', ${NATAL}, '{8432000000}', 'contato@hospnatal.test', '2026-10'),
     ('90000000000202', 'CLINICA FICTICIA MOSSORO LTDA', null, true, '8630503', '{}', 'RN', ${MOSSORO}, '{84999990000}', null, '2026-10'),
     ('90000000000303', 'FARMACIA FICTICIA LTDA', null, true, '4771701', '{8630503}', 'RN', ${NATAL}, '{}', 'farm@farm.test', '2026-10'),
     ('90000000000404', 'HOSPITAL FICTICIO FORTALEZA LTDA', null, true, '8610101', '{}', 'CE', ${FORTALEZA}, '{8530000000}', 'h@fortaleza.test', '2026-10'),
     ('90000000000505', 'PADARIA FICTICIA LTDA', null, true, '1091102', '{}', 'RN', ${NATAL}, '{}', 'p@padaria.test', '2026-10')`,
  );
});
afterAll(async () => drop?.());

describe("base pública de CNPJ", () => {
  it("não é legível diretamente por usuários", async () => {
    const r = await tryAsUser(pool, rep, (db) => db.query("select * from ref.cnpj_establishments"));
    expect(r).toMatchObject({ ok: false, code: "42501" });
  });
});

describe("prospect_search", () => {
  it("lista só empresas com CNAE-alvo dentro do território da indústria", async () => {
    const rows = await search(rep, alfa, hosp);
    expect(rows.map((r) => r.cnpj).sort()).toEqual(["90000000000101", "90000000000202"]);
    expect(Number(rows[0].total_count)).toBe(2);
    expect(rows.find((r) => r.cnpj === "90000000000101")?.main_cnae_description).toMatch(/hospitalar/);
    expect(rows.find((r) => r.cnpj === "90000000000101")?.municipality_name).toBe("Natal");
  });

  it("filtros: CNAE secundário, e-mail, telefone, município e texto", async () => {
    expect((await search(rep, alfa, hosp, { secondary: true })).length).toBe(3);
    expect((await search(rep, alfa, hosp, { withEmail: true })).map((r) => r.cnpj)).toEqual(["90000000000101"]);
    expect((await search(rep, alfa, hosp, { municipality: MOSSORO })).map((r) => r.cnpj)).toEqual(["90000000000202"]);
    expect((await search(rep, alfa, hosp, { query: "mossoro" })).map((r) => r.cnpj)).toEqual(["90000000000202"]);
    expect((await search(rep, alfa, hosp, { query: "90.000.000/0001-01" })).map((r) => r.cnpj)).toEqual(["90000000000101"]);
  });

  it("indústria sem CNAE-alvo não lista nada", async () => {
    expect(await search(rep, alfa, semCnae)).toEqual([]);
  });

  it("outro tenant não pesquisa com a indústria de Alfa nem vê o território de Alfa", async () => {
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query("select * from public.prospect_search($1, $2)", [alfa, hosp]))).ok).toBe(false);
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query("select * from public.prospect_search($1, $2)", [beta, hosp]))).ok).toBe(false);
    expect((await search(betaAdmin, beta, betaInd)).map((r) => r.cnpj)).toEqual(["90000000000404"]);
  });
});

describe("prospect_add", () => {
  it("cria empresa, lead e contato institucional com fonte, data e base legal", async () => {
    const r = await add(rep, alfa, hosp, "90000000000101");
    expect(r).toMatchObject({ company_created: true, lead_created: true });
    const { rows } = await pool.query(
      `select c.legal_name, c.source, c.source_date::text, c.segment, l.status, ct.email, ct.phone, ct.legal_basis, ct.purposes::text, ct.legal_basis_note
         from public.companies c join public.leads l on l.company_id = c.id join public.contacts ct on ct.company_id = c.id
        where c.id = $1`,
      [r.company_id],
    );
    expect(rows[0]).toMatchObject({
      legal_name: "HOSPITAL FICTICIO NATAL LTDA",
      source: "Receita Federal - dados abertos do CNPJ (ref. 2026-10)",
      source_date: "2026-10-01",
      status: "new",
      email: "contato@hospnatal.test",
      phone: "8432000000",
      legal_basis: "legitimate_interest",
      purposes: "{prospecting}",
    });
    expect(rows[0].segment).toMatch(/hospitalar/);
    const audit = await pool.query("select count(*)::int as n from public.audit_logs where tenant_id = $1 and action = 'prospect.added'", [alfa]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("é idempotente e a busca passa a marcar a empresa como na carteira", async () => {
    const r = await add(rep, alfa, hosp, "90000000000101");
    expect(r).toMatchObject({ company_created: false, lead_created: false });
    const rows = await search(rep, alfa, hosp);
    expect(rows.find((x) => x.cnpj === "90000000000101")?.lead_id).toBe(r.lead_id);
    expect((await search(rep, alfa, hosp, { hide: true })).map((x) => x.cnpj)).toEqual(["90000000000202"]);
  });

  it("aceita e-mail corrigido pelo usuário e registra a correção na origem", async () => {
    const r = await add(rep, alfa, hosp, "90000000000202", "Compras@ClinicaMossoro.test", null);
    const { rows } = await pool.query("select email, phone, source from public.contacts where id = $1", [r.contact_id]);
    expect(rows[0]).toEqual({ email: "compras@clinicamossoro.test", phone: "84999990000", source: "Receita Federal - dados abertos do CNPJ (ref. 2026-10), corrigido manualmente" });
  });

  it("recusa empresa fora do território/CNAE, leitura e outro tenant", async () => {
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.prospect_add($1, $2, $3)", [alfa, hosp, "90000000000404"]))).toMatchObject({ ok: false, code: "P0002" });
    expect(await tryAsUser(pool, viewer, (db) => db.query("select public.prospect_add($1, $2, $3)", [alfa, hosp, "90000000000202"]))).toMatchObject({ ok: false, code: "42501" });
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query("select public.prospect_add($1, $2, $3)", [alfa, hosp, "90000000000202"]))).ok).toBe(false);
    expect((await tryAsUser(pool, betaAdmin, (db) => db.query("select public.prospect_add($1, $2, $3)", [beta, hosp, "90000000000202"]))).ok).toBe(false);
  });
});

describe("WhatsApp: elegibilidade e supressão por telefone", () => {
  const elig = (channel: string) =>
    asUser(pool, rep, async (db) =>
      (await db.query("select e.eligible, e.reason, c.phone from public.contact_eligibility($1, null, 'prospecting', $2) e join public.contacts c on c.id = e.contact_id order by c.created_at", [alfa, channel])).rows as {
        eligible: boolean; reason: string | null; phone: string;
      }[],
    );

  it("contato com telefone é elegível para WhatsApp; canal desconhecido não", async () => {
    expect((await elig("whatsapp")).every((r) => r.eligible)).toBe(true);
    expect((await elig("sms")).every((r) => r.reason === "channel_not_supported")).toBe(true);
  });

  it("oposição bloqueia o telefone e a busca deixa de mostrá-lo", async () => {
    const { rows } = await pool.query("select id, company_id from public.contacts where tenant_id = $1 and phone = '84999990000'", [alfa]);
    await asUser(pool, rep, (db) => db.query("select public.opt_out_contact($1, $2, $3)", [alfa, rows[0].company_id, rows[0].id]));
    const sup = await pool.query("select phone, reason from public.suppression_list where tenant_id = $1 and phone is not null", [alfa]);
    expect(sup.rows).toEqual([{ phone: "84999990000", reason: "opt_out" }]);
    const hit = (await search(rep, alfa, hosp)).find((x) => x.cnpj === "90000000000202");
    expect(hit).toMatchObject({ phone_suppressed: true, phones: [] });
    expect((await elig("whatsapp")).find((r) => r.phone === "84999990000")).toMatchObject({ eligible: false, reason: "opted_out" });
  });

  it("normaliza telefones com +55, zero e máscara", async () => {
    const { rows } = await pool.query(
      "select app.normalize_phone('+55 (84) 99999-0000') a, app.normalize_phone('084 3200-0000') b, app.normalize_phone('123') c",
    );
    expect(rows[0]).toEqual({ a: "84999990000", b: "8432000000", c: null });
  });
});

describe("modelos de mensagem", () => {
  it("representante salva; leitura não; outro tenant não vê", async () => {
    await asUser(pool, rep, (db) =>
      db.query("insert into public.message_templates (tenant_id, industry_id, channel, subject, body) values ($1, $2, 'email', 'Olá {{empresa}}', 'Texto do e-mail para {{empresa}}')", [alfa, hosp]),
    );
    expect((await tryAsUser(pool, viewer, (db) => db.query("insert into public.message_templates (tenant_id, industry_id, channel, body) values ($1, $2, 'whatsapp', 'Olá, tudo bem? Texto')", [alfa, hosp]))).ok).toBe(false);
    const seen = await asUser(pool, betaAdmin, async (db) => (await db.query("select count(*)::int as n from public.message_templates")).rows[0].n);
    expect(seen).toBe(0);
    expect((await tryAsUser(pool, rep, (db) => db.query("insert into public.message_templates (tenant_id, industry_id, channel, body) values ($1, $2, 'email', 'sem assunto aqui ok')", [alfa, semCnae]))).ok).toBe(false);
  });
});

describe("prospect_add com correção em contato existente", () => {
  it("atualiza só o campo corrigido e registra a correção", async () => {
    await pool.query(
      "insert into ref.cnpj_establishments (cnpj, legal_name, is_headquarters, main_cnae, state_code, municipality_id, phones, email, dataset_ref) values ('90000000000606', 'LAB FICTICIO LTDA', true, '8610101', 'RN', $1, '{8433330000}', 'lab@lab.test', '2026-10')",
      [NATAL],
    );
    const first = await add(rep, alfa, hosp, "90000000000606");
    const second = await add(rep, alfa, hosp, "90000000000606", null, "(84) 98777-0000");
    expect(second.contact_id).toBe(first.contact_id);
    const { rows } = await pool.query("select email, phone, source from public.contacts where id = $1", [first.contact_id]);
    expect(rows[0]).toEqual({ email: "lab@lab.test", phone: "84987770000", source: "Receita Federal - dados abertos do CNPJ (ref. 2026-10), corrigido manualmente" });
  });
});
