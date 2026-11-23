import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra o refresh token do Google com AES-256-GCM. A chave (32 bytes em base64)
 * fica só no servidor (EMAIL_TOKEN_KEY); o banco guarda "v1.iv.tag.cifra".
 */
function key(source = process.env.EMAIL_TOKEN_KEY): Buffer {
  const k = Buffer.from(source ?? "", "base64");
  if (k.length !== 32) throw new Error("EMAIL_TOKEN_KEY ausente ou inválida (32 bytes em base64)");
  return k;
}

export function encryptToken(plain: string, keySource?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keySource), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptToken(payload: string, keySource?: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("token cifrado em formato desconhecido");
  const decipher = createDecipheriv("aes-256-gcm", key(keySource), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function hasTokenKey(): boolean {
  return Buffer.from(process.env.EMAIL_TOKEN_KEY ?? "", "base64").length === 32;
}
