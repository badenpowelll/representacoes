import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { encryptToken } from "@/lib/email/crypto";
import { exchangeCode, gmailProfile, gmailWatch, revokeGoogleToken, userEmail } from "@/lib/email/google";
import { OAUTH_COOKIE, appOrigin, readOAuthCookie } from "@/lib/email/oauth-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Retorno do Google: confere state, troca o código (PKCE) e guarda o refresh token cifrado. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = appOrigin(req);
  const jar = await cookies();
  const saved = readOAuthCookie(jar.get(OAUTH_COOKIE)?.value);
  const finish = (tenantId: string | null, q: string) => {
    const res = NextResponse.redirect(tenantId ? `${origin}/app/${tenantId}/mensagens?${q}` : `${origin}/app`, 303);
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/email/google", maxAge: 0 });
    return res;
  };
  const state = url.searchParams.get("state") ?? "";
  if (!saved || !state || !same(state, saved.state)) return finish(saved?.tenantId ?? null, "gmail=estado_invalido");
  if (url.searchParams.get("error")) return finish(saved.tenantId, "gmail=cancelado");
  const code = url.searchParams.get("code");
  if (!code) return finish(saved.tenantId, "gmail=falhou");

  let ctx;
  try {
    ctx = await requireTenantContext(saved.tenantId);
  } catch (e) {
    if (e instanceof AuthorizationError) return finish(null, "");
    throw e;
  }
  if (ctx.userId !== saved.userId) return finish(saved.tenantId, "gmail=estado_invalido");

  try {
    const tokens = await exchangeCode(code, saved.verifier, `${origin}/api/email/google/callback`);
    if (!tokens.refreshToken) return finish(saved.tenantId, "gmail=sem_refresh");
    const email = await userEmail(tokens.accessToken);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("email_connection_save", {
      p_tenant: ctx.tenantId,
      p_email: email,
      p_ciphertext: encryptToken(tokens.refreshToken),
    });
    if (error) {
      await revokeGoogleToken(tokens.refreshToken);
      return finish(saved.tenantId, "gmail=falhou");
    }
    // Com permissão de leitura, começa a vigiar respostas a partir de agora.
    if (tokens.readsInbox) {
      const profile = await gmailProfile(tokens.accessToken).catch(() => null);
      await supabase.rpc("email_connection_set_inbox", { p_tenant: ctx.tenantId, p_reads: true, p_history_id: profile?.historyId ?? null });
      const topic = process.env.GMAIL_PUBSUB_TOPIC;
      if (topic) await gmailWatch(tokens.accessToken, topic).catch(() => undefined);
    }
    return finish(saved.tenantId, "gmail=conectado");
  } catch {
    return finish(saved.tenantId, "gmail=falhou");
  }
}
