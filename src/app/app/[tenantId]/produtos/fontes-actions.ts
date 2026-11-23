"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formToObject, productSourceSchema } from "@/lib/validation/schemas";

export async function createProductSource(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) throw new AuthorizationError("Você não tem permissão para cadastrar sites de produtos.", 403);
    const parsed = productSourceSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("product_sources").insert({ ...parsed.data, tenant_id: ctx.tenantId });
    if (error) {
      return withValues(
        error.code === "23505"
          ? { fieldErrors: { url: "Este endereço já está cadastrado para esta indústria." } }
          : { message: dbErrorMessage(error) },
        form,
      );
    }
    revalidatePath(`/app/${ctx.tenantId}/produtos`);
    return { ok: true, nonce: Date.now(), message: "Site cadastrado. A primeira coleta acontece na próxima execução do robô." };
  } catch (e) {
    if (e instanceof AuthorizationError) return withValues({ message: e.message }, form);
    throw e;
  }
}

export async function toggleProductSource(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("product_sources")
    .update({ active: form.get("active") === "true" })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", String(form.get("source_id") ?? ""));
  revalidatePath(`/app/${ctx.tenantId}/produtos`);
}

/** Remove o site; os produtos continuam cadastrados (perdem só o vínculo com a fonte). */
export async function deleteProductSource(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("product_sources")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", String(form.get("source_id") ?? ""));
  revalidatePath(`/app/${ctx.tenantId}/produtos`);
}
