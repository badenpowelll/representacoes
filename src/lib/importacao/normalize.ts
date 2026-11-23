import { isValidCnpj } from "@/lib/validation/cnpj";
import { isRealDate, UF_CODES } from "@/lib/validation/schemas";
import { normalizeHeader } from "./fields";

/**
 * Normalização de uma linha de planilha. É código puro, usado igual no
 * navegador (prévia) e no servidor (que revalida tudo antes de gravar): o
 * conteúdo da planilha é dado não confiável.
 */
export type Cell = string | number | boolean | null;
export type RawRow = { row: number; values: Record<string, Cell>; extra?: Record<string, Cell> };
export type Issue = { field: string; message: string; level: "error" | "warning" };

export type Uf = (typeof UF_CODES)[number];

const UF_NAMES: Record<string, Uf> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

export function text(v: Cell | undefined, max = 300): string | null {
  if (v == null || typeof v === "boolean") return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s.slice(0, max);
}

export function parseUf(v: Cell | undefined): Uf | null | "invalid" {
  const s = text(v);
  if (!s) return null;
  const up = s.toUpperCase();
  if ((UF_CODES as readonly string[]).includes(up)) return up as Uf;
  return UF_NAMES[normalizeHeader(s)] ?? "invalid";
}

/** CNPJ de célula numérica perde os zeros à esquerda no Excel: recompõe. */
export function parseCnpj(v: Cell | undefined): string | null | "invalid" {
  if (v == null || v === "") return null;
  const digits = typeof v === "number" ? String(Math.round(v)).padStart(14, "0") : String(v).replace(/\D/g, "");
  if (digits === "") return null;
  const d = digits.length < 14 && digits.length >= 12 ? digits.padStart(14, "0") : digits;
  return isValidCnpj(d) ? d : "invalid";
}

export function parseCnae(v: Cell | undefined): string | null | "invalid" {
  const s = text(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (d.length === 7) return d;
  if (d.length === 6 && typeof v === "number") return d.padStart(7, "0");
  return "invalid";
}

/**
 * Valor monetário: aceita número da célula ou texto brasileiro ("R$ 1.234,56",
 * "29,9") ou com ponto decimal ("29.90"). Nunca arredonda: mais de duas casas
 * é erro, para não alterar o preço autorizado pela indústria.
 */
export function parseMoney(v: Cell | undefined): number | null | "invalid" | "too_precise" {
  if (v == null || v === "" || typeof v === "boolean") return null;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    let s = v.replace(/r\$|\s/gi, "");
    if (s === "" || s === "-") return null;
    if (!/^-?[\d.,]+$/.test(s)) return "invalid";
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      const dec = lastComma > lastDot ? "," : ".";
      const thou = dec === "," ? "." : ",";
      s = s.split(thou).join("").replace(dec, ".");
    } else if (lastComma >= 0) {
      if ((s.match(/,/g) ?? []).length > 1) return "invalid";
      s = s.replace(",", ".");
    } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "");
    } else if ((s.match(/\./g) ?? []).length > 1) {
      return "invalid";
    }
    n = Number(s);
  }
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return "invalid";
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return "too_precise";
  return Math.round(n * 100) / 100;
}

/** Data: "31/12/2026", "31/12/26", "2026-12-31" ou número de série do Excel. */
export function parseDate(v: Cell | undefined): string | null | "invalid" {
  if (v == null || v === "" || typeof v === "boolean") return null;
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 20000 || v > 80000) return "invalid";
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = v.trim();
  let iso: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) iso = `${m[1]}-${m[2]}-${m[3]}`;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return iso && isRealDate(iso) ? iso : "invalid";
}

