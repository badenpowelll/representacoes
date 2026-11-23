"use server";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { storeCatalogUpload } from "@/lib/catalogs/upload";

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
 * Falhas intermediárias são compensadas (ver storeCatalogUpload).
 *
 * Limitações conhecidas (antes de produção): o arquivo passa pela memória da
 * server action; migrar para upload resumível direto ao Storage com path
 * pré-autorizado, quarentena e validação assíncrona em parser isolado.
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
    const bucket = supabase.storage.from("catalogs");
    const result = await storeCatalogUpload(ctx.tenantId, bytes, {
      insertCatalog: async () => {
        const { data, error } = await supabase
          .from("catalogs")
          .insert({ ...parsed.data, tenant_id: ctx.tenantId })
          .select("id")
          .single();
        return error || !data ? { error: dbErrorMessage(error) } : { id: data.id as string };
      },
      deleteCatalog: async (id) => {
        const { error } = await supabase.from("catalogs").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
        return { error: error?.message };
      },
      // Nome do objeto nunca usa o nome enviado pelo usuário.
      putObject: async (path, data) => {
        const { error } = await bucket.upload(path, data, { contentType: "application/pdf", upsert: false });
        return { error: error ? "Não foi possível enviar o arquivo." : undefined };
      },
      removeObject: async (path) => {
        const { error } = await bucket.remove([path]);
        return { error: error?.message };
      },
      insertVersion: async (catalogId, path) => {
        const { error } = await supabase.from("catalog_versions").insert({
          tenant_id: ctx.tenantId,
          catalog_id: catalogId,
          version: 1,
          storage_path: path,
          size_bytes: bytes.length,
          file_sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        return { error: error ? dbErrorMessage(error) : undefined };
      },
      newId: randomUUID,
      log: (event, data) => console.warn(JSON.stringify({ event, ...data })),
    });
    if (!result.ok) return withValues({ message: result.error }, form);
    revalidatePath(`/app/${ctx.tenantId}/catalogos`);
    return { ok: true, nonce: Date.now(), message: "Catálogo enviado como rascunho." };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}

/** Publica a versão (só administrador/gerente). Publicada, ela pode ser enviada a clientes e não volta a rascunho. */
export async function publishCatalogVersion(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) return;
  const version = z.uuid().safeParse(form.get("version_id"));
  if (!version.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("catalog_versions")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", version.data)
    .in("status", ["draft", "processing"]);
  revalidatePath(`/app/${ctx.tenantId}/catalogos`);
}
