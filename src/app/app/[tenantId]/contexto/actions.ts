"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formToObject } from "@/lib/validation/schemas";

const list = z
  .string()
  .trim()
  .transform((v) => (v ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : []));
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => v || null);

const contextSchema = z.object({
  segments: list,
  cnaes: list.pipe(z.array(z.string().regex(/^\d{7}$/, "Cada CNAE deve ter 7 dígitos, sem pontuação"))),
  ideal_customer: text(4000),
  differentiators: text(4000),
  restrictions: text(4000),
  communication_tone: text(1000),
  goals: text(4000),
});

export async function saveContext(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) throw new AuthorizationError("Você não tem permissão para editar o contexto.", 403);
    const raw = formToObject(form);
    const parsed = contextSchema.safeParse({ ...raw, cnaes: (raw.cnaes ?? "").replace(/[.\-/]/g, "") });
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("commercial_contexts")
      .upsert({ ...parsed.data, tenant_id: ctx.tenantId }, { onConflict: "tenant_id" });
    if (error) return withValues({ message: dbErrorMessage(error) }, form);
    revalidatePath(`/app/${ctx.tenantId}/contexto`);
    return withValues({ ok: true, message: "Contexto comercial salvo." }, form);
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}
