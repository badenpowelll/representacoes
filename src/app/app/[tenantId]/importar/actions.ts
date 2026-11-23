"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext, type TenantContext } from "@/lib/auth/tenant-context";
import { lookupCnpjCached } from "@/lib/cnpj/lookup";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COMPANY_FIELDS, normalizeHeader, PRODUCT_FIELDS, type ImportKind } from "@/lib/importacao/fields";
import {
  hasError,
  normalizeCompanyRow,
  normalizeProductRow,
  type CompanyChannel,
  type CompanyImportRow,
  type Issue,
  type RawRow,
} from "@/lib/importacao/normalize";
import {
  companyImportOptionsSchema,
  productImportOptionsSchema,
  rawRowsSchema,
  type ImportReportError,
} from "@/lib/importacao/options";
import { zodFieldErrors } from "@/lib/action-state";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Fail = { ok: false; message: string; fieldErrors?: Record<string, string> };

export type RowStatus = "created" | "updated" | "unchanged" | "error";
export type RowResult = { row: number; status: RowStatus; issues: Issue[]; contact?: "created" | "exists" };
export type BatchResult = { ok: true; results: RowResult[] } | Fail;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMISSION = { companies: "crm.write", products: "catalog.write" } as const;
const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...COMPANY_FIELDS, ...PRODUCT_FIELDS].map((f) => [f.key, f.label]),
);

async function authorize(tenantId: string, kind: ImportKind): Promise<TenantContext> {
  const ctx = await requireTenantContext(String(tenantId));
  if (!can(ctx.role, PERMISSION[kind])) {
    throw new AuthorizationError(
      kind === "products" ? "Só administradores e gerentes importam produtos e preços." : "Você não tem permissão para importar clientes.",
      403,
    );
  }
  return ctx;
}

async function guard<T>(fn: () => Promise<T | Fail>): Promise<T | Fail> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Data comercial no Brasil (vigência de preço). */
const commercialToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// ---------------------------------------------------------------------------
// Início do lote
// ---------------------------------------------------------------------------
export async function startImport(
  tenantId: string,
  kind: ImportKind,
  input: unknown,
): Promise<{ ok: true; importId: string } | Fail> {
  return guard(async () => {
    if (kind !== "companies" && kind !== "products") return { ok: false, message: "Tipo de importação inválido." };
    const ctx = await authorize(tenantId, kind);
    const supabase = await createSupabaseServerClient();
    let row: Record<string, unknown>;
    if (kind === "companies") {
      const parsed = companyImportOptionsSchema.safeParse(input);
      if (!parsed.success) return { ok: false, message: "Revise as opções da importação.", fieldErrors: zodFieldErrors(parsed.error.issues) };
      const o = parsed.data;
      row = {
        kind, file_name: o.file_name, file_sha256: o.file_sha256, total_rows: o.total_rows,
        source: o.source, source_date: o.source_date, legal_basis: o.legal_basis,
        legal_basis_note: o.legal_basis_note, purposes: o.purposes,
        options: { default_kind: o.default_kind, enrich: o.enrich, existing: o.existing },
      };
    } else {
      const parsed = productImportOptionsSchema.safeParse(input);
      if (!parsed.success) return { ok: false, message: "Revise as opções da importação.", fieldErrors: zodFieldErrors(parsed.error.issues) };
      const o = parsed.data;
      if (o.catalog_version_id) {
        const { data: v } = await supabase
          .from("catalog_versions")
          .select("id, catalogs!inner(industry_id)")
          .eq("tenant_id", ctx.tenantId)
          .eq("id", o.catalog_version_id)
          .maybeSingle();
        const industry = (v?.catalogs as unknown as { industry_id: string } | null)?.industry_id;
        if (!v || industry !== o.industry_id) {
          return { ok: false, message: "Revise as opções da importação.", fieldErrors: { catalog_version_id: "Este catálogo é de outra indústria." } };
        }
      }
      row = {
        kind, file_name: o.file_name, file_sha256: o.file_sha256, total_rows: o.total_rows,
        source: o.source, source_date: commercialToday(), industry_id: o.industry_id, price_reference: o.price_reference,
        options: { catalog_version_id: o.catalog_version_id, default_valid_until: o.default_valid_until, existing: o.existing },
      };
    }
    const { data, error } = await supabase
      .from("data_imports")
      .insert({ ...row, tenant_id: ctx.tenantId })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, message: error?.code === "23503" ? "Indústria não encontrada nesta representação." : "Não foi possível iniciar a importação." };
    }
    return { ok: true, importId: data.id as string };
  });
}

