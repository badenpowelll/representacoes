import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

// Envio de catálogo em lote (modo assistido): elegibilidade, bloqueios e registro idempotente.
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, viewer: string, betaAdmin: string;
let alfa: string, beta: string, industry: string, draftVersion: string, published: string;
let cliente: string, prospect: string, semFinalidade: string, oposicao: string, semContato: string;
let clienteContact: string, oposicaoContact: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const EXP = "2099-01-01T00:00:00Z";

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@lote.test");
  rep = await createUser(pool, "rep@lote.test");
  viewer = await createUser(pool, "viewer@lote.test");
  betaAdmin = await createUser(pool, "admin@lotebeta.test");
  alfa = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('LoteAlfa', 'lotealfa') as id")));
  beta = await asUser(pool, betaAdmin, (db) => id(db.query("select public.create_tenant('LoteBeta', 'lotebeta') as id")));
  await asUser(pool, admin, async (db) => {
    await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [alfa, rep, viewer]);
    industry = await id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Hospitalar') returning id", [alfa]));
    const cat = await id(db.query("insert into public.catalogs (tenant_id, industry_id, title) values ($1, $2, 'Linha 2027') returning id", [alfa, industry]));
    draftVersion = await id(db.query("insert into public.catalog_versions (tenant_id, catalog_id, version, storage_path) values ($1, $2, 1, $3) returning id", [alfa, cat, `${alfa}/a.pdf`]));
    published = await id(db.query(
      "insert into public.catalog_versions (tenant_id, catalog_id, version, storage_path, status, published_at) values ($1, $2, 2, $3, 'published', now()) returning id",
      [alfa, cat, `${alfa}/b.pdf`],
    ));
    const company = (name: string, kind: string) =>
      id(db.query("insert into public.companies (tenant_id, legal_name, kind) values ($1, $2, $3) returning id", [alfa, name, kind]));
    cliente = await company("Hospital Cliente", "customer");
    prospect = await company("Clinica Prospect", "prospect");
    semFinalidade = await company("Cliente Sem Finalidade", "customer");
    oposicao = await company("Cliente Oposicao", "customer");
    semContato = await company("Cliente Sem Contato", "customer");
    const contact = (company: string, email: string, purposes: string, phone: string) =>
      id(db.query(
        `insert into public.contacts (tenant_id, company_id, name, email, phone, legal_basis, purposes, legal_basis_note, source)
         values ($1, $2, 'Compras', $3, $5, 'legitimate_interest', $4::public.contact_purpose[], 'Interesse comercial B2B', 'cadastro manual') returning id`,
        [alfa, company, email, purposes, phone],
      ));
    clienteContact = await contact(cliente, "compras@cliente.test", "{catalog_distribution}", "84999990001");
    await contact(prospect, "compras@prospect.test", "{prospecting}", "84999990002");
    await contact(semFinalidade, "compras@semfinalidade.test", "{prospecting}", "84999990003");
    oposicaoContact = await contact(oposicao, "compras@oposicao.test", "{catalog_distribution}", "84999990004");
    await db.query("select public.opt_out_contact($1, $2, $3)", [alfa, oposicao, oposicaoContact]);
  });
});
afterAll(async () => drop?.());

const create = (user: string, tenant: string, version: string, companies: string[], channel = "email") =>
  asUser(pool, user, async (db) =>
    (await db.query("select public.create_catalog_campaign($1, $2, $3, 'Lote teste', 'Catálogo', 'Olá {{empresa}}', $4::uuid[], $5) as r", [
      tenant, version, channel, companies, EXP,
    ])).rows[0].r,
  );

