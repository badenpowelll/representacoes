import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "./cnpj";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalCnpj = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : normalizeCnpj(v)))
  .nullable()
  .optional()
  .refine((v) => v == null || isValidCnpj(v), { message: "CNPJ inválido" });

export const UF_CODES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da representação").max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens")
    .max(63),
});

export const industrySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da indústria").max(200),
  cnpj: optionalCnpj,
  segment: optionalText(120),
  website: optionalText(300).refine((v) => v == null || /^https?:\/\//i.test(v), {
    message: "O site deve começar com http:// ou https://",
  }),
});

/** Código IBGE de município (7 dígitos) opcional, vindo de um <select>. */
export const optionalMunicipality = z
  .string()
  .nullish()
  .transform((v) => (v == null || v === "" ? null : v))
  .refine((v) => v == null || /^\d{7}$/.test(v), { message: "Município inválido" })
  .transform((v) => (v == null ? null : Number(v)));

/**
 * Cobertura territorial (parecer 004-complemento, P1-1): a abrangência é
 * escolhida de forma explícita. "UF inteira" não aceita município; "Um
 * município" exige município e que a lista da UF tenha sido carregada.
 */
export const territorySchema = z
  .object({
    industry_id: z.uuid("Selecione a indústria"),
    state_code: z.enum(UF_CODES, { message: "Selecione a UF" }),
    coverage: z.enum(["state", "municipality"], { message: "Escolha UF inteira ou um município" }),
    municipio_status: z.string().nullish(),
    municipality_id: optionalMunicipality,
    membership_id: z
      .string()
      .nullish()
      .transform((v) => v || null)
      .pipe(z.uuid().nullable()),
    exclusive: z.string().nullish().transform((v) => v === "on"),
  })
  .superRefine((v, ctx) => {
    if (v.coverage === "state" && v.municipality_id != null) {
      ctx.addIssue({ code: "custom", path: ["municipality_id"], message: "Cobertura da UF inteira não leva município." });
    }
    if (v.coverage === "municipality") {
      if (v.municipio_status !== "ready") {
        ctx.addIssue({
          code: "custom",
          path: ["municipality_id"],
          message: "A lista de municípios não carregou. Tente de novo antes de salvar.",
        });
      } else if (v.municipality_id == null) {
        ctx.addIssue({ code: "custom", path: ["municipality_id"], message: "Selecione o município." });
      }
    }
  })
  .transform((v) => ({
    industry_id: v.industry_id,
    state_code: v.state_code,
    municipality_id: v.municipality_id,
    membership_id: v.membership_id,
    exclusive: v.exclusive,
  }));

export const companySchema = z.object({
  legal_name: z.string().trim().min(2, "Informe a razão social").max(300),
  cnpj: optionalCnpj,
  cnae: optionalText(7).refine((v) => v == null || /^\d{7}$/.test(v), { message: "CNAE deve ter 7 dígitos" }),
  segment: optionalText(120),
  state_code: z.enum(UF_CODES).nullable().optional(),
  municipality_id: optionalMunicipality,
  kind: z.enum(["customer", "prospect"]).default("prospect"),
  source: z.string().trim().min(2, "Informe a origem do dado (LGPD)").max(300),
});

export const DEAL_STAGES = ["new", "qualified", "contact", "negotiation", "proposal", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  new: "Novo",
  qualified: "Qualificado",
  contact: "Contato",
  negotiation: "Negociação",
  proposal: "Proposta",
  won: "Ganho",
  lost: "Perdido",
};

export const dealSchema = z.object({
  title: z.string().trim().min(2, "Informe o título").max(300),
  company_id: z.uuid("Selecione a empresa"),
  amount: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(/\./g, "").replace(",", "."))))
    .refine((v) => v == null || (Number.isFinite(v) && v >= 0), { message: "Valor inválido" })
    .nullable()
    .optional(),
});

export const moveDealSchema = z
  .object({
    deal_id: z.uuid(),
    stage: z.enum(DEAL_STAGES),
    lost_reason: optionalText(500),
  })
  .refine((v) => v.stage !== "lost" || (v.lost_reason ?? "").length > 0, {
    message: "Informe o motivo da perda",
    path: ["lost_reason"],
  });

/** Converte FormData em objeto simples para validação. */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export const LEGAL_BASES = ["legitimate_interest", "consent", "contract", "legal_obligation"] as const;
export const LEGAL_BASIS_LABELS: Record<(typeof LEGAL_BASES)[number], string> = {
  legitimate_interest: "Legítimo interesse (B2B)",
  consent: "Consentimento",
  contract: "Execução de contrato",
  legal_obligation: "Obrigação legal",
};

/** Contato de empresa (LGPD: origem e base legal obrigatórias; consentimento quando for a base). */
export const contactSchema = z
  .object({
    company_id: z.uuid("Empresa inválida"),
    name: z.string().trim().min(1, "Informe o nome").max(200),
    role_title: optionalText(120),
    email: optionalText(254).refine((v) => v == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "E-mail inválido" }),
    phone: optionalText(40).refine((v) => v == null || /^[0-9()+\-\s]{8,40}$/.test(v), { message: "Telefone inválido" }),
    legal_basis: z.enum(LEGAL_BASES, { message: "Selecione a base legal" }),
    consent: z.string().optional().transform((v) => v === "on"),
    source: z.string().trim().min(2, "Informe a origem do dado (LGPD)").max(300),
  })
  .refine((c) => c.legal_basis !== "consent" || c.consent, {
    path: ["consent"],
    message: "Confirme que o contato deu consentimento",
  });

/** Valor monetário em formato brasileiro ("1.234,56"), opcional. */
export const optionalBrl = z
  .string()
  .nullish()
  .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
  .refine((v) => v == null || /^\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(v), { message: "Valor inválido (ex.: 1.234,56)" })
  .transform((v) => (v == null ? null : Number(v.replace(/\./g, "").replace(",", "."))));

/** Produto: preço somente quando autorizado pela indústria (o agente nunca inventa preço). */
export const productSchema = z
  .object({
    industry_id: z.uuid("Selecione a indústria"),
    sku: z.string().trim().min(1, "Informe o SKU").max(100),
    name: z.string().trim().min(1, "Informe o nome").max(300),
    category: optionalText(120),
    catalog_version_id: z
      .string()
      .nullish()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid("Versão inválida").nullable()),
    authorized_price: optionalBrl,
    price_valid_until: z
      .string()
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Data inválida" }),
  })
  .refine((p) => p.price_valid_until == null || p.authorized_price != null, {
    path: ["price_valid_until"],
    message: "Informe o preço autorizado para definir a vigência",
  });

/** Prospecção manual: fonte e data da fonte obrigatórias (não inventar empresas). */
export const prospectSchema = z.object({
  industry_id: z.uuid("Selecione a indústria"),
  legal_name: z.string().trim().min(2, "Informe a razão social").max(300),
  cnpj: optionalCnpj,
  cnae: optionalText(7).refine((v) => v == null || /^\d{7}$/.test(v), { message: "CNAE deve ter 7 dígitos" }),
  segment: optionalText(120),
  state_code: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.enum(UF_CODES).nullable()),
  municipality_id: optionalMunicipality,
  source: z.string().trim().min(2, "Informe a fonte (ex.: site da empresa, Receita Federal)").max(300),
  source_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data em que o dado foi obtido")
    .refine((v) => v <= new Date().toISOString().slice(0, 10), { message: "A data da fonte não pode ser futura" }),
});

export const LEAD_STATUS_LABELS = { new: "Novo", qualified: "Qualificado", discarded: "Descartado" } as const;
