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
