import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createTestDatabase, createUser, tryAsUser } from "./harness";

/** ADR 0009: lote de importação (clientes e preços) com isolamento, imutabilidade e auditoria. */
let pool: Pool;
let drop: () => Promise<void>;
let admin: string, rep: string, viewer: string, other: string;
let tenant: string, beta: string, ind: string, indBeta: string;

const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
const companiesImport = (user: string, t = tenant) =>
  asUser(pool, user, (db) =>
    id(db.query(
      `insert into public.data_imports (tenant_id, kind, file_name, source, source_date, legal_basis, legal_basis_note, purposes, total_rows)
       values ($1, 'companies', 'clientes.xlsx', 'Planilha da indústria', '2026-11-20', 'legitimate_interest',
               'Relacionamento comercial B2B com clientes', '{customer_relationship}', 3) returning id`, [t])));

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  admin = await createUser(pool, "admin@importa.test");
  rep = await createUser(pool, "rep@importa.test");
  viewer = await createUser(pool, "leitura@importa.test");
  other = await createUser(pool, "admin@outro-importa.test");
  tenant = await asUser(pool, admin, (db) => id(db.query("select public.create_tenant('Importa', 'importa') as id")));
  beta = await asUser(pool, other, (db) => id(db.query("select public.create_tenant('Outro', 'outro-importa') as id")));
  await asUser(pool, admin, (db) =>
    db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'representative'), ($1, $3, 'viewer')", [tenant, rep, viewer]));
  ind = await asUser(pool, admin, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind') returning id", [tenant])));
  indBeta = await asUser(pool, other, (db) => id(db.query("insert into public.industries (tenant_id, name) values ($1, 'Ind B') returning id", [beta])));
});
afterAll(async () => drop?.());

describe("quem pode importar", () => {
  it("representante importa clientes, mas não produtos; leitura não importa nada", async () => {
    expect(await companiesImport(rep)).toMatch(/^[0-9a-f-]{36}$/);
    const products = await tryAsUser(pool, rep, (db) =>
      db.query("insert into public.data_imports (tenant_id, kind, file_name, source, industry_id, price_reference) values ($1, 'products', 'p.xlsx', 'Tabela', $2, 'TAB-11')", [tenant, ind]));
    expect(products.ok).toBe(false);
    const ro = await tryAsUser(pool, viewer, () => companiesImport(viewer));
    expect(ro.ok).toBe(false);
  });

  it("não cria lote em outra representação nem com indústria de outra representação", async () => {
    expect((await tryAsUser(pool, admin, () => companiesImport(admin, beta))).ok).toBe(false);
    const cross = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.data_imports (tenant_id, kind, file_name, source, industry_id, price_reference) values ($1, 'products', 'p.xlsx', 'Tabela', $2, 'TAB-11')", [tenant, indBeta]));
    expect(cross.ok).toBe(false);
  });

  it("outra representação não enxerga os lotes", async () => {
    await companiesImport(admin);
    const seen = await asUser(pool, other, async (db) => (await db.query("select id from public.data_imports where tenant_id = $1", [tenant])).rowCount);
    expect(seen).toBe(0);
  });
});

