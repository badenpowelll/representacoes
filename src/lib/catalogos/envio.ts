/**
 * Envio de catálogo em lote (modo assistido): modelos e montagem da mensagem.
 * Funções puras. O link do catálogo é gerado no servidor no momento do envio.
 */
import { type Channel, renderTemplate, withOptOut } from "@/lib/prospeccao/messages";

export const LINK_DAYS = [7, 30, 90] as const;

export const CATALOG_VARIABLES = [
  { key: "empresa", label: "Nome da empresa" },
  { key: "cidade", label: "Cidade" },
  { key: "uf", label: "UF" },
  { key: "catalogo", label: "Título do catálogo" },
  { key: "industria", label: "Indústria do catálogo" },
  { key: "link_catalogo", label: "Link para baixar o PDF (obrigatório)" },
  { key: "representacao", label: "Sua representação" },
  { key: "remetente", label: "Seu nome" },
] as const;

export const CATALOG_TEMPLATES: Record<Channel, { subject: string | null; body: string }> = {
  email: {
    subject: "Catálogo {{catalogo}} ({{industria}})",
    body: [
      "Olá, equipe {{empresa}}.",
      "",
      "Segue o catálogo {{catalogo}} da {{industria}}, que representamos em {{uf}}:",
      "{{link_catalogo}}",
      "",
      "Fico à disposição para tirar dúvidas e enviar condições.",
      "",
      "Atenciosamente,",
      "{{remetente}}",
      "{{representacao}}",
    ].join("\n"),
  },
  whatsapp: {
    subject: null,
    body: "Olá, {{empresa}}! Aqui é {{remetente}}, da {{representacao}}. Segue o catálogo {{catalogo}} da {{industria}}: {{link_catalogo}}",
  },
};

/** Renderiza para pré-visualização, mantendo {{link_catalogo}} visível. */
export function previewMessage(text: string, vars: Record<string, string | null | undefined>): string {
  const clean = Object.fromEntries(Object.entries(vars).filter(([k, v]) => k !== "link_catalogo" && v)) as Record<string, string>;
  return renderTemplate(text, clean);
}

/** Mensagem final: insere o link (no fim, se o texto não tiver a variável) e a linha de oposição. */
export function finalMessage(text: string, link: string): string {
  const withLink = /\{\{\s*link_catalogo\s*\}\}/.test(text)
    ? text.replace(/\{\{\s*link_catalogo\s*\}\}/g, link)
    : `${text.trimEnd()}\n\n${link}`;
  return withOptOut(withLink);
}

export function linkExpiry(days: number, now = new Date()): Date {
  const d = LINK_DAYS.includes(days as (typeof LINK_DAYS)[number]) ? days : 30;
  return new Date(now.getTime() + d * 86_400_000);
}

export const BLOCK_REASONS: Record<string, string> = {
  opted_out: "pediu para não ser contatado",
  suppressed: "na lista de supressão",
  no_email: "sem e-mail",
  no_phone: "sem celular/telefone",
  no_contact: "sem contato cadastrado",
  no_legal_basis: "sem base legal",
  purpose_not_allowed: "finalidade não autorizada",
  consent_missing: "consentimento sem evidência",
  not_eligible: "não pode receber",
};