type ImportRecord = {
  id: string;
  kind: ImportKind;
  status: string;
  source: string;
  source_date: string | null;
  legal_basis: "legitimate_interest" | "contract" | null;
  legal_basis_note: string | null;
  purposes: string[];
  industry_id: string | null;
  price_reference: string | null;
  options: Record<string, unknown>;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  error_count: number;
  contacts_created: number;
  errors: ImportReportError[];
};

async function loadImport(supabase: Supabase, tenantId: string, importId: string): Promise<ImportRecord | null> {
  if (!UUID_RE.test(importId)) return null;
  const { data } = await supabase
    .from("data_imports")
    .select("id, kind, status, source, source_date, legal_basis, legal_basis_note, purposes, industry_id, price_reference, options, created_count, updated_count, unchanged_count, error_count, contacts_created, errors")
    .eq("tenant_id", tenantId)
    .eq("id", importId)
    .maybeSingle();
  return (data as ImportRecord | null) ?? null;
}

/** Soma o resultado do lote no registro da importação (sem conteúdo de células). */
async function recordBatch(supabase: Supabase, tenantId: string, imp: ImportRecord, results: RowResult[]) {
  const count = (s: RowStatus) => results.filter((r) => r.status === s).length;
  const newErrors: ImportReportError[] = results
    .filter((r) => r.status === "error")
    .flatMap((r) =>
      r.issues.filter((i) => i.level === "error").map((i) => ({ row: r.row, column: FIELD_LABELS[i.field] ?? i.field, message: i.message })),
    );
  await supabase
    .from("data_imports")
    .update({
      created_count: imp.created_count + count("created"),
      updated_count: imp.updated_count + count("updated"),
      unchanged_count: imp.unchanged_count + count("unchanged"),
      error_count: imp.error_count + count("error"),
      contacts_created: imp.contacts_created + results.filter((r) => r.contact === "created").length,
      errors: [...(imp.errors ?? []), ...newErrors].slice(0, 1000),
    })
    .eq("tenant_id", tenantId)
    .eq("id", imp.id);
}

// ---------------------------------------------------------------------------
// Lote de linhas (o navegador envia de BATCH_SIZE em BATCH_SIZE)
// ---------------------------------------------------------------------------
export async function importBatch(tenantId: string, importId: string, rowsInput: unknown): Promise<BatchResult> {
  return guard(async () => {
    const ctx = await requireTenantContext(String(tenantId));
    const supabase = await createSupabaseServerClient();
    const imp = await loadImport(supabase, ctx.tenantId, String(importId));
    if (!imp) return { ok: false, message: "Importação não encontrada." };
    await authorize(ctx.tenantId, imp.kind);
    if (imp.status !== "running") return { ok: false, message: "Esta importação já foi encerrada." };
    const parsed = rawRowsSchema.safeParse(rowsInput);
    if (!parsed.success) return { ok: false, message: "Lote de linhas inválido." };

    const results =
      imp.kind === "companies"
        ? await importCompanies(supabase, ctx, imp, parsed.data)
        : await importProducts(supabase, ctx, imp, parsed.data);
    await recordBatch(supabase, ctx.tenantId, imp, results);
    return { ok: true, results };
  });
}

const clientErrorsSchema = z
  .array(z.object({ row: z.number().int().min(1), column: z.string().max(120), message: z.string().max(300) }))
  .max(5000);

