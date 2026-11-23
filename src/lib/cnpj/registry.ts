import { z } from "zod";
import { UF_CODES } from "@/lib/validation/schemas";

/**
 * Normaliza a resposta de https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 * (dados abertos da Receita Federal). A resposta é tratada como dado não
 * confiável: tudo é validado, truncado e convertido para tipos conhecidos.
 */

const str = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? null : String(v).trim() || null));
const num = z.union([z.number(), z.string()]).nullish().transform((v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
});
const bool = z.boolean().nullish().transform((v) => v ?? null);

const partnerSchema = z
  .object({
    nome_socio: str,
    qualificacao_socio: str,
    cnpj_cpf_do_socio: str,
    faixa_etaria: str,
    data_entrada_sociedade: str,
    nome_representante_legal: str,
    qualificacao_representante_legal: str,
    pais: str,
  })
  .passthrough();

export const brasilApiCnpjSchema = z
  .object({
    cnpj: str,
    razao_social: z.string().trim().min(1),
    nome_fantasia: str,
    descricao_situacao_cadastral: str,
    data_situacao_cadastral: str,
    descricao_motivo_situacao_cadastral: str,
    data_inicio_atividade: str,
    natureza_juridica: str,
    porte: str,
    descricao_porte: str,
    capital_social: num,
    cnae_fiscal: str,
    cnae_fiscal_descricao: str,
    cnaes_secundarios: z
      .array(z.object({ codigo: str, descricao: str }).passthrough())
      .nullish()
      .transform((v) => v ?? []),
    descricao_tipo_de_logradouro: str,
    logradouro: str,
    numero: str,
    complemento: str,
    bairro: str,
    cep: str,
    municipio: str,
    uf: str,
    codigo_municipio_ibge: num,
    ddd_telefone_1: str,
    ddd_telefone_2: str,
    ddd_fax: str,
    email: str,
    opcao_pelo_simples: bool,
    opcao_pelo_mei: bool,
    identificador_matriz_filial: num,
    qsa: z
      .array(partnerSchema)
      .nullish()
      .transform((v) => v ?? []),
  })
  .passthrough();

export type CnpjPartner = {
  name: string;
  role: string | null;
  document: string | null;
  ageRange: string | null;
  since: string | null;
  legalRepresentative: string | null;
  legalRepresentativeRole: string | null;
  country: string | null;
};

export type CnpjAddress = {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
};

export type CnpjRegistryData = {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: string | null;
  statusDate: string | null;
  statusReason: string | null;
  openedOn: string | null;
  legalNature: string | null;
  companySize: string | null;
  shareCapital: number | null;
  mainCnae: string | null;
  mainCnaeDescription: string | null;
  secondaryCnaes: { code: string; description: string | null }[];
  address: CnpjAddress;
  stateCode: (typeof UF_CODES)[number] | null;
  municipalityId: number | null;
  phones: string[];
  email: string | null;
  partners: CnpjPartner[];
  simplesOptIn: boolean | null;
  meiOptIn: boolean | null;
  isHeadquarters: boolean | null;
};

/** Texto usado como origem do dado (LGPD) quando o cadastro vem da consulta. */
export const RECEITA_SOURCE = "Receita Federal (dados abertos) via BrasilAPI";

const cut = (v: string | null, max: number) => (v == null ? null : v.slice(0, max));
const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const cnae7 = (v: string | null) => {
  const d = v?.replace(/\D/g, "") ?? "";
  return d ? d.padStart(7, "0").slice(-7) : null;
};
/** Telefones vêm como "8432221234" (DDD + número); aceita 10 ou 11 dígitos. */
const phone = (v: string | null) => {
  const d = v?.replace(/\D/g, "") ?? "";
  return /^\d{10,11}$/.test(d) ? d : null;
};
const email = (v: string | null) => (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase().slice(0, 300) : null);

