/**
 * Mensagens de prospecção (e-mail e WhatsApp): variáveis, modelos padrão e
 * links de envio manual (mailto: e wa.me). Funções puras, sem I/O.
 *
 * Os dados que entram nas variáveis vêm da base pública (Receita) ou da
 * carteira do tenant; nunca de preços ou condições, que o modelo não inventa.
 */

export type Channel = "email" | "whatsapp";

export type TemplateVars = {
  empresa: string;
  nome_fantasia: string;
  cidade: string;
  uf: string;
  industria: string;
  representacao: string;
  remetente: string;
};

export const TEMPLATE_VARIABLES: { key: keyof TemplateVars; label: string }[] = [
  { key: "empresa", label: "Nome da empresa (fantasia ou razão social)" },
  { key: "nome_fantasia", label: "Nome fantasia" },
  { key: "cidade", label: "Cidade" },
  { key: "uf", label: "UF" },
  { key: "industria", label: "Indústria representada" },
  { key: "representacao", label: "Sua representação" },
  { key: "remetente", label: "Seu nome" },
];

export const OPT_OUT_LINE = "Se não quiser receber novos contatos nossos, basta responder SAIR.";

export const DEFAULT_TEMPLATES: Record<Channel, { subject: string | null; body: string }> = {
  email: {
    subject: "{{industria}} para {{empresa}}",
    body: [
      "Olá, equipe {{empresa}}.",
      "",
      "Sou {{remetente}}, da {{representacao}}, representante da {{industria}} em {{uf}}.",
      "Atendemos empresas do seu segmento em {{cidade}} e região e gostaria de apresentar nosso catálogo e condições.",
      "",
      "Posso enviar o catálogo ou agendar uma conversa rápida?",
      "",
      "Atenciosamente,",
      "{{remetente}}",
      "{{representacao}}",
    ].join("\n"),
  },
  whatsapp: {
    subject: null,
    body: "Olá! Aqui é {{remetente}}, da {{representacao}}, representante da {{industria}} em {{uf}}. Posso enviar nosso catálogo para a {{empresa}}?",
  },
};

/** Substitui {{variavel}}; variáveis desconhecidas ficam como estão para o usuário ver. */
export function renderTemplate(text: string, vars: Partial<TemplateVars>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v != null && v !== "" ? v : whole;
  });
}

/** Variáveis ainda não preenchidas (para avisar antes de enviar). */
export function unresolvedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
}

/** Garante a linha de oposição (LGPD) no fim da mensagem. */
export function withOptOut(body: string): string {
  return /\bSAIR\b/.test(body) ? body : `${body.trimEnd()}\n\n${OPT_OUT_LINE}`;
}

export function buildMailto(to: string, subject: string, body: string): string {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${q}`;
}

/** Telefone brasileiro (DDD + número) → link do WhatsApp com DDI 55. */
export function buildWhatsAppUrl(phone: string, text: string): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(text)}`;
}

/** Mesmo critério de app.normalize_phone no banco: devolve DDD + número ou null. */
export function normalizePhone(value: string | null | undefined): string | null {
  const d = (value ?? "").replace(/\D/g, "");
  if (/^0[1-9][0-9]{9,10}$/.test(d)) return d.slice(1);
  if (/^55[1-9][0-9]{9,10}$/.test(d)) return d.slice(2);
  if (/^[1-9][0-9]{9,10}$/.test(d)) return d;
  return null;
}

export function formatPhone(value: string): string {
  const d = normalizePhone(value);
  if (!d) return value;
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

/** Celular (9 dígitos após o DDD) é o que provavelmente tem WhatsApp. */
export function isMobile(value: string): boolean {
  const d = normalizePhone(value);
  return d != null && d.length === 11 && d[2] === "9";
}
