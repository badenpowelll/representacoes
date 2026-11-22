"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formToObject, productSchema } from "@/lib/validation/schemas";

export async function createProduct(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) throw new AuthorizationError("Você não tem permissão para cadastrar produtos.", 403);
    const parsed = productSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("products").insert({ ...parsed.data, tenant_id: ctx.tenantId });
    if (error) {
      const fieldErrors: Record<string, string> | undefined =
        error.code === "23505"
          ? { sku: "Já existe um produto com este SKU nesta indústria." }
          : error.code === "23514" && /indústria/i.test(error.message ?? "")
            ? { catalog_version_id: "Este catálogo é de outra indústria." }
            : undefined;
      return withValues(fieldErrors ? { fieldErrors } : { message: dbErrorMessage(error) }, form);
    }
    revalidatePath(`/app/${ctx.tenantId}/produtos`);
    return { ok: true, nonce: Date.now(), message: "Produto cadastrado." };
  } catch (e) {
    if (e instanceof AuthorizationError) return withValues({ message: e.message }, form);
    throw e;
  }
}

export async function toggleProduct(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("products")
    .update({ active: form.get("active") === "true" })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", String(form.get("product_id") ?? ""));
  revalidatePath(`/app/${ctx.tenantId}/produtos`);
}
