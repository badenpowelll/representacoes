import { CATALOG_TEMPLATES } from "@/lib/catalogos/envio";
import { type Channel, DEFAULT_TEMPLATES, OPT_OUT_LINE } from "@/lib/prospeccao/messages";

export type Purpose = "prospeccao" | "catalogo";
export type Template = { subject: string | null; body: string };
export type TenantTemplates = Record<Purpose, Record<Channel, Template>> & { signature: string | null };

export const SYSTEM_TEMPLATES: Record<Purpose, Record<Channel, Template>> = {
  prospeccao: DEFAULT_TEMPLATES,
  catalogo: CATALOG_TEMPLATES,
};

export const PURPOSE_LABELS: Record<Purpose, string> = { prospeccao: "Prospecção (primeiro contato)", catalogo: "Envio de catálogo" };

/** Padrão da representação por cima do padrão do sistema. */
export function mergeTemplates(
  rows: { purpose: string; channel: string; subject: string | null; body: string }[],
  signature: string | null,
): TenantTemplates {
  const out = {
    prospeccao: { ...SYSTEM_TEMPLATES.prospeccao },
    catalogo: { ...SYSTEM_TEMPLATES.catalogo },
    signature: signature?.trim() || null,
  } as TenantTemplates;
  for (const r of rows) {
    if ((r.purpose === "prospeccao" || r.purpose === "catalogo") && (r.channel === "email" || r.channel === "whatsapp")) {
      out[r.purpose][r.channel] = { subject: r.channel === "email" ? r.subject : null, body: r.body };
    }
  }
  return out;
}

/** Acrescenta a assinatura do e-mail (se houver e ainda não estiver no texto), antes da linha de oposição. */
export function withSignature(body: string, signature: string | null): string {
  const sig = signature?.trim();
  if (!sig || body.includes(sig)) return body;
  const idx = body.lastIndexOf(OPT_OUT_LINE);
  if (idx >= 0) return `${body.slice(0, idx).trimEnd()}\n\n${sig}\n\n${body.slice(idx)}`;
  return `${body.trimEnd()}\n\n${sig}`;
}
