"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contactSchema, formToObject } from "@/lib/validation/schemas";

async function authorizeCrm(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "crm.write")) throw new AuthorizationError("Você não tem permissão para editar contatos.", 403);
  return ctx;
}

export async function createContact(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await authorizeCrm(form);
    const parsed = contactSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const { consent, ...data } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const now = new Date();
    const { error } = await supabase.from("contacts").insert({
      ...data,
      tenant_id: ctx.tenantId,
      email: data.email?.toLowerCase() ?? null,
      source_date: now.toISOString().slice(0, 10),
      consent_at: consent ? now.toISOString() : null,
    });
    if (error) {
      return withValues(
        error.code === "23505"
          ? { fieldErrors: { email: "Já existe um contato com este e-mail nesta representação." } }
          : { message: dbErrorMessage(error) },
        form,
      );
    }
    revalidatePath(`/app/${ctx.tenantId}/empresas/${data.company_id}`);
    return { ok: true, nonce: Date.now(), message: "Contato cadastrado." };
  } catch (e) {
    if (e instanceof AuthorizationError) return withValues({ message: e.message }, form);
    throw e;
  }
}

/** Oposição (opt-out): o banco inclui o e-mail na lista de supressão automaticamente. */
export async function optOutContact(form: FormData) {
  const ctx = await authorizeCrm(form);
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("contacts")
    .update({ opted_out_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", String(form.get("contact_id") ?? ""))
    .is("opted_out_at", null);
  revalidatePath(`/app/${ctx.tenantId}/empresas/${String(form.get("company_id") ?? "")}`);
}

/** Exclusão a pedido do titular. A supressão (se houver) é mantida para respeitar a oposição. */
export async function deleteContact(form: FormData) {
  const ctx = await authorizeCrm(form);
  const supabase = await createSupabaseServerClient();
  await supabase.from("contacts").delete().eq("tenant_id", ctx.tenantId).eq("id", String(form.get("contact_id") ?? ""));
  revalidatePath(`/app/${ctx.tenantId}/empresas/${String(form.get("company_id") ?? "")}`);
}
