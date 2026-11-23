import "server-only";

/** Cookie temporário do fluxo OAuth (state + PKCE), httpOnly e de vida curta. */
export const OAUTH_COOKIE = "rep360_google_oauth";
export type OAuthCookie = { state: string; verifier: string; tenantId: string; userId: string };

export function readOAuthCookie(value: string | undefined): OAuthCookie | null {
  if (!value) return null;
  try {
    const v = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthCookie>;
    return v.state && v.verifier && v.tenantId && v.userId ? (v as OAuthCookie) : null;
  } catch {
    return null;
  }
}

export function writeOAuthCookie(v: OAuthCookie): string {
  return Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
}

export function appOrigin(req: Request): string {
  return (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}
