import { z } from "zod";

/**
 * Site e canais de contato da indústria/empresa (telefone, WhatsApp, e-mail,
 * endereço...), com rótulo livre (Comercial, Licitações, Financeiro). Editáveis
 * pelo usuário; a origem ('receita' ou 'manual') é calculada no servidor
 * comparando com a última consulta à Receita salva para o CNPJ.
 */
export const CHANNEL_KINDS = ["phone", "whatsapp", "email", "address", "other"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  address: "Endereço",
  other: "Outro",
};
export const CHANNEL_LABEL_SUGGESTIONS = ["Comercial", "Vendas", "Licitações", "Financeiro", "Suporte", "Compras", "Geral"];

export type ContactInfoSource = "receita" | "manual";
export type ContactChannel = { kind: ChannelKind; label: string; value: string; source: ContactInfoSource };

const digits = (v: string) => v.replace(/\D/g, "");

const channelInput = z
  .object({
    kind: z.enum(CHANNEL_KINDS),
    label: z.string().trim().max(60).default(""),
    value: z.string().trim().max(300),
  })
  .superRefine((c, ctx) => {
    if (!c.value) return;
    if (c.kind === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.value))
      ctx.addIssue({ code: "custom", message: `E-mail inválido: ${c.value.slice(0, 60)}` });
    if ((c.kind === "phone" || c.kind === "whatsapp") && digits(c.value).length < 10)
      ctx.addIssue({ code: "custom", message: `Telefone sem DDD: ${c.value.slice(0, 40)}` });
  })
  .transform((c) => ({ ...c, value: c.kind === "email" ? c.value.toLowerCase() : c.value }));

/** Lista enviada pelo formulário como JSON no campo `contact_channels`. Linhas vazias são ignoradas. */
const channelsField = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    if (!raw) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      ctx.addIssue({ code: "custom", message: "Contatos inválidos" });
      return z.NEVER;
    }
  })
  .pipe(z.array(channelInput).max(50, "No máximo 50 contatos"))
  .transform((list) => list.filter((c) => c.value !== ""));

const websiteField = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => (!v ? null : /^https?:\/\//i.test(v) ? v : `https://${v}`))
  .refine((v) => v == null || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v), { message: "Site inválido" });

export const contactInfoSchema = z.object({ website: websiteField, contact_channels: channelsField });
export type ContactInfo = z.infer<typeof contactInfoSchema>;

type Receita = { phones: string[]; email: string | null } | null;

/** Marca a origem de cada canal e do site. */
export function withSources(info: ContactInfo, receita: Receita) {
  const fromReceita = (c: { kind: ChannelKind; value: string }) =>
    receita != null &&
    (((c.kind === "phone" || c.kind === "whatsapp") && receita.phones.includes(digits(c.value).slice(-11))) ||
      (c.kind === "email" && receita.email != null && receita.email.toLowerCase() === c.value.toLowerCase()));
  return {
    website: info.website,
    // A Receita não informa site.
    website_source: info.website == null ? null : ("manual" as const),
    contact_channels: info.contact_channels.map(
      (c): ContactChannel => ({ ...c, source: fromReceita(c) ? "receita" : "manual" }),
    ),
  };
}

export function parseChannels(v: unknown): ContactChannel[] {
  return Array.isArray(v) ? (v as ContactChannel[]).filter((c) => c && typeof c.value === "string") : [];
}

export const CONTACT_SOURCE_LABELS: Record<ContactInfoSource, string> = {
  receita: "da Receita",
  manual: "editado por você",
};
