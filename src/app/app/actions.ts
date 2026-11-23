"use server";
import { redirect } from "next/navigation";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { createTenantSchema, formToObject } from "@/lib/validation/schemas";
import { requireUser } from "@/lib/auth/session";

export async function createTenant(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = createTenantSchema.safeParse(formToObject(form));
  if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_tenant", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) {
    return withValues(
      error.code === "23505" ? { fieldErrors: { slug: "Este identificador já está em uso." } } : { message: dbErrorMessage(error) },
      form,
    );
  }
  // Onboarding: o administrador cadastra o segundo fator antes de gerenciar a
  // representação, salvo se o ambiente dispensar (só teste; fail-closed).
  const { data: mfaRequired, error: mfaError } = await supabase.rpc("admin_mfa_required");
  if (!mfaError && mfaRequired === false) redirect(`/app/${data}`);
  redirect(`/app/seguranca?novo=1&next=${encodeURIComponent(`/app/${data}`)}`);
}
