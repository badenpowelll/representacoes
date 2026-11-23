import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { hasTokenKey } from "@/lib/email/crypto";
import { authUrl, googleConfig, newPkce } from "@/lib/email/google";
import { OAUTH_COOKIE, appOrigin, writeOAuthCookie } from "@/lib/email/oauth-cookie";

/** Inicia a conexão da conta Google Workspace do usuário (OAuth com PKCE e state). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant") ?? "";
  const origin = appOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/app/${encodeURIComponent(tenantId)}/mensagens?${q}`, 303);
  let ctx;
  try {
    ctx = await requireTenantContext(tenantId);
  } catch (e) {
    if (e instanceof AuthorizationError) return NextResponse.redirect(`${origin}/login`, 303);
    throw e;
  }
  if (!can(ctx.role, "crm.write")) return back("gmail=sem_permissao");
  const cfg = googleConfig();
  if (!cfg || !hasTokenKey()) return back("gmail=nao_configurado");
  const pkce = newPkce();
  const res = NextResponse.redirect(
    authUrl({ clientId: cfg.clientId, redirectUri: `${origin}/api/email/google/callback`, state: pkce.state, challenge: pkce.challenge }),
    303,
  );
  res.cookies.set(OAUTH_COOKIE, writeOAuthCookie({ state: pkce.state, verifier: pkce.verifier, tenantId: ctx.tenantId, userId: ctx.userId }), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/email/google",
    maxAge: 600,
  });
  return res;
}
