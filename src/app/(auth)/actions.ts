"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, withValues, zodFieldErrors } from "@/lib/action-state";
import { formToObject } from "@/lib/validation/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

const email = z.email("Informe um e-mail válido").trim().toLowerCase();
const password = z.string().min(10, "A senha precisa ter pelo menos 10 caracteres").max(72);

async function origin() {
  const h = await headers();
  return process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}


export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ email, password: z.string().min(1, "Informe a senha") }).safeParse(formToObject(form));
  if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return withValues(
      {
        message:
          error.code === "email_not_confirmed"
            ? "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada."
            : "E-mail ou senha incorretos.",
      },
      form,
    );
  }
  const next = safeNext(form.get("next"));
  // Quem já cadastrou segundo fator passa pelo desafio TOTP logo após a senha.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/app/seguranca?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Informe seu nome").max(200), email, password })
    .safeParse(formToObject(form));
  if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(form.get("next")))}`,
    },
  });
  // Mesma resposta para e-mail novo ou existente (não revela cadastros).
  if (error && error.code !== "user_already_exists") return { message: "Não foi possível criar a conta. Tente novamente." };
  return { ok: true, message: "Enviamos um link de confirmação para seu e-mail." };
}

export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ email }).safeParse(formToObject(form));
  if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/callback?next=/redefinir-senha`,
  });
  return { ok: true, message: "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha." };
}

export async function updatePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ password }).safeParse(formToObject(form));
  if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { message: "Não foi possível alterar a senha. Solicite um novo link." };
  redirect("/app");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}
