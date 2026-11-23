import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { Importer } from "../../importar/importer";
import { ImportHistory } from "../../importar/history";

export const metadata = { title: "Importar tabela de preços · Rep360" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ industria?: string }>;
}) {
  const { tenantId } = await params;
  const { industria } = await searchParams;
  const ctx = await requireTenantPage(tenantId);
  const base = `/app/${tenantId}/produtos`;
  const supabase = await createSupabaseServerClient();
  const [industries, versions] = await Promise.all([
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabase
      .from("catalog_versions")
      .select("id, version, catalogs(title, industry_id)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  ]);
  type V = { id: string; version: number; catalogs: { title: string; industry_id: string } | null };
  const versionList = ((versions.data ?? []) as unknown as V[])
    .filter((v) => v.catalogs)
    .map((v) => ({ id: v.id, label: `${v.catalogs!.title} · v${v.version}`, industryId: v.catalogs!.industry_id }));
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href={base} className="text-sm underline">← Produtos</Link>
        <h1 className="text-2xl font-semibold">Importar catálogo e tabela de preços</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Envie a planilha de produtos da indústria. Produtos com o mesmo SKU são atualizados, não duplicados. Todo preço
          importado fica com origem, documento de referência e vigência, como no cadastro manual, e entra no histórico de preços.
        </p>
      </div>
      {!can(ctx.role, "catalog.write") ? (
        <Alert kind="info">Só administradores e gerentes importam produtos e preços.</Alert>
      ) : (industries.data ?? []).length === 0 ? (
        <EmptyState title="Cadastre uma indústria primeiro">
          <Link href={`/app/${tenantId}/industrias`} className="underline">Ir para Indústrias</Link>
        </EmptyState>
      ) : (
        <Importer tenantId={tenantId} kind="products" backHref={base} industries={industries.data ?? []} versions={versionList}
          initialIndustryId={(industries.data ?? []).some((i) => i.id === industria) ? industria : undefined} />
      )}
      <ImportHistory tenantId={tenantId} kind="products" />
    </div>
  );
}
