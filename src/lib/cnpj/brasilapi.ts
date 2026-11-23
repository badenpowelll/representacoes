import "server-only";
import { normalizeBrasilApiCnpj, type CnpjRegistryData } from "./registry";

export type LookupResult =
  | { ok: true; data: CnpjRegistryData; raw: unknown }
  | { ok: false; reason: "not_found" | "unavailable" | "rate_limited" | "invalid_response" };

const BRASILAPI_URL = "https://brasilapi.com.br/api/cnpj/v1/";

/**
 * Em testes locais (e2e), CNPJ_API_BASE_URL pode apontar para um servidor
 * simulado em localhost. Fora disso é ignorada: a API real é sempre a BrasilAPI.
 */
export function cnpjApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env.CNPJ_API_BASE_URL;
  if (!override || (env.APP_ENV ?? "development") !== "development") return BRASILAPI_URL;
  try {
    const u = new URL(override);
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return u.toString().replace(/\/?$/, "/");
  } catch {}
  return BRASILAPI_URL;
}
const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;

/**
 * Consulta a BrasilAPI (gratuita, sem chave). Só roda no servidor: o
 * navegador nunca fala com a API diretamente, e o CNPJ já chega validado.
 * Erros viram motivos genéricos; o corpo da resposta não é registrado em log.
 */
export async function fetchCnpjFromBrasilApi(cnpj: string, fetchImpl: typeof fetch = fetch): Promise<LookupResult> {
  if (!/^\d{14}$/.test(cnpj)) return { ok: false, reason: "not_found" };
  let res: Response;
  try {
    res = await fetchImpl(`${cnpjApiBaseUrl()}${cnpj}`, {
      headers: { Accept: "application/json", "User-Agent": "Rep360/0.1" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 404 || res.status === 400) return { ok: false, reason: "not_found" };
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  try {
    const text = await res.text();
    if (text.length > MAX_BYTES) return { ok: false, reason: "invalid_response" };
    const raw: unknown = JSON.parse(text);
    return { ok: true, data: normalizeBrasilApiCnpj(raw, cnpj), raw };
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
}

export const LOOKUP_ERROR_MESSAGES: Record<Exclude<LookupResult, { ok: true }>["reason"], string> = {
  not_found: "CNPJ não encontrado na base da Receita Federal.",
  unavailable: "A consulta de CNPJ está indisponível agora. Preencha manualmente ou tente de novo em instantes.",
  rate_limited: "Muitas consultas seguidas. Aguarde um minuto e tente de novo.",
  invalid_response: "A consulta de CNPJ devolveu uma resposta inesperada. Preencha manualmente.",
};