export function normalizeBrasilApiCnpj(input: unknown, requestedCnpj: string): CnpjRegistryData {
  const r = brasilApiCnpjSchema.parse(input);
  const uf = r.uf?.toUpperCase() ?? null;
  const stateCode = uf && (UF_CODES as readonly string[]).includes(uf) ? (uf as (typeof UF_CODES)[number]) : null;
  const ibge = r.codigo_municipio_ibge;
  const street = [r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(" ") || null;
  return {
    // Sempre o CNPJ pedido: nunca confiar no que a resposta diz ser.
    cnpj: requestedCnpj,
    legalName: cut(r.razao_social.trim(), 300)!,
    tradeName: cut(r.nome_fantasia, 300),
    registrationStatus: cut(r.descricao_situacao_cadastral, 60),
    statusDate: isoDate(r.data_situacao_cadastral),
    statusReason: cut(r.descricao_motivo_situacao_cadastral, 200),
    openedOn: isoDate(r.data_inicio_atividade),
    legalNature: cut(r.natureza_juridica, 200),
    companySize: cut(r.porte ?? r.descricao_porte, 60),
    shareCapital: r.capital_social,
    mainCnae: cnae7(r.cnae_fiscal),
    mainCnaeDescription: cut(r.cnae_fiscal_descricao, 300),
    secondaryCnaes: r.cnaes_secundarios
      .map((c) => ({ code: cnae7(c.codigo), description: cut(c.descricao, 300) }))
      .filter((c): c is { code: string; description: string | null } => c.code != null && c.code !== "0000000")
      .slice(0, 100),
    address: {
      street: cut(street, 300),
      number: cut(r.numero, 30),
      complement: cut(r.complemento, 200),
      district: cut(r.bairro, 120),
      zip: r.cep?.replace(/\D/g, "").slice(0, 8) || null,
      city: cut(r.municipio, 120),
      state: stateCode,
    },
    stateCode,
    municipalityId: ibge != null && Number.isInteger(ibge) && ibge >= 1000000 && ibge <= 9999999 ? ibge : null,
    phones: [...new Set([r.ddd_telefone_1, r.ddd_telefone_2].map(phone).filter((p): p is string => p != null))],
    email: email(r.email),
    partners: r.qsa
      .filter((p) => p.nome_socio)
      .slice(0, 200)
      .map((p) => ({
        name: cut(p.nome_socio, 300)!,
        role: cut(p.qualificacao_socio, 120),
        document: cut(p.cnpj_cpf_do_socio, 20),
        ageRange: cut(p.faixa_etaria, 60),
        since: isoDate(p.data_entrada_sociedade),
        legalRepresentative: cut(p.nome_representante_legal, 300),
        legalRepresentativeRole: cut(p.qualificacao_representante_legal, 120),
        country: cut(p.pais, 60),
      })),
    simplesOptIn: r.opcao_pelo_simples,
    meiOptIn: r.opcao_pelo_mei,
    isHeadquarters: r.identificador_matriz_filial == null ? null : r.identificador_matriz_filial === 1,
  };
}

/** Situações que merecem alerta antes de cadastrar/prospectar. */
export function isInactiveStatus(status: string | null): boolean {
  return status != null && !/^ATIVA$/i.test(status.trim());
}

export function formatPhone(p: string): string {
  return p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
}

export function formatAddress(a: CnpjAddress): string {
  const line1 = [a.street, a.number].filter(Boolean).join(", ");
  const zip = a.zip && a.zip.length === 8 ? `CEP ${a.zip.slice(0, 5)}-${a.zip.slice(5)}` : null;
  return [line1, a.complement, a.district, [a.city, a.state].filter(Boolean).join("/"), zip].filter(Boolean).join(" · ");
}

/** Linha do banco (public.cnpj_registry) a partir dos dados normalizados. */
export function toRegistryRow(d: CnpjRegistryData, raw: unknown) {
  return {
    cnpj: d.cnpj,
    legal_name: d.legalName,
    trade_name: d.tradeName,
    registration_status: d.registrationStatus,
    status_date: d.statusDate,
    status_reason: d.statusReason,
    opened_on: d.openedOn,
    legal_nature: d.legalNature,
    company_size: d.companySize,
    share_capital: d.shareCapital,
    main_cnae: d.mainCnae,
    main_cnae_description: d.mainCnaeDescription,
    secondary_cnaes: d.secondaryCnaes,
    address: d.address,
    state_code: d.stateCode,
    municipality_id: d.municipalityId,
    phones: d.phones,
    email: d.email,
    partners: d.partners,
    simples_opt_in: d.simplesOptIn,
    mei_opt_in: d.meiOptIn,
    is_headquarters: d.isHeadquarters,
    raw: raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {},
  };
}

/** Colunas lidas de public.cnpj_registry (sem o JSON bruto). */
export const REGISTRY_COLUMNS =
  "cnpj, legal_name, trade_name, registration_status, status_date, status_reason, opened_on, legal_nature, company_size, share_capital, main_cnae, main_cnae_description, secondary_cnaes, address, state_code, municipality_id, phones, email, partners, simples_opt_in, mei_opt_in, is_headquarters, fetched_at";

export type RegistryRow = ReturnType<typeof toRegistryRow> & { fetched_at: string };

/** Caminho inverso: linha do banco para o formato usado na tela. */
export function fromRegistryRow(row: RegistryRow): CnpjRegistryData & { fetchedAt: string } {
  return {
    cnpj: row.cnpj,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    registrationStatus: row.registration_status,
    statusDate: row.status_date,
    statusReason: row.status_reason,
    openedOn: row.opened_on,
    legalNature: row.legal_nature,
    companySize: row.company_size,
    shareCapital: row.share_capital == null ? null : Number(row.share_capital),
    mainCnae: row.main_cnae,
    mainCnaeDescription: row.main_cnae_description,
    secondaryCnaes: (row.secondary_cnaes ?? []) as CnpjRegistryData["secondaryCnaes"],
    address: (row.address ?? {}) as CnpjAddress,
    stateCode: row.state_code as CnpjRegistryData["stateCode"],
    municipalityId: row.municipality_id,
    phones: row.phones ?? [],
    email: row.email,
    partners: (row.partners ?? []) as CnpjPartner[],
    simplesOptIn: row.simples_opt_in,
    meiOptIn: row.mei_opt_in,
    isHeadquarters: row.is_headquarters,
    fetchedAt: row.fetched_at,
  };
}
