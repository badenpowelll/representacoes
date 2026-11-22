"use server";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_BYTES = 50 * 1024 * 1024;

const schema = z.object({
  industry_id: z.uuid("Selecione a indústria"),
  title: z.string().trim().min(2, "Informe o título").max(300),
  category: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null),
});

function looksLikePdf(bytes: Uint8Array) {
  return bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

/**
 * Envia o PDF para o bucket privado sob "<tenant_id>/<catalog_id>/" usando a
 * sessão do usuário (as políticas de Storage valem) e registra a versão 1 em rascunho.
 */
export async function uploadCatalog(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "catalog.write")) throw new AuthorizationError("Você não tem permissão para enviar catálogos.", 403);
    const parsed = schema.safeParse({ industry_id: form.get("industry_id"), title: form.get("title"), category: form.get("category") ?? "" });
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return withValues({ fieldErrors: { file: "Selecione o arquivo PDF" } }, form);
    if (file.size > MAX_BYTES) return withValues({ fieldErrors: { file: "O arquivo deve ter no máximo 50 MB" } }, form);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) return withValues({ fieldErrors: { file: "O arquivo precisa ser um PDF" } }, form);

    const supabase = await createSupabaseServerClient();
    const { data: catalog, error: catErr } = await supabase
      .from("catalogs")
      .insert({ ...parsed.data, tenant_id: ctx.tenantId })
      .select("id")
      .single();
    if (catErr || !catalog) return withValues({ message: dbErrorMessage(catErr) }, form);

    // Nome do objeto nunca usa o nome enviado pelo usuário.
    const path = `${ctx.tenantId}/${catalog.id}/v1-${randomUUID()}.pdf`;
    const up = await supabase.storage.from("catalogs").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (up.error) {
      await supabase.from("catalogs").delete().eq("id", catalog.id);
      return withValues({ message: "Não foi possível enviar o arquivo." }, form);
    }
    const { error: verErr } = await supabase.from("catalog_versions").insert({
      tenant_id: ctx.tenantId,
      catalog_id: catalog.id,
      version: 1,
      storage_path: path,
      size_bytes: bytes.length,
      file_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (verErr) return withValues({ message: dbErrorMessage(verErr) }, form);
    revalidatePath(`/app/${ctx.tenantId}/catalogos`);
    return { ok: true, nonce: Date.now(), message: "Catálogo enviado como rascunho." };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}
