import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { renewWatches, syncAll } from "@/lib/email/inbox-sync";
import { safeEqual } from "@/lib/telegram/bot";

export const dynamic = "force-dynamic";

/**
 * Rotina diária (Vercel Cron): renova o aviso do Gmail (vale 7 dias) e lê as
 * caixas, para não perder resposta se algum aviso falhou.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secret || !safeEqual(auth, secret)) return NextResponse.json({ ok: false }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "sem chave de serviço" }, { status: 503 });
  const watches = await renewWatches(admin);
  const sync = await syncAll(admin);
  return NextResponse.json({ ok: true, watches, ...sync });
}
