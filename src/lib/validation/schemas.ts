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

export const CONTACT_PURPOSES = ["prospecting", "customer_relationship", "catalog_distribution", "support"] as const;
export type ContactPurpose = (typeof CONTACT_PURPOSES)[number];
export const CONTACT_PURPOSE_LABELS: Record<ContactPurpose, string> = {
  prospecting: "Prospecção comercial",
  customer_relationship: "Relacionamento com cliente",
  catalog_distribution: "Divulgação de catálogos",
  support: "Atendimento e pós-venda",
};

/** Motivos de inelegibilidade devolvidos por public.contact_eligibility. */
export const ELIGIBILITY_REASON_LABELS: Record<string, string> = {
  opted_out: "oposição registrada",
  no_email: "sem e-mail",
  suppressed: "e-mail ou domínio na lista de supressão",
  no_legal_basis: "sem base legal",
  purpose_not_allowed: "finalidade não autorizada",
  consent_missing: "consentimento sem evidência",
  channel_not_supported: "canal não suportado",
  unknown: "elegibilidade indeterminada",
};

/**
 * Contato de empresa (LGPD, parecer 004-complemento P1-4): sem base legal
 * padrão; finalidade e origem obrigatórias; legítimo interesse exige
 * justificativa; consentimento exige confirmação e evidência. O banco
 * (trigger contacts_lawful_basis) aplica as mesmas regras.
 */
export const contactSchema = z
  .object({
    company_id: z.uuid("Empresa inválida"),
    name: z.string().trim().min(1, "Informe o nome").max(200),
    role_title: optionalText(120),
    email: optionalText(254).refine((v) => v == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "E-mail inválido" }),
    phone: optionalText(40).refine((v) => v == null || /^[0-9()+\-\s]{8,40}$/.test(v), { message: "Telefone inválido" }),
    legal_basis: z.enum(LEGAL_BASES, { message: "Selecione a base legal" }),
    legal_basis_note: optionalText(2000),
    consent: z.string().nullish().transform((v) => v === "on"),
    consent_evidence: optionalText(1000),
    source: z.string().trim().min(2, "Informe a origem do dado (LGPD)").max(300),
    ...Object.fromEntries(CONTACT_PURPOSES.map((p) => [`purpose_${p}`, z.string().nullish()])),
  })
  .transform(({ ...v }) => {
    const raw = v as Record<string, unknown>;
    const purposes = CONTACT_PURPOSES.filter((p) => raw[`purpose_${p}`] === "on");
    for (const p of CONTACT_PURPOSES) delete raw[`purpose_${p}`];
    return { ...(raw as {
      company_id: string; name: string; role_title: string | null; email: string | null; phone: string | null;
      legal_basis: (typeof LEGAL_BASES)[number]; legal_basis_note: string | null; consent: boolean;
      consent_evidence: string | null; source: string;
    }), purposes };
  })
  .superRefine((c, ctx) => {
    if (c.purposes.length === 0) ctx.addIssue({ code: "custom", path: ["purposes"], message: "Escolha ao menos uma finalidade" });
    if (c.legal_basis === "legitimate_interest" && (c.legal_basis_note?.length ?? 0) < 20) {
      ctx.addIssue({ code: "custom", path: ["legal_basis_note"], message: "Explique o legítimo interesse (mín. 20 caracteres)" });
    }
    if ((c.legal_basis === "contract" || c.legal_basis === "legal_obligation") && (c.legal_basis_note?.length ?? 0) < 5) {
      ctx.addIssue({ code: "custom", path: ["legal_basis_note"], message: "Informe a referência do contrato ou da obrigação" });
    }
    if (c.legal_basis === "consent") {
      if (!c.consent) ctx.addIssue({ code: "custom", path: ["consent"], message: "Confirme que o contato deu consentimento" });
      if ((c.consent_evidence?.length ?? 0) < 5) {
        ctx.addIssue({ code: "custom", path: ["consent_evidence"], message: "Descreva como o consentimento foi obtido" });
      }
    }
  });

/** Valor monetário em formato brasileiro ("1.234,56"), opcional. */
export const optionalBrl = z
  .string()
  .nullish()
  .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
  .refine((v) => v == null || /^\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(v), { message: "Valor inválido (ex.: 1.234,56)" })
  .transform((v) => (v == null ? null : Number(v.replace(/\./g, "").replace(",", "."))));

/** Produto: preço somente quando autorizado pela indústria (o agente nunca inventa preço). */
/** "AAAA-MM-DD" que existe no calendário (recusa 31/02). */
export function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

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
      .refine((v) => v == null || isRealDate(v), {
        message: "Data inválida",
      }),
    price_source: optionalText(300),
    price_reference: optionalText(300),
  })
  .superRefine((p, ctx) => {
    if (p.price_valid_until != null && p.authorized_price == null) {
      ctx.addIssue({ code: "custom", path: ["price_valid_until"], message: "Informe o preço autorizado para definir a vigência" });
    }
    if (p.authorized_price != null) {
      if ((p.price_source?.length ?? 0) < 2) {
        ctx.addIssue({ code: "custom", path: ["price_source"], message: "Informe a origem do preço (ex.: tabela da indústria)" });
      }
      if ((p.price_reference?.length ?? 0) < 2) {
        ctx.addIssue({ code: "custom", path: ["price_reference"], message: "Informe a referência do documento" });
      }
    }
  })
  .transform((p) => (p.authorized_price == null ? { ...p, price_source: null, price_reference: null } : p));

/** Motivos de inelegibilidade devolvidos por public.product_eligibility. */
export const PRODUCT_REASON_LABELS: Record<string, string> = {
  inactive: "produto inativo",
  no_price: "sem preço autorizado",
  no_validity: "preço sem vigência",
  price_expired: "preço vencido",
  no_provenance: "preço sem procedência",
  unknown: "elegibilidade indeterminada",
};

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
