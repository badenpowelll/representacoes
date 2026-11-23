import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncAll } from "@/lib/email/inbox-sync";
import { safeEqual } from "@/lib/telegram/bot";

export const dynamic = "force-dynamic";

/**
 * Aviso do Gmail via Pub/Sub ("a caixa de fulano mudou"). O conteúdo do aviso não
 * é confiável: só serve para disparar a leitura da caixa daquela conta, que é
 * feita com o acesso guardado no servidor. Responde 204 para o Pub/Sub não repetir.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.GMAIL_PUSH_SECRET;
  if (!secret || !safeEqual(req.nextUrl.searchParams.get("token"), secret)) return new NextResponse(null, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin) return new NextResponse(null, { status: 204 });
  let email: string | null = null;
  try {
    const body = (await req.json()) as { message?: { data?: string } };
    const data = JSON.parse(Buffer.from(body.message?.data ?? "", "base64").toString("utf8")) as { emailAddress?: unknown };
    email = typeof data.emailAddress === "string" && /^[^@\s]+@[^@\s]+$/.test(data.emailAddress) ? data.emailAddress.toLowerCase() : null;
  } catch {
    email = null;
  }
  if (email) await syncAll(admin, email).catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