describe("create_catalog_campaign", () => {
  it("separa quem pode receber de quem está bloqueado, com o motivo", async () => {
    const r = await create(rep, alfa, published, [cliente, prospect, semFinalidade, oposicao, semContato, cliente]);
    expect(r).toMatchObject({ ready: 2, blocked: 3 });
    const { rows } = await pool.query(
      "select c.legal_name, r.status, r.reason from public.campaign_recipients r join public.companies c on c.id = r.company_id where r.campaign_id = $1 order by c.legal_name",
      [r.campaign_id],
    );
    expect(rows).toEqual([
      { legal_name: "Cliente Oposicao", status: "blocked", reason: "opted_out" },
      { legal_name: "Cliente Sem Contato", status: "blocked", reason: "no_contact" },
      { legal_name: "Cliente Sem Finalidade", status: "blocked", reason: "purpose_not_allowed" },
      { legal_name: "Clinica Prospect", status: "pending", reason: null },
      { legal_name: "Hospital Cliente", status: "pending", reason: null },
    ]);
  });

  it("recusa versão em rascunho, leitor e outro tenant", async () => {
    expect(await tryAsUser(pool, rep, (db) => db.query("select public.create_catalog_campaign($1, $2, 'email', 'x1', null, 'b', $3::uuid[], $4)", [alfa, draftVersion, [cliente], EXP])))
      .toMatchObject({ ok: false, code: "P0002" });
    expect(await tryAsUser(pool, viewer, (db) => db.query("select public.create_catalog_campaign($1, $2, 'email', 'x1', null, 'b', $3::uuid[], $4)", [alfa, published, [cliente], EXP])))
      .toMatchObject({ ok: false, code: "42501" });
    expect(await tryAsUser(pool, betaAdmin, (db) => db.query("select public.create_catalog_campaign($1, $2, 'email', 'x1', null, 'b', $3::uuid[], $4)", [alfa, published, [cliente], EXP])))
      .toMatchObject({ ok: false });
    // Beta não consegue usar o catálogo de Alfa nem empresas de Alfa no próprio tenant.
    expect(await tryAsUser(pool, betaAdmin, (db) => db.query("select public.create_catalog_campaign($1, $2, 'email', 'x1', null, 'b', $3::uuid[], $4)", [beta, published, [cliente], EXP])))
      .toMatchObject({ ok: false, code: "P0002" });
    const seen = await asUser(pool, betaAdmin, async (db) => (await db.query("select count(*)::int as n from public.campaign_recipients")).rows[0].n);
    expect(seen).toBe(0);
  });

  it("WhatsApp usa o telefone e a supressão por telefone", async () => {
    const r = await create(rep, alfa, published, [cliente, prospect], "whatsapp");
    expect(r).toMatchObject({ ready: 2, blocked: 0 });
    // Telefone suprimido (oposição de outro contato com o mesmo número) bloqueia.
    await asUser(pool, admin, (db) => db.query("insert into public.suppression_list (tenant_id, phone, reason) values ($1, '84999990001', 'manual')", [alfa]));
    expect(await create(rep, alfa, published, [cliente], "whatsapp")).toMatchObject({ ready: 0, blocked: 1 });
    await pool.query("delete from public.suppression_list where tenant_id = $1 and phone is not null and phone like '%990001'", [alfa]);
  });
});

describe("campaign_record_send", () => {
  it("registra a atividade uma vez só e bloqueia oposição que chega depois", async () => {
    const r = await create(rep, alfa, published, [cliente, prospect]);
    const { rows: recips } = await pool.query("select id, company_id from public.campaign_recipients where campaign_id = $1", [r.campaign_id]);
    const rc = recips.find((x) => x.company_id === cliente)!;
    const send = (rid: string) =>
      asUser(pool, rep, async (db) => (await db.query("select public.campaign_record_send($1, $2, 'Catálogo', 'Olá') as r", [alfa, rid])).rows[0].r);
    expect(await send(rc.id)).toMatchObject({ ok: true, already_sent: false, contact_id: clienteContact });
    expect(await send(rc.id)).toMatchObject({ ok: true, already_sent: true });
    const acts = await pool.query("select count(*)::int as n from public.activities where metadata ->> 'campaign_id' = $1", [r.campaign_id]);
    expect(acts.rows[0].n).toBe(1);

    // O prospect pede para não ser contatado depois de o lote ser montado.
    const rp = recips.find((x) => x.company_id === prospect)!;
    const { rows: pc } = await pool.query("select id from public.contacts where company_id = $1", [prospect]);
    await asUser(pool, rep, (db) => db.query("select public.opt_out_contact($1, $2, $3)", [alfa, prospect, pc[0].id]));
    expect(await send(rp.id)).toMatchObject({ ok: false, reason: "opted_out" });
    const st = await pool.query("select status from public.campaign_recipients where id = $1", [rp.id]);
    expect(st.rows[0].status).toBe("blocked");
  });
});
