import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth do Google (authorization code + PKCE + state) e envio pela API do Gmail.
 * Escopos: openid, email, gmail.send (enviar) e gmail.readonly (ler a caixa só
 * para achar respostas às conversas que o sistema iniciou; nada é apagado nem alterado).
 * Tokens de acesso não são guardados; o refresh token vai cifrado para o banco.
 *
 * Em testes locais, GOOGLE_API_BASE_URL pode apontar para um servidor simulado
 * em localhost (ignorado fora de APP_ENV=development).
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

type Endpoints = { auth: string; token: string; userinfo: string; send: string; revoke: string; gmail: string };

export function googleEndpoints(env: Record<string, string | undefined> = process.env): Endpoints {
  const o = env.GOOGLE_API_BASE_URL;
  if (o && (env.APP_ENV ?? "development") === "development" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o)) {
    const b = o.replace(/\/$/, "");
    return {
      auth: `${b}/o/oauth2/v2/auth`, token: `${b}/token`, userinfo: `${b}/userinfo`, send: `${b}/gmail/v1/users/me/messages/send`,
      revoke: `${b}/revoke`, gmail: `${b}/gmail/v1/users/me`,
    };
  }
  return {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    send: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    revoke: "https://oauth2.googleapis.com/revoke",
    gmail: "https://gmail.googleapis.com/gmail/v1/users/me",
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
  return {
    accessToken: String(r.json.access_token ?? ""),
    refreshToken: r.json.refresh_token ? String(r.json.refresh_token) : null,
    readsInbox: scope.includes("gmail.readonly"),
  };
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

export async function gmailSend(accessToken: string, raw: string, threadId?: string | null): Promise<{ id: string; threadId: string | null }> {
  const res = await fetch(googleEndpoints().send, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string } };
  if (res.status === 401) throw new GoogleAuthRevoked("acesso ao Gmail expirado; conecte de novo");
  if (!res.ok || !j.id) throw new Error(`Gmail recusou o envio (${res.status}${j.error?.message ? `: ${j.error.message}` : ""})`);
  return { id: j.id, threadId: j.threadId ?? null };
}

async function gmailGet<T>(accessToken: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${googleEndpoints().gmail}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new GoogleAuthRevoked("acesso ao Gmail expirado; conecte de novo");
  if (res.status === 404) throw new GmailNotFound(`não encontrado (${path.split("?")[0]})`);
  if (!res.ok) throw new Error(`Gmail recusou a leitura (${res.status})`);
  return (await res.json()) as T;
}

export class GmailNotFound extends Error {}

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart };

export const gmailProfile = (t: string) => gmailGet<{ emailAddress: string; historyId: string }>(t, "/profile");

/** Mensagens novas na caixa de entrada desde o último histórico lido (com paginação). */
export async function gmailNewInboxMessages(t: string, startHistoryId: string): Promise<{ ids: string[]; historyId: string }> {
  const ids = new Set<string>();
  let page: string | undefined;
  let historyId = startHistoryId;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", labelId: "INBOX", maxResults: "500" });
    if (page) q.set("pageToken", page);
    const r = await gmailGet<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId?: string; nextPageToken?: string }>(
      t, `/history?${q.toString()}`);
    for (const h of r.history ?? []) for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
    if (r.historyId) historyId = r.historyId;
    page = r.nextPageToken;
    if (!page) break;
  }
  return { ids: [...ids], historyId };
}

export const gmailMessage = (t: string, id: string) => gmailGet<GmailMessage>(t, `/messages/${encodeURIComponent(id)}?format=full`);

/** Pede ao Gmail para avisar o tópico do Pub/Sub quando a caixa mudar (vale 7 dias). */
export const gmailWatch = (t: string, topicName: string) =>
  gmailGet<{ historyId: string; expiration: string }>(t, "/watch", { method: "POST", body: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" } });

export async function revokeGoogleToken(token: string): Promise<void> {
  await postForm(googleEndpoints().revoke, { token }).catch(() => undefined);
}
