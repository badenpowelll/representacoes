"use server";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { storeCatalogUpload } from "@/lib/catalogs/upload";
import { NEW_INDUSTRY, withCatalogIndustry } from "@/lib/catalogs/industry";
import { industrySchema } from "@/lib/validation/schemas";

const MAX_BYTES = 50 * 1024 * 1024;

const schema = z.object({
  industry_id: z.union([z.uuid(), z.literal(NEW_INDUSTRY)], { error: "Selecione a indústria ou cadastre uma nova" }),
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
 * A indústria pode ser uma já cadastrada ou criada no mesmo envio
 * (industry_id = "nova"), com as mesmas regras do cadastro em Indústrias; se o
 * envio falhar, a indústria recém-criada é removida (ver withCatalogIndustry).
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

    const creatingIndustry = parsed.data.industry_id === NEW_INDUSTRY;
    const newIndustry = creatingIndustry
      ? industrySchema.safeParse({ name: form.get("new_industry_name") ?? "", cnpj: form.get("new_industry_cnpj") ?? "", segment: "", website: "" })
      : null;
    if (newIndustry && !newIndustry.success) {
      const fe = zodFieldErrors(newIndustry.error.issues);
      return withValues({ fieldErrors: { new_industry_name: fe.name, new_industry_cnpj: fe.cnpj } }, form);
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return withValues({ fieldErrors: { file: "Selecione o arquivo PDF" } }, form);
    if (file.size > MAX_BYTES) return withValues({ fieldErrors: { file: "O arquivo deve ter no máximo 50 MB" } }, form);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) return withValues({ fieldErrors: { file: "O arquivo precisa ser um PDF" } }, form);

    const supabase = await createSupabaseServerClient();
    const bucket = supabase.storage.from("catalogs");
    const storeCatalog = (industryId: string) =>
      storeCatalogUpload(ctx.tenantId, bytes, {
        insertCatalog: async () => {
          const { data, error } = await supabase
            .from("catalogs")
            .insert({ industry_id: industryId, title: parsed.data.title, category: parsed.data.category, tenant_id: ctx.tenantId })
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

    const outcome = await withCatalogIndustry(
      newIndustry ? { create: true } : { existingId: parsed.data.industry_id },
      {
        insertIndustry: async () => {
          const { data, error } = await supabase
            .from("industries")
            .insert({ ...newIndustry!.data!, tenant_id: ctx.tenantId })
            .select("id")
            .single();
          if (error?.code === "23505") return { error: "Já existe uma indústria com esse nome ou CNPJ. Selecione-a na lista." };
          return error || !data ? { error: dbErrorMessage(error) } : { id: data.id as string };
        },
        deleteIndustry: async (id) => {
          const { error } = await supabase.from("industries").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
          return { error: error?.message };
        },
        log: (event, data) => console.warn(JSON.stringify({ event, tenantId: ctx.tenantId, ...data })),
      },
      async (industryId) => {
        const r = await storeCatalog(industryId);
        return r.ok ? { ok: true as const, value: r.catalogId } : { ok: false as const, error: r.error };
      },
    );
    if (!outcome.ok) {
      if (outcome.stage === "industry") return withValues({ fieldErrors: { new_industry_name: outcome.error } }, form);
      return withValues({ message: outcome.error }, form);
    }
    revalidatePath(`/app/${ctx.tenantId}/catalogos`);
    if (outcome.created) revalidatePath(`/app/${ctx.tenantId}/industrias`);
    return {
      ok: true,
      nonce: Date.now(),
      message: outcome.created ? "Indústria cadastrada e catálogo enviado como rascunho." : "Catálogo enviado como rascunho.",
    };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}