/**
 * Encerra o lote. `skipped` são as linhas que o navegador já recusou antes de
 * enviar (ex.: CNPJ ou SKU repetido na própria planilha), para o relatório.
 */
export async function finishImport(
  tenantId: string,
  importId: string,
  opts: { failed?: boolean; skipped?: unknown } = {},
): Promise<{ ok: true } | Fail> {
  return guard(async () => {
    const ctx = await requireTenantContext(String(tenantId));
    const supabase = await createSupabaseServerClient();
    const imp = await loadImport(supabase, ctx.tenantId, String(importId));
    if (!imp) return { ok: false, message: "Importação não encontrada." };
    await authorize(ctx.tenantId, imp.kind);
    if (imp.status === "running") {
      const skipped = clientErrorsSchema.safeParse(opts.skipped ?? []);
      const extra = skipped.success ? skipped.data : [];
      const rows = new Set(extra.map((e) => e.row)).size;
      await supabase
        .from("data_imports")
        .update({
          status: opts.failed ? "failed" : "completed",
          error_count: imp.error_count + rows,
          errors: [...(imp.errors ?? []), ...extra].slice(0, 1000),
        })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", imp.id);
    }
    revalidatePath(`/app/${ctx.tenantId}/${imp.kind === "companies" ? "empresas" : "produtos"}`, "layout");
    return { ok: true };
  });
}

/**
 * Prévia: quais CNPJs/nomes (clientes) ou SKUs (produtos) já existem na
 * representação, para mostrar "novo" ou "já cadastrado" antes de importar.
 */
export async function checkExisting(
  tenantId: string,
  kind: ImportKind,
  keys: string[],
  industryId?: string,
): Promise<{ ok: true; existing: string[] } | Fail> {
  return guard(async () => {
    const ctx = await authorize(tenantId, kind);
    if (!Array.isArray(keys)) return { ok: false, message: "Lista inválida." };
    const list = [...new Set(keys.map(String).filter((k) => k.length > 0 && k.length <= 300))].slice(0, 5000);
    if (list.length === 0) return { ok: true, existing: [] };
    const supabase = await createSupabaseServerClient();
    const found: string[] = [];
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      if (kind === "companies") {
        const cnpjs = chunk.filter((k) => /^\d{14}$/.test(k));
        if (cnpjs.length) {
          const { data } = await supabase.from("companies").select("cnpj").eq("tenant_id", ctx.tenantId).in("cnpj", cnpjs);
          found.push(...(data ?? []).map((r) => r.cnpj as string));
        }
        const names = chunk.filter((k) => !/^\d{14}$/.test(k));
        if (names.length) {
          const { data } = await supabase.from("companies").select("legal_name").eq("tenant_id", ctx.tenantId).is("cnpj", null).in("legal_name", names);
          found.push(...(data ?? []).map((r) => r.legal_name as string));
        }
      } else {
        if (!industryId || !UUID_RE.test(industryId)) return { ok: false, message: "Selecione a indústria." };
        const { data } = await supabase
          .from("products")
          .select("sku")
          .eq("tenant_id", ctx.tenantId)
          .eq("industry_id", industryId)
          .in("sku", chunk);
        found.push(...(data ?? []).map((r) => r.sku as string));
      }
    }
    return { ok: true, existing: found };
  });
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
type Receita = Awaited<ReturnType<typeof lookupCnpjCached>>;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const channelKey = (c: { kind: string; value: string }) => `${c.kind === "email" ? "email" : "tel"}:${c.kind === "email" ? c.value.toLowerCase() : c.value.replace(/\D/g, "")}`;

function dbIssue(error: { code?: string; message?: string }): Issue {
  const message =
    error.code === "23505"
      ? "Já existe um cadastro com estes dados"
      : error.code === "23514"
        ? `Regra de validação: ${error.message ?? "dados inválidos"}`
        : error.code === "42501"
          ? "Sem permissão"
          : "Não foi possível gravar esta linha";
  return { field: "row", message, level: "error" };
}