describe("regras do lote", () => {
  it("clientes exigem base legal (sem consentimento), justificativa e finalidade", async () => {
    const semFinalidade = await tryAsUser(pool, admin, (db) =>
      db.query(`insert into public.data_imports (tenant_id, kind, file_name, source, legal_basis, legal_basis_note)
                values ($1, 'companies', 'c.csv', 'Planilha', 'contract', 'Contrato X')`, [tenant]));
    const consentimento = await tryAsUser(pool, admin, (db) =>
      db.query(`insert into public.data_imports (tenant_id, kind, file_name, source, legal_basis, legal_basis_note, purposes)
                values ($1, 'companies', 'c.csv', 'Planilha', 'consent', 'Formulário assinado por todos', '{support}')`, [tenant]));
    const curta = await tryAsUser(pool, admin, (db) =>
      db.query(`insert into public.data_imports (tenant_id, kind, file_name, source, legal_basis, legal_basis_note, purposes)
                values ($1, 'companies', 'c.csv', 'Planilha', 'legitimate_interest', 'curta', '{support}')`, [tenant]));
    expect([semFinalidade.ok, consentimento.ok, curta.ok]).toEqual([false, false, false]);
  });

  it("produtos exigem referência do documento de preços", async () => {
    const r = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.data_imports (tenant_id, kind, file_name, source, industry_id) values ($1, 'products', 'p.xlsx', 'Tabela', $2)", [tenant, ind]));
    expect(r.ok).toBe(false);
  });

  it("autor e contadores iniciais vêm do servidor; origem não muda depois; contadores não diminuem", async () => {
    const imp = await asUser(pool, admin, (db) =>
      id(db.query(
        `insert into public.data_imports (tenant_id, kind, file_name, source, source_date, legal_basis, legal_basis_note, purposes, created_by, created_count)
         values ($1, 'companies', 'c.csv', 'Planilha', '2026-11-20', 'contract', 'Contrato X', '{support}', $2, 99) returning id`, [tenant, other])));
    const row = await asUser(pool, admin, async (db) => (await db.query("select created_by, created_count from public.data_imports where id = $1", [imp])).rows[0]);
    expect(row).toEqual({ created_by: admin, created_count: 0 });
    const src = await tryAsUser(pool, admin, (db) => db.query("update public.data_imports set source = 'Outra' where id = $1", [imp]));
    expect(src.ok).toBe(false);
    await asUser(pool, admin, (db) => db.query("update public.data_imports set created_count = 5 where id = $1", [imp]));
    const down = await tryAsUser(pool, admin, (db) => db.query("update public.data_imports set created_count = 1 where id = $1", [imp]));
    expect(down.ok).toBe(false);
  });

  it("concluir grava auditoria só com números e trava o lote", async () => {
    const imp = await companiesImport(admin);
    await asUser(pool, admin, (db) => db.query("update public.data_imports set created_count = 2, error_count = 1 where id = $1", [imp]));
    await asUser(pool, admin, (db) => db.query("update public.data_imports set status = 'completed' where id = $1", [imp]));
    const audit = await pool.query("select action, metadata from public.audit_logs where entity_id = $1", [imp]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "data_import.completed", metadata: { created: 2, errors: 1, total_rows: 3 } });
    const finished = await pool.query("select finished_at from public.data_imports where id = $1", [imp]);
    expect(finished.rows[0].finished_at).not.toBeNull();
    const after = await asUser(pool, admin, async (db) => (await db.query("update public.data_imports set created_count = 10 where id = $1", [imp])).rowCount);
    expect(after).toBe(0);
  });

  it("não há exclusão de lotes", async () => {
    const imp = await companiesImport(admin);
    const r = await tryAsUser(pool, admin, (db) => db.query("delete from public.data_imports where id = $1", [imp]));
    expect(r.ok).toBe(false);
  });
});

describe("rastreio nas linhas importadas", () => {
  it("empresa e produto guardam o lote; lote de outra representação é recusado", async () => {
    const imp = await companiesImport(admin);
    const company = await asUser(pool, admin, (db) =>
      id(db.query("insert into public.companies (tenant_id, legal_name, source, import_id) values ($1, 'Mercado A', 'Planilha', $2) returning id", [tenant, imp])));
    expect(company).toBeTruthy();
    const foreign = await asUser(pool, other, () => companiesImport(other, beta));
    const cross = await tryAsUser(pool, admin, (db) =>
      db.query("insert into public.companies (tenant_id, legal_name, source, import_id) values ($1, 'Mercado B', 'Planilha', $2)", [tenant, foreign]));
    expect(cross.ok).toBe(false);
    const prodImp = await asUser(pool, admin, (db) =>
      id(db.query("insert into public.data_imports (tenant_id, kind, file_name, source, industry_id, price_reference) values ($1, 'products', 'p.xlsx', 'Tabela da indústria', $2, 'TAB-11') returning id", [tenant, ind])));
    const prod = await asUser(pool, admin, async (db) =>
      (await db.query(
        `insert into public.products (tenant_id, industry_id, sku, name, authorized_price, price_valid_until, price_source, price_reference, import_id)
         values ($1, $2, 'X1', 'Prod', 10.5, '2026-12-31', 'Tabela da indústria', 'TAB-11', $3) returning price_authorized_by`, [tenant, ind, prodImp])).rows[0]);
    expect(prod.price_authorized_by).toBe(admin);
  });
});
