import { z } from "zod";
import { CONTACT_PURPOSES, isRealDate } from "@/lib/validation/schemas";

/** Limites do importador (arquivo e lote enviado ao servidor por vez). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const BATCH_SIZE = 25;

const fileFields = {
  file_name: z.string().trim().min(1).max(255),
  file_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullish().transform((v) => v ?? null),
  total_rows: z.number().int().min(1, "A planilha não tem linhas").max(MAX_ROWS, `No máximo ${MAX_ROWS} linhas por importação`),
};

const pastOrToday = z
  .string()
  .refine(isRealDate, "Data inválida")
  .refine((v) => v <= new Date().toISOString().slice(0, 10), "A data não pode ser futura");

/** Clientes (LGPD): origem, base legal e finalidade valem para o lote inteiro. */
export const companyImportOptionsSchema = z
  .object({
    ...fileFields,
    source: z.string().trim().min(2, "Informe a origem do dado (ex.: planilha de clientes da indústria X)").max(300),
    source_date: pastOrToday,
    default_kind: z.enum(["customer", "prospect"]).default("customer"),
    legal_basis: z.enum(["legitimate_interest", "contract"], { message: "Selecione a base legal" }),
    legal_basis_note: z.string().trim().max(2000).default(""),
    purposes: z.array(z.enum(CONTACT_PURPOSES)).min(1, "Escolha ao menos uma finalidade"),
    enrich: z.boolean().default(true),
    existing: z.enum(["fill", "skip"]).default("fill"),
  })
  .superRefine((o, ctx) => {
    if (o.legal_basis === "legitimate_interest" && o.legal_basis_note.length < 20) {
      ctx.addIssue({ code: "custom", path: ["legal_basis_note"], message: "Explique o legítimo interesse (mín. 20 caracteres)" });
    }
    if (o.legal_basis === "contract" && o.legal_basis_note.length < 5) {
      ctx.addIssue({ code: "custom", path: ["legal_basis_note"], message: "Informe o contrato (ex.: contrato de representação com a indústria X)" });
    }
  });
export type CompanyImportOptions = z.infer<typeof companyImportOptionsSchema>;

/** Preços seguem a regra do cadastro: origem, documento e vigência. */
export const productImportOptionsSchema = z.object({
  ...fileFields,
  industry_id: z.uuid("Selecione a indústria"),
  catalog_version_id: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .pipe(z.uuid("Versão inválida").nullable()),
  source: z.string().trim().min(2, "Informe a origem do preço (ex.: tabela de preços enviada pela indústria)").max(300),
  price_reference: z.string().trim().min(2, "Informe a referência do documento (ex.: Tabela nov/2026)").max(300),
  default_valid_until: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v == null || isRealDate(v), "Data inválida"),
  existing: z.enum(["update", "skip"]).default("update"),
});
export type ProductImportOptions = z.infer<typeof productImportOptionsSchema>;

const cell = z.union([z.string().max(10000), z.number(), z.boolean(), z.null()]);
export const rawRowsSchema = z
  .array(
    z.object({
      row: z.number().int().min(1).max(MAX_ROWS + 50),
      values: z.record(z.string().max(40), cell),
      extra: z.record(z.string().max(200), cell).optional(),
    }),
  )
  .min(1)
  .max(BATCH_SIZE);

export type ImportReportError = { row: number; column: string; message: string };