async function importCompanies(supabase: Supabase, ctx: TenantContext, imp: ImportRecord, rows: RawRow[]): Promise<RowResult[]> {
  const opts = imp.options as { default_kind?: "customer" | "prospect"; enrich?: boolean; existing?: "fill" | "skip" };
  const enrich = opts.enrich !== false;
  const items = rows.map((r) => ({ ...normalizeCompanyRow(r, { enrich }), receita: null as Receita | null }));

  // Receita (BrasilAPI ou consulta salva), poucas por vez para respeitar o limite da API.
  await mapLimit(
    items.filter((it) => enrich && it.data.cnpj && !hasError(it.issues)),
    4,
    async (it) => {
      it.receita = await lookupCnpjCached(supabase, ctx, it.data.cnpj!);
      if (!it.receita.ok) {
        if (!it.data.legal_name) it.issues.push({ field: "cnpj", message: `Receita: ${it.receita.message} Informe a razão social.`, level: "error" });
        else it.issues.push({ field: "cnpj", message: `Receita: ${it.receita.message}`, level: "warning" });
      }
    },
  );

  // Municípios (por nome dentro da UF ou por código IBGE).
  const receitaOf = (it: (typeof items)[number]) => (it.receita?.ok ? it.receita.data : null);
  const stateOf = (it: (typeof items)[number]) => it.data.state_code ?? receitaOf(it)?.stateCode ?? null;
  const states = [...new Set(items.map(stateOf).filter((s): s is NonNullable<typeof s> => s != null))];
  const munByState = new Map<string, Map<string, number>>();
  const munById = new Map<number, string>();
  if (items.some((it) => it.data.municipality)) {
    const ibges = items.flatMap((it) => (it.data.municipality && "ibge" in it.data.municipality ? [it.data.municipality.ibge] : []));
    const [byName, byId] = await Promise.all([
      states.length ? supabase.from("ref_municipalities").select("ibge_code, state_code, name").in("state_code", states) : Promise.resolve({ data: [] }),
      ibges.length ? supabase.from("ref_municipalities").select("ibge_code, state_code").in("ibge_code", ibges) : Promise.resolve({ data: [] }),
    ]);
    for (const m of (byName.data ?? []) as { ibge_code: number; state_code: string; name: string }[]) {
      if (!munByState.has(m.state_code)) munByState.set(m.state_code, new Map());
      munByState.get(m.state_code)!.set(normalizeHeader(m.name), m.ibge_code);
    }
    for (const m of (byId.data ?? []) as { ibge_code: number; state_code: string }[]) munById.set(m.ibge_code, m.state_code);
  }

  // Cadastros existentes (CNPJ; sem CNPJ, a mesma razão social).
  const cnpjs = items.flatMap((it) => (it.data.cnpj ? [it.data.cnpj] : []));
  const names = items.flatMap((it) => (!it.data.cnpj && it.data.legal_name ? [it.data.legal_name] : []));
  const cols = "id, cnpj, legal_name, kind, trade_name, cnae, segment, state_code, municipality_id, website, notes, contact_channels, legal_basis";
  type Existing = {
    id: string; cnpj: string | null; legal_name: string; kind: string; trade_name: string | null; cnae: string | null;
    segment: string | null; state_code: string | null; municipality_id: number | null; website: string | null;
    notes: string | null; contact_channels: { kind: string; label: string; value: string; source: string }[]; legal_basis: string | null;
  };
  const existing: Existing[] = [];
  if (cnpjs.length) {
    const { data } = await supabase.from("companies").select(cols).eq("tenant_id", ctx.tenantId).in("cnpj", cnpjs);
    existing.push(...((data ?? []) as Existing[]));
  }
  if (names.length) {
    const { data } = await supabase.from("companies").select(cols).eq("tenant_id", ctx.tenantId).is("cnpj", null).in("legal_name", names);
    existing.push(...((data ?? []) as Existing[]));
  }
  const findExisting = (d: CompanyImportRow) =>
    d.cnpj ? existing.find((e) => e.cnpj === d.cnpj) : existing.find((e) => !e.cnpj && e.legal_name === d.legal_name);

  const results: RowResult[] = [];
  const contactTargets: { result: RowResult; companyId: string; contact: NonNullable<CompanyImportRow["contact"]> }[] = [];

  for (const it of items) {
    const result: RowResult = { row: it.data.row, status: "error", issues: it.issues };
    results.push(result);
    if (hasError(it.issues)) continue;
    const d = it.data;
    const r = receitaOf(it);

    const state = stateOf(it);
    let municipalityId: number | null = null;
    if (d.municipality && "ibge" in d.municipality) {
      const st = munById.get(d.municipality.ibge);
      if (!st) it.issues.push({ field: "municipality", message: "Código IBGE não encontrado", level: "warning" });
      else if (state && st !== state) it.issues.push({ field: "municipality", message: "Município de outra UF foi ignorado", level: "warning" });
      else municipalityId = d.municipality.ibge;
    } else if (d.municipality && "name" in d.municipality) {
      municipalityId = (state && munByState.get(state)?.get(normalizeHeader(d.municipality.name))) || null;
      if (!municipalityId) it.issues.push({ field: "municipality", message: state ? "Município não encontrado nesta UF" : "Município sem UF foi ignorado", level: "warning" });
    }
    if (!municipalityId && r?.municipalityId && r.stateCode === state) municipalityId = r.municipalityId;

    // Canais: os da planilha e, se faltarem, telefones/e-mail da Receita.
    const receitaDigits = new Set((r?.phones ?? []).map((p) => p.slice(-11)));
    const channels: { kind: CompanyChannel["kind"]; label: string; value: string; source: "receita" | "manual" }[] = d.channels.map((c) => ({
      ...c,
      source:
        (c.kind !== "email" && receitaDigits.has(c.value.replace(/\D/g, "").slice(-11))) ||
        (c.kind === "email" && r?.email?.toLowerCase() === c.value)
          ? "receita"
          : "manual",
    }));
    const seen = new Set(channels.map(channelKey));
    for (const p of r?.phones ?? []) {
      const c = { kind: "phone" as const, label: "Receita", value: p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`, source: "receita" as const };
      if (!seen.has(channelKey(c))) {
        channels.push(c);
        seen.add(channelKey(c));
      }
    }
    if (r?.email) {
      const c = { kind: "email" as const, label: "Receita", value: r.email.toLowerCase(), source: "receita" as const };
      if (!seen.has(channelKey(c))) {
        channels.push(c);
        seen.add(channelKey(c));
      }
    }

    const merged = {
      legal_name: d.legal_name ?? r?.legalName ?? null,
      trade_name: d.trade_name ?? r?.tradeName ?? null,
      cnae: d.cnae ?? r?.mainCnae ?? null,
      segment: d.segment,
      state_code: state,
      municipality_id: municipalityId,
      website: d.website,
      notes: d.notes,
    };
    if (!merged.legal_name) {
      result.issues.push({ field: "legal_name", message: "Sem razão social", level: "error" });
      continue;
    }

    const ex = findExisting(d);
    if (!ex) {
      const { data, error } = await supabase
        .from("companies")
        .insert({
          tenant_id: ctx.tenantId,
          kind: d.kind ?? opts.default_kind ?? "customer",
          cnpj: d.cnpj,
          ...merged,
          contact_channels: channels.slice(0, 50),
          source: imp.source,
          source_date: imp.source_date,
          legal_basis: imp.legal_basis,
          import_id: imp.id,
        })
        .select("id")
        .single();
      if (error || !data) {
        result.issues.push(dbIssue(error ?? {}));
        continue;
      }
      result.status = "created";
      existing.push({ ...merged, id: data.id as string, cnpj: d.cnpj, legal_name: merged.legal_name, kind: d.kind ?? "customer", contact_channels: channels, legal_basis: imp.legal_basis });
      if (d.contact) contactTargets.push({ result, companyId: data.id as string, contact: d.contact });
      continue;
    }

    if (opts.existing === "skip") {
      result.status = "unchanged";
      result.issues.push({ field: "row", message: "Já cadastrada: mantida como estava", level: "warning" });
      if (d.contact) contactTargets.push({ result, companyId: ex.id, contact: d.contact });
      continue;
    }

    // Completa só o que está vazio; nunca sobrescreve o que já foi cadastrado.
    const patch: Record<string, unknown> = {};
    for (const k of ["trade_name", "cnae", "segment", "website", "notes"] as const) {
      if (ex[k] == null && merged[k] != null) patch[k] = merged[k];
    }
    if (ex.state_code == null && merged.state_code) {
      patch.state_code = merged.state_code;
      patch.municipality_id = merged.municipality_id;
    } else if (ex.state_code === merged.state_code && ex.municipality_id == null && merged.municipality_id) {
      patch.municipality_id = merged.municipality_id;
    }
    if (ex.kind === "prospect" && d.kind === "customer") patch.kind = "customer";
    if (ex.legal_basis == null) patch.legal_basis = imp.legal_basis;
    const exKeys = new Set((ex.contact_channels ?? []).map(channelKey));
    const add = channels.filter((c) => !exKeys.has(channelKey(c)));
    if (add.length) patch.contact_channels = [...(ex.contact_channels ?? []), ...add].slice(0, 50);

    if (Object.keys(patch).length === 0) {
      result.status = "unchanged";
    } else {
      const { error } = await supabase
        .from("companies")
        .update({ ...patch, import_id: imp.id })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", ex.id);
      if (error) {
        result.issues.push(dbIssue(error));
        continue;
      }
      result.status = "updated";
    }
    if (d.contact) contactTargets.push({ result, companyId: ex.id, contact: d.contact });
  }

  // Contatos (pessoas): base legal, finalidade e origem do lote; sem duplicar por e-mail ou nome na empresa.
  if (contactTargets.length) {
    const emails = contactTargets.flatMap((t) => (t.contact.email ? [t.contact.email] : []));
    const companyIds = [...new Set(contactTargets.map((t) => t.companyId))];
    const [byEmail, byCompany] = await Promise.all([
      emails.length ? supabase.from("contacts").select("email").eq("tenant_id", ctx.tenantId).in("email", emails) : Promise.resolve({ data: [] }),
      supabase.from("contacts").select("company_id, name").eq("tenant_id", ctx.tenantId).in("company_id", companyIds),
    ]);
    const takenEmails = new Set(((byEmail.data ?? []) as { email: string }[]).map((r) => r.email.toLowerCase()));
    const takenNames = new Set(((byCompany.data ?? []) as { company_id: string; name: string }[]).map((r) => `${r.company_id}|${normalizeHeader(r.name)}`));
    for (const t of contactTargets) {
      const nameKey = `${t.companyId}|${normalizeHeader(t.contact.name)}`;
      if ((t.contact.email && takenEmails.has(t.contact.email)) || takenNames.has(nameKey)) {
        t.result.contact = "exists";
        continue;
      }
      const { error } = await supabase.from("contacts").insert({
        tenant_id: ctx.tenantId,
        company_id: t.companyId,
        name: t.contact.name,
        role_title: t.contact.role_title,
        email: t.contact.email,
        phone: t.contact.phone,
        legal_basis: imp.legal_basis,
        legal_basis_note: imp.legal_basis_note,
        purposes: imp.purposes,
        source: imp.source,
        source_date: imp.source_date,
        import_id: imp.id,
      });
      if (error) {
        t.result.issues.push({ field: "contact_name", message: "Contato não importado: " + dbIssue(error).message.toLowerCase(), level: "warning" });
        continue;
      }
      t.result.contact = "created";
      if (t.contact.email) takenEmails.add(t.contact.email);
      takenNames.add(nameKey);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Produtos e preços
// ---------------------------------------------------------------------------
async function importProducts(supabase: Supabase, ctx: TenantContext, imp: ImportRecord, rows: RawRow[]): Promise<RowResult[]> {
  const opts = imp.options as { catalog_version_id?: string | null; default_valid_until?: string | null; existing?: "update" | "skip" };
  if (!imp.industry_id) {
    return rows.map((r) => ({ row: r.row, status: "error" as const, issues: [{ field: "row", message: "Indústria removida", level: "error" as const }] }));
  }
  const today = commercialToday();
  const items = rows.map((r) => normalizeProductRow(r, { defaultValidUntil: opts.default_valid_until ?? null, today }));
  const skus = items.flatMap((it) => (it.data ? [it.data.sku] : []));
  type Existing = {
    id: string; sku: string; name: string; category: string | null; description: string | null; metadata: Record<string, unknown>;
    authorized_price: number | string | null; price_valid_until: string | null; price_source: string | null; price_reference: string | null;
    catalog_version_id: string | null;
  };
  const { data: exRows } = skus.length
    ? await supabase
        .from("products")
        .select("id, sku, name, category, description, metadata, authorized_price, price_valid_until, price_source, price_reference, catalog_version_id")
        .eq("tenant_id", ctx.tenantId)
        .eq("industry_id", imp.industry_id)
        .in("sku", skus)
    : { data: [] };
  const existing = new Map(((exRows ?? []) as Existing[]).map((e) => [e.sku, e]));

  const results: RowResult[] = [];
  for (const [i, it] of items.entries()) {
    const result: RowResult = { row: rows[i].row, status: "error", issues: it.issues };
    results.push(result);
    if (!it.data) continue;
    const d = it.data;
    const priceFields =
      d.price != null
        ? { authorized_price: d.price, price_valid_until: d.valid_until, price_source: imp.source, price_reference: imp.price_reference }
        : null;
    const ex = existing.get(d.sku);
    if (!ex) {
      const { data, error } = await supabase
        .from("products")
        .insert({
          tenant_id: ctx.tenantId,
          industry_id: imp.industry_id,
          catalog_version_id: opts.catalog_version_id ?? null,
          sku: d.sku,
          name: d.name,
          category: d.category,
          description: d.description,
          metadata: d.metadata,
          ...(priceFields ?? {}),
          import_id: imp.id,
        })
        .select("id")
        .single();
      if (error || !data) {
        result.issues.push(dbIssue(error ?? {}));
        continue;
      }
      result.status = "created";
      existing.set(d.sku, { id: data.id as string, sku: d.sku, name: d.name, category: d.category, description: d.description, metadata: d.metadata, authorized_price: d.price, price_valid_until: d.valid_until, price_source: priceFields?.price_source ?? null, price_reference: priceFields?.price_reference ?? null, catalog_version_id: opts.catalog_version_id ?? null });
      continue;
    }
    if (opts.existing === "skip") {
      result.status = "unchanged";
      result.issues.push({ field: "row", message: "Já cadastrado: mantido como estava", level: "warning" });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (d.name !== ex.name) patch.name = d.name;
    if (d.category != null && d.category !== ex.category) patch.category = d.category;
    if (d.description != null && d.description !== ex.description) patch.description = d.description;
    const meta = { ...(ex.metadata ?? {}), ...d.metadata };
    if (JSON.stringify(meta) !== JSON.stringify(ex.metadata ?? {})) patch.metadata = meta;
    if (opts.catalog_version_id && opts.catalog_version_id !== ex.catalog_version_id) patch.catalog_version_id = opts.catalog_version_id;
    if (
      priceFields &&
      (Number(ex.authorized_price) !== priceFields.authorized_price ||
        ex.authorized_price == null ||
        ex.price_valid_until !== priceFields.price_valid_until ||
        ex.price_source !== priceFields.price_source ||
        ex.price_reference !== priceFields.price_reference)
    ) {
      Object.assign(patch, priceFields);
    }
    if (Object.keys(patch).length === 0) {
      result.status = "unchanged";
      continue;
    }
    const { error } = await supabase
      .from("products")
      .update({ ...patch, import_id: imp.id })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", ex.id);
    if (error) {
      result.issues.push(dbIssue(error));
      continue;
    }
    result.status = "updated";
  }
  return results;
}
