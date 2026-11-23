import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import Link from "next/link";
import { CatalogUploadForm } from "./form";
import { publishCatalogVersion } from "./actions";

export const metadata = { title: "Catálogos · Rep360" };

const STATUS = { draft: "Rascunho", processing: "Processando", published: "Publicado", archived: "Arquivado" } as const;

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const [industries, catalogs] = await Promise.all([
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabase
      .from("catalogs")
      .select("id, title, category, industries(name), catalog_versions(id, version, status, storage_path, size_bytes, created_at)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  ]);
  type Version = { id: string; version: number; status: keyof typeof STATUS; storage_path: string; size_bytes: number | null };
  type Row = { id: string; title: string; category: string | null; industries: { name: string } | null; catalog_versions: Version[] };
  const rows = (catalogs.data ?? []) as unknown as Row[];

  // Links assinados de curta duração (5 min), gerados com a sessão do usuário (políticas de Storage valem).
  // Janela residual: um link já emitido continua válido até expirar, mesmo após revogar o acesso do usuário.
  const latestPaths = rows.map((r) => [...r.catalog_versions].sort((a, b) => b.version - a.version)[0]?.storage_path).filter(Boolean) as string[];
  const signed = latestPaths.length
    ? (await supabase.storage.from("catalogs").createSignedUrls(latestPaths, 300)).data ?? []
    : [];
  const urlFor = (path?: string) => signed.find((s) => s.path === path)?.signedUrl;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Catálogos</h1>
      {can(ctx.role, "catalog.write") && (
        <section aria-labelledby="novo-catalogo" className="rounded-lg border p-4">
          <h2 id="novo-catalogo" className="mb-4 font-medium">
            Novo catálogo
          </h2>
          {industries.data?.length ? (
            <CatalogUploadForm tenantId={tenantId} industries={industries.data} />
          ) : (
            <p className="text-sm text-neutral-500">Cadastre uma indústria antes de enviar catálogos.</p>
          )}
        </section>
      )}
      {catalogs.error && <Alert kind="error">Não foi possível carregar os catálogos.</Alert>}
      {!catalogs.error && rows.length === 0 && <EmptyState title="Nenhum catálogo enviado" />}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => {
            const latest = [...c.catalog_versions].sort((a, b) => b.version - a.version)[0];
            const url = urlFor(latest?.storage_path);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm">
                <span>
                  <span className="font-medium">{c.title}</span> · {c.industries?.name}
                  {c.category && ` · ${c.category}`}
                </span>
                <span className="flex items-center gap-3">
                  {latest && (
                    <span>
                      v{latest.version} · {STATUS[latest.status]}
                    </span>
                  )}
                  {url && (
                    <a href={url} className="underline" target="_blank" rel="noopener noreferrer">
                      Abrir PDF
                    </a>
                  )}
                  {latest && latest.status === "draft" && can(ctx.role, "catalog.write") && (
                    <form action={publishCatalogVersion}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="version_id" value={latest.id} />
                      <button className="rounded-md border px-3 py-1">Publicar</button>
                    </form>
                  )}
                  {latest && latest.status === "published" && can(ctx.role, "deals.write") && (
                    <Link href={`/app/${tenantId}/envios/novo?versao=${latest.id}`} className="rounded-md bg-blue-700 px-3 py-1 font-medium text-white">
                      Enviar para clientes
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
