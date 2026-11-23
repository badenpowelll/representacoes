/**
 * Leitura de e-mails recebidos (funções puras). O conteúdo é dado NÃO
 * confiável: só é extraído como texto, nunca interpretado.
 */
import type { GmailMessage, GmailPart } from "./google";

export function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/** "Fulano <a@b.com>" -> "a@b.com" */
export function addressOf(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/<([^<>\s]+@[^<>\s]+)>/) ?? value.match(/([^\s<>",;]+@[^\s<>",;]+)/);
  return m ? m[1].toLowerCase() : null;
}

function decode(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Texto do e-mail: prefere text/plain; senão converte o HTML. Ignora anexos. */
export function bodyText(payload: GmailPart | undefined): string {
  let plain = "";
  let html = "";
  const walk = (p: GmailPart | undefined) => {
    if (!p || p.filename) return;
    if (p.mimeType === "text/plain" && !plain) plain = decode(p.body?.data);
    else if (p.mimeType === "text/html" && !html) html = decode(p.body?.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return (plain || htmlToText(html)).replace(/\r\n/g, "\n");
}

/** Só a parte nova: corta o texto citado ("Em ... escreveu:", "On ... wrote:", linhas com ">"). */
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const joined = `${l} ${lines[i + 1] ?? ""}`;
    if (/^\s*>/.test(l)) break;
    if (/^\s*(Em|On|Le|El)\b.{0,200}(escreveu|wrote|a écrit|escribió)\s*:\s*$/i.test(l)) break;
    if (/^\s*(Em|On)\b.{0,200}(escreveu|wrote)\s*:\s*$/i.test(joined) && i + 1 < lines.length) break;
    if (/^-{2,}\s*(Mensagem original|Original Message)/i.test(l)) break;
    if (/^\s*(De|From):\s.+@/i.test(l) && out.length > 0) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** O cliente pediu para sair: a resposta começa com SAIR / descadastrar / remover. */
export function isOptOut(text: string): boolean {
  const first = text.trim().split(/\n/)[0]?.trim().toLowerCase() ?? "";
  return /^(sair|descadastrar|remover|parar|stop|unsubscribe|não quero receber|nao quero receber)\b[\s.!]*$/.test(first);
}

/** E-mails automáticos (resposta de férias, aviso de entrega) não viram aviso. */
export function isAutomatic(msg: GmailMessage): boolean {
  const p = msg.payload;
  const auto = header(p, "Auto-Submitted");
  if (auto && auto.toLowerCase() !== "no") return true;
  if (header(p, "X-Autoreply") || header(p, "X-Autorespond")) return true;
  const prec = header(p, "Precedence")?.toLowerCase();
  if (prec && ["bulk", "junk", "list", "auto_reply"].includes(prec)) return true;
  const from = addressOf(header(p, "From")) ?? "";
  return /^(mailer-daemon|postmaster|no-?reply)@/i.test(from);
}

export type ParsedInbound = {
  gmailMessageId: string;
  threadId: string;
  rfcMessageId: string | null;
  references: string | null;
  from: string | null;
  subject: string | null;
  text: string;
  receivedAt: string;
  optOut: boolean;
  automatic: boolean;
};

export function parseInbound(msg: GmailMessage): ParsedInbound {
  const p = msg.payload;
  const text = stripQuoted(bodyText(p)).slice(0, 20000);
  return {
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    rfcMessageId: header(p, "Message-ID") ?? header(p, "Message-Id"),
    references: [header(p, "References"), header(p, "In-Reply-To")].filter(Boolean).join(" ") || null,
    from: addressOf(header(p, "From")),
    subject: header(p, "Subject"),
    text,
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
    optOut: isOptOut(text),
    automatic: isAutomatic(msg),
  };
}

/** Texto do aviso no Telegram (texto puro, sem formatação: o conteúdo é do cliente). */
export function telegramNotice(i: { company: string | null; from: string; subject: string | null; text: string; optedOut: boolean }): string {
  const body = i.text.length > 3000 ? `${i.text.slice(0, 3000)}…` : i.text || "(sem texto)";
  return [
    `📩 Resposta de ${i.company ?? i.from}`,
    `De: ${i.from}`,
    i.subject ? `Assunto: ${i.subject}` : null,
    "",
    body,
    "",
    i.optedOut
      ? "⛔ O cliente pediu para sair. A oposição já foi registrada e ele não recebe mais mensagens."
      : "↩️ Para responder por e-mail, toque em Responder nesta mensagem e escreva o texto.",
  ].filter((x) => x !== null).join("\n");
}
