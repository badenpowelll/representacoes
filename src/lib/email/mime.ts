/**
 * Monta a mensagem MIME (texto puro, UTF-8) para a API do Gmail
 * (users.messages.send com "raw" em base64url). Funções puras.
 */

const HEADER_UNSAFE = /[\r\n]/;

function encodeHeaderWord(value: string): string {
  // RFC 2047: só codifica quando há caracteres fora do ASCII imprimível.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function assertSafe(name: string, value: string) {
  if (HEADER_UNSAFE.test(value)) throw new Error(`cabeçalho inválido: ${name}`);
}

export type MimeInput = { from: string; fromName?: string | null; to: string; subject: string; body: string; replyTo?: string | null };

export function buildMime({ from, fromName, to, subject, body, replyTo }: MimeInput): string {
  for (const [k, v] of Object.entries({ from, to, subject, fromName: fromName ?? "", replyTo: replyTo ?? "" })) assertSafe(k, v);
  if (!/^[^@\s<>",]+@[^@\s<>",]+\.[^@\s<>",]+$/.test(to)) throw new Error("destinatário inválido");
  const fromHeader = fromName ? `${encodeHeaderWord(fromName.replace(/"/g, ""))} <${from}>` : from;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    // Quebra a base64 em linhas de 76 caracteres (RFC 2045).
    ...(Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").match(/.{1,76}/g) ?? [""]),
  ];
  return lines.join("\r\n");
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