export function parseKind(v: Cell | undefined): "customer" | "prospect" | null | "invalid" {
  const s = text(v);
  if (!s) return null;
  const n = normalizeHeader(s);
  if (["cliente", "clientes", "c", "customer", "ativo", "cliente ativo"].includes(n)) return "customer";
  if (["prospect", "prospecto", "prospeccao", "p", "lead", "potencial", "novo"].includes(n)) return "prospect";
  return "invalid";
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseEmail(v: Cell | undefined): string | null | "invalid" {
  const s = text(v, 254);
  if (!s) return null;
  const e = s.toLowerCase().replace(/^mailto:/, "");
  return EMAIL_RE.test(e) ? e : "invalid";
}

/** Uma célula pode ter vários telefones separados por "/", ";", "," ou quebra de linha. */
export function parsePhones(v: Cell | undefined): { phones: string[]; invalid: boolean } {
  if (v == null || v === "" || typeof v === "boolean") return { phones: [], invalid: false };
  const parts = String(typeof v === "number" ? Math.round(v) : v)
    .split(/[;/,|\n]+/)
    .map((p) => p.replace(/\D/g, "").replace(/^0(?=\d{10,11}$)/, "").replace(/^55(?=\d{10,11}$)/, ""))
    .filter((p) => p !== "");
  const phones = parts.filter((p) => p.length === 10 || p.length === 11);
  return { phones: [...new Set(phones)].slice(0, 10), invalid: phones.length < parts.length };
}

export function parseWebsite(v: Cell | undefined): string | null | "invalid" {
  const s = text(v);
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/i.test(url) && url.length <= 300 ? url : "invalid";
}

export function formatPhoneBr(p: string): string {
  return p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
export type CompanyChannel = { kind: "phone" | "whatsapp" | "email"; label: string; value: string };
export type CompanyImportRow = {
  row: number;
  cnpj: string | null;
  legal_name: string | null;
  trade_name: string | null;
  kind: "customer" | "prospect" | null;
  segment: string | null;
  cnae: string | null;
  state_code: Uf | null;
  municipality: { ibge: number } | { name: string } | null;
  website: string | null;
  channels: CompanyChannel[];
  notes: string | null;
  contact: { name: string; role_title: string | null; email: string | null; phone: string | null } | null;
};

export function normalizeCompanyRow(raw: RawRow, opts: { enrich: boolean }): { data: CompanyImportRow; issues: Issue[] } {
  const v = raw.values;
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ field, message, level: "error" });
  const warn = (field: string, message: string) => issues.push({ field, message, level: "warning" });

  const cnpjRaw = parseCnpj(v.cnpj);
  if (cnpjRaw === "invalid") err("cnpj", "CNPJ inválido (dígitos não conferem)");
  const cnpj = cnpjRaw === "invalid" ? null : cnpjRaw;

  const legal_name = text(v.legal_name);
  if (legal_name != null && legal_name.length < 2) err("legal_name", "Razão social muito curta");
  if (legal_name == null) {
    if (!cnpj) err("legal_name", cnpjRaw === "invalid" ? "Sem razão social e CNPJ inválido" : "Informe CNPJ ou razão social");
    else if (!opts.enrich) err("legal_name", "Sem razão social: ligue o preenchimento pela Receita ou informe a razão social");
  }

  const kind = parseKind(v.kind);
  if (kind === "invalid") err("kind", 'Tipo não reconhecido (use "cliente" ou "prospect")');

  const cnae = parseCnae(v.cnae);
  if (cnae === "invalid") err("cnae", "CNAE deve ter 7 dígitos");

  const uf = parseUf(v.state_code);
  if (uf === "invalid") err("state_code", "UF não reconhecida");

  let municipality: CompanyImportRow["municipality"] = null;
  const mun = text(v.municipality, 120);
  if (mun) {
    if (/^\d{7}$/.test(mun)) municipality = { ibge: Number(mun) };
    else if (/^\d+$/.test(mun)) err("municipality", "Código IBGE do município deve ter 7 dígitos");
    else municipality = { name: mun };
  }

  const website = parseWebsite(v.website);
  if (website === "invalid") err("website", "Site inválido");

  const channels: CompanyChannel[] = [];
  for (const [field, kindCh] of [["phone", "phone"], ["whatsapp", "whatsapp"]] as const) {
    const p = parsePhones(v[field]);
    if (p.invalid) warn(field, "Telefone sem DDD ou incompleto foi ignorado");
    for (const ph of p.phones) channels.push({ kind: kindCh, label: "", value: formatPhoneBr(ph) });
  }
  const email = parseEmail(v.email);
  if (email === "invalid") err("email", "E-mail da empresa inválido");
  else if (email) channels.push({ kind: "email", label: "", value: email });

  let contact: CompanyImportRow["contact"] = null;
  const contactName = text(v.contact_name, 200);
  const contactEmail = parseEmail(v.contact_email);
  const contactPhones = parsePhones(v.contact_phone);
  if (contactEmail === "invalid") err("contact_email", "E-mail do contato inválido");
  if (contactPhones.invalid) warn("contact_phone", "Telefone do contato sem DDD foi ignorado");
  if (contactName) {
    contact = {
      name: contactName,
      role_title: text(v.contact_role, 120),
      email: contactEmail === "invalid" ? null : contactEmail,
      phone: contactPhones.phones[0] ? formatPhoneBr(contactPhones.phones[0]) : null,
    };
  } else if ((contactEmail && contactEmail !== "invalid") || contactPhones.phones.length) {
    warn("contact_name", "Contato sem nome não foi importado");
  }

  return {
    data: {
      row: raw.row,
      cnpj,
      legal_name,
      trade_name: text(v.trade_name),
      kind: kind === "invalid" ? null : kind,
      segment: text(v.segment, 120),
      cnae: cnae === "invalid" ? null : cnae,
      state_code: uf === "invalid" ? null : uf,
      municipality,
      website: website === "invalid" ? null : website,
      channels,
      notes: text(v.notes, 8000),
      contact,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Produtos e preços
// ---------------------------------------------------------------------------
export type ProductImportRow = {
  row: number;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  price: number | null;
  valid_until: string | null;
  metadata: Record<string, string>;
};

export function normalizeProductRow(
  raw: RawRow,
  opts: { defaultValidUntil: string | null; today: string },
): { data: ProductImportRow | null; issues: Issue[] } {
  const v = raw.values;
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ field, message, level: "error" });
  const warn = (field: string, message: string) => issues.push({ field, message, level: "warning" });

  const skuCell = v.sku;
  const sku = typeof skuCell === "number" ? String(skuCell) : text(skuCell, 100);
  if (!sku) err("sku", "Sem código (SKU)");
  const name = text(v.name);
  if (!name) err("name", "Sem nome do produto");

  const price = parseMoney(v.price);
  if (price === "invalid") err("price", "Preço inválido");
  if (price === "too_precise") err("price", "Preço com mais de 2 casas decimais (não arredondamos preço autorizado)");

  const validRaw = parseDate(v.valid_until);
  if (validRaw === "invalid") err("valid_until", "Data de vigência inválida (use dd/mm/aaaa)");
  const priceOk = typeof price === "number" ? price : null;
  let valid_until = validRaw === "invalid" ? null : validRaw;
  if (priceOk != null && valid_until == null) valid_until = opts.defaultValidUntil;
  if (priceOk == null && valid_until != null && validRaw != null) {
    warn("valid_until", "Vigência sem preço foi ignorada");
    valid_until = null;
  }
  if (priceOk != null && valid_until == null) warn("valid_until", "Preço sem vigência: não será usado em envios até ter vigência");
  if (priceOk != null && valid_until != null && valid_until < opts.today) warn("valid_until", "Vigência já vencida");

  const metadata: Record<string, string> = {};
  const unit = text(v.unit, 60);
  if (unit) metadata.unidade = unit;
  const ean = typeof v.ean === "number" ? String(Math.round(v.ean)) : text(v.ean, 20);
  if (ean) {
    if (/^\d{8,14}$/.test(ean)) metadata.ean = ean;
    else warn("ean", "Código de barras inválido foi ignorado");
  }
  for (const [k, val] of Object.entries(raw.extra ?? {}).slice(0, 30)) {
    const key = text(k, 60);
    const t = typeof val === "number" ? String(val) : text(val, 500);
    if (key && t && !(key in metadata)) metadata[key] = t;
  }

  if (!sku || !name || issues.some((i) => i.level === "error")) return { data: null, issues };
  return {
    data: {
      row: raw.row,
      sku,
      name,
      category: text(v.category, 120),
      description: text(v.description, 8000),
      price: priceOk,
      valid_until: priceOk == null ? null : valid_until,
      metadata,
    },
    issues,
  };
}

export const hasError = (issues: Issue[]) => issues.some((i) => i.level === "error");
