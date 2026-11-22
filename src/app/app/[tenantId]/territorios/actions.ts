"use server";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formToObject, territorySchema } from "@/lib/validation/schemas";

export async function addTerritory(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) throw new AuthorizationError("Você não tem permissão para editar territórios.", 403);
    const parsed = territorySchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("territories").insert({ ...parsed.data, tenant_id: ctx.tenantId });
    if (error) {
      return withValues(
        error.code === "23514" && /munic/i.test(error.message ?? "")
          ? { fieldErrors: { municipality_id: "O município não pertence à UF escolhida." } }
          : { message: error.code === "23505" ? "Esta cobertura já está cadastrada." : dbErrorMessage(error) },
        form,
      );
    }
    revalidatePath(`/app/${ctx.tenantId}/territorios`);
    return { ok: true, nonce: Date.now(), message: "Cobertura adicionada." };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}

export async function removeTerritory(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("territories").delete().eq("id", String(form.get("territory_id") ?? "")).eq("tenant_id", ctx.tenantId);
  revalidatePath(`/app/${ctx.tenantId}/territorios`);
}
