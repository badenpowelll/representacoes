"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, withValues } from "@/lib/action-state";
import { requireUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/safe-next";

export type EnrollState = ActionState & { factorId?: string; qrCode?: string; secret?: string };

const code = z.string().trim().regex(/^[0-9]{6}$/, "Informe os 6 dígitos do aplicativo autenticador");

/** Inicia o cadastro de um fator TOTP; descarta tentativas anteriores não concluídas. */
export async function startTotpEnroll(): Promise<EnrollState> {
  const { supabase } = await requireUser();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Autenticador ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return { message: "Não foi possível iniciar o cadastro do segundo fator. Tente novamente.", nonce: Date.now() };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, nonce: Date.now() };
}

/** Verifica o código TOTP (cadastro ou login); a sessão passa a AAL2. */
export async function verifyTotp(prev: EnrollState, form: FormData): Promise<EnrollState> {
  const parsed = code.safeParse(form.get("code"));
  const factorId = String(form.get("factorId") ?? "");
  if (!parsed.success) {
    return { ...prev, ...withValues({ fieldErrors: { code: parsed.error.issues[0].message } }, form) };
  }
  const { supabase } = await requireUser();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data });
  if (error) return { ...prev, fieldErrors: { code: "Código inválido ou expirado. Tente o código atual." }, nonce: Date.now() };
  redirect(safeNext(form.get("next")));
}
