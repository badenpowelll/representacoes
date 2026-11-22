import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_REASON_LABELS } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { ProductForm } from "./form";
import { toggleProduct } from "./actions";

export const metadata = { title: "Produtos · Rep360" };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const writable = can(ctx.role, "catalog.write");

  const [products, industries, versions, eligibility] = await Promise.all([
    supabase
      .from("products")
      .select("id, sku, name, category, authorized_price, price_valid_until, active, industries(name), catalog_versions(version, catalogs(title))")
      .eq("tenant_id", tenantId)
      .order("name")
      .limit(500),
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabase
      .from("catalog_versions")
      .select("id, version, catalogs(title, industries(name))")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    // Elegibilidade para comunicação calculada no banco (fonte única, data comercial do Brasil).
    supabase.rpc("product_eligibility", { p_tenant: tenantId }),
  ]);
  const eligibleById = new Map<string, { eligible: boolean; reason: string | null }>();
  if (!eligibility.error) {
    for (const r of (eligibility.data ?? []) as { product_id: string; eligible: boolean; reason: string | null }[]) {
      eligibleById.set(r.product_id, { eligible: r.eligible, reason: r.reason });
    }
  }
  const statusOf = (id: string) => eligibleById.get(id) ?? { eligible: false, reason: "unknown" };
  type Row = {
    id: string; sku: string; name: string; category: string | null; authorized_price: number | null;
    price_valid_until: string | null; active: boolean; industries: { name: string } | null;
    catalog_versions: { version: number; catalogs: { title: string } | null } | null;
  };
  const rows = (products.data ?? []) as unknown as Row[];
  type V = { id: string; version: number; catalogs: { title: string; industries: { name: string } | null } | null };
  const versionOptions = ((versions.data ?? []) as unknown as V[]).map((cv) => ({
    id: cv.id,
    label: `${cv.catalogs?.title ?? "Catálogo"} v${cv.version} (${cv.catalogs?.industries?.name ?? "—"})`,
  }));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Produtos</h1>
      {writable && (
        <section aria-labelledby="novo-produto" className="rounded-lg border p-4">
          <h2 id="novo-produto" className="mb-4 font-medium">
            Novo produto
          </h2>
          {industries.data?.length ? (
            <ProductForm tenantId={tenantId} industries={industries.data} versions={versionOptions} />
          ) : (
            <p className="text-sm text-neutral-500">Cadastre uma indústria antes de cadastrar produtos.</p>
          )}
        </section>
      )}
      {products.error && <Alert kind="error">Não foi possível carregar os produtos.</Alert>}
      {eligibility.error && (
        <Alert kind="error">Não foi possível verificar quais produtos podem ir em comunicações. Por segurança, nenhum está liberado.</Alert>
      )}
      {!products.error && rows.length === 0 && <EmptyState title="Nenhum produto cadastrado" />}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">SKU</th>
                <th className="py-2 pr-4">Produto</th>
                <th className="py-2 pr-4">Indústria</th>
                <th className="py-2 pr-4">Categoria</th>
                <th className="py-2 pr-4">Preço autorizado</th>
                <th className="py-2 pr-4">Catálogo</th>
                <th className="py-2 pr-4">Situação</th>
                {writable && <th className="py-2">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = statusOf(p.id);
                const expired = st.reason === "price_expired";
                return (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 pr-4 font-mono">{p.sku}</td>
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="py-2 pr-4">{p.industries?.name}</td>
                    <td className="py-2 pr-4">{p.category ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {p.authorized_price == null ? (
                        <span className="text-neutral-500">Sem preço autorizado</span>
                      ) : (
                        <>
                          {brl.format(Number(p.authorized_price))}
                          {p.price_valid_until && (
                            <span className={expired ? "block text-red-700" : "block text-neutral-500"}>
                              {expired ? "vencido em " : "até "}
                              {new Date(`${p.price_valid_until}T12:00:00`).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {p.catalog_versions ? `${p.catalog_versions.catalogs?.title ?? ""} v${p.catalog_versions.version}` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {p.active ? "Ativo" : "Inativo"}
                      <span className={st.eligible ? "block text-green-700" : "block text-neutral-500"}>
                        {st.eligible ? "Pode ir em comunicações" : `Fora de comunicações: ${PRODUCT_REASON_LABELS[st.reason ?? "unknown"] ?? st.reason}`}
                      </span>
                    </td>
                    {writable && (
                      <td className="py-2">
                        <form action={toggleProduct}>
                          <input type="hidden" name="tenant_id" value={tenantId} />
                          <input type="hidden" name="product_id" value={p.id} />
                          <input type="hidden" name="active" value={String(!p.active)} />
                          <button className="underline">{p.active ? "Desativar" : "Reativar"}</button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
