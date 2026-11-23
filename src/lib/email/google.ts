import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth do Google (authorization code + PKCE + state) e envio pela API do Gmail.
 * Escopos mínimos: openid, email e gmail.send (só enviar; não lê a caixa).
 * Tokens de acesso não são guardados; o refresh token vai cifrado para o banco.
 *
 * Em testes locais, GOOGLE_API_BASE_URL pode apontar para um servidor simulado
 * em localhost (ignorado fora de APP_ENV=development).
 */
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];

type Endpoints = { auth: string; token: string; userinfo: string; send: string; revoke: string };

export function googleEndpoints(env: Record<string, string | undefined> = process.env): Endpoints {
  const o = env.GOOGLE_API_BASE_URL;
  if (o && (env.APP_ENV ?? "development") === "development" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o)) {
    const b = o.replace(/\/$/, "");
    return { auth: `${b}/o/oauth2/v2/auth`, token: `${b}/token`, userinfo: `${b}/userinfo`, send: `${b}/gmail/send`, revoke: `${b}/revoke` };
  }
  return {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    send: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    revoke: "https://oauth2.googleapis.com/revoke",
  };
}

export function googleConfig(env: Record<string, string | undefined> = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** "gmail" só quando o servidor foi configurado para envio real; senão, modo de teste. */
export function sendingMode(env: Record<string, string | undefined> = process.env): "gmail" | "sandbox" {
  return env.EMAIL_SENDING === "gmail" && googleConfig(env) ? "gmail" : "sandbox";
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  return { verifier, challenge, state };
}

export function authUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string; loginHint?: string }, ep = googleEndpoints()) {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) p.set("login_hint", opts.loginHint);
  return `${ep.auth}?${p.toString()}`;
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string) {
  const cfg = googleConfig();
  if (!cfg) throw new Error("Google OAuth não configurado");
  const r = await postForm(googleEndpoints().token, {
    code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code",
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  if (!r.ok) throw new Error(`troca do código falhou (${r.status})`);
  const scope = String(r.json.scope ?? "");
  if (!scope.includes("gmail.send")) throw new Error("permissão de envio não concedida");
  return { accessToken: String(r.json.access_token ?? ""), refreshToken: r.json.refresh_token ? String(r.json.refresh_token) : null };
}

export async function userEmail(accessToken: string): Promise<string> {
  const res = await fetch(googleEndpoints().userinfo, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as { email?: string; email_verified?: boolean };
  if (!res.ok || !j.email || j.email_verified === false) throw new Error("não foi possível confirmar o e-mail da conta Google");
  return j.email.toLowerCase();
}

export class GoogleAuthRevoked extends Error {}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const cfg = googleConfig();
  if (!cfg) throw new Error("Google OAuth não configurado");
  const r = await postForm(googleEndpoints().token, {
    refresh_token: refreshToken, grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  if (r.json.error === "invalid_grant") throw new GoogleAuthRevoked("acesso ao Gmail revogado; conecte de novo");
  if (!r.ok || !r.json.access_token) throw new Error(`renovação do acesso falhou (${r.status})`);
  return String(r.json.access_token);
}

export async function gmailSend(accessToken: string, raw: string): Promise<string> {
  const res = await fetch(googleEndpoints().send, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (res.status === 401) throw new GoogleAuthRevoked("acesso ao Gmail expirado; conecte de novo");
  if (!res.ok || !j.id) throw new Error(`Gmail recusou o envio (${res.status}${j.error?.message ? `: ${j.error.message}` : ""})`);
  return j.id;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await postForm(googleEndpoints().revoke, { token }).catch(() => undefined);
}
