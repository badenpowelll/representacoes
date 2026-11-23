import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_REASON_LABELS, PRODUCT_SYNC_STATUS_LABELS } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { ProductForm } from "./form";
import { toggleProduct } from "./actions";
import { ProductSourceForm } from "./fontes";
import { deleteProductSource, toggleProductSource } from "./fontes-actions";

export const metadata = { title: "Produtos · Rep360" };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (v: string) =>
  new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const data = (v: string) => new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const NOVIDADES_DIAS = 7;
/** Só links http(s) vindos do banco viram href (defesa extra contra javascript:). */
const safeHref = (v: string | null | undefined) => (v && /^https?:\/\//i.test(v) ? v : undefined);
type Doc = { kind: string; label: string; url: string };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const writable = can(ctx.role, "catalog.write");

  const since = new Date(Date.now() - NOVIDADES_DIAS * 864e5).toISOString();
  const [products, industries, versions, eligibility, sources, added, removed] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, sku, name, category, authorized_price, price_valid_until, active, inactive_reason, inactive_since, source_url, image_url, source_documents, source_seen_at, industries(name), catalog_versions(version, catalogs(title))",
      )
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
    supabase
      .from("product_sources")
      .select("id, url, label, active, last_run_at, last_status, last_message, last_found, industries(name)")
      .eq("tenant_id", tenantId)
      .order("created_at"),
    supabase
      .from("products")
      .select("id, name, source_url, source_first_seen_at, industries(name)")
      .eq("tenant_id", tenantId)
      .gte("source_first_seen_at", since)
      .order("source_first_seen_at", { ascending: false })
      .limit(100),
    supabase
      .from("products")
      .select("id, name, source_url, inactive_since, industries(name)")
      .eq("tenant_id", tenantId)
      .eq("inactive_reason", "removed_from_source")
      .gte("inactive_since", since)
      .order("inactive_since", { ascending: false })
      .limit(100),
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
    price_valid_until: string | null; active: boolean; inactive_reason: string | null; inactive_since: string | null;
    source_url: string | null; image_url: string | null; source_documents: Doc[] | null; source_seen_at: string | null;
    industries: { name: string } | null;
    catalog_versions: { version: number; catalogs: { title: string } | null } | null;
  };
  const rows = (products.data ?? []) as unknown as Row[];
  type V = { id: string; version: number; catalogs: { title: string; industries: { name: string } | null } | null };
  const versionOptions = ((versions.data ?? []) as unknown as V[]).map((cv) => ({
    id: cv.id,
    label: `${cv.catalogs?.title ?? "Catálogo"} v${cv.version} (${cv.catalogs?.industries?.name ?? "—"})`,
  }));

  type Source = {
    id: string; url: string; label: string | null; active: boolean; last_run_at: string | null;
    last_status: string | null; last_message: string | null; last_found: number | null; industries: { name: string } | null;
  };
  const sourceRows = (sources.data ?? []) as unknown as Source[];
  type Change = { id: string; name: string; source_url: string | null; source_first_seen_at?: string; inactive_since?: string; industries: { name: string } | null };
  const addedRows = (added.data ?? []) as unknown as Change[];
  const removedRows = (removed.data ?? []) as unknown as Change[];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Produtos</h1>

      {(addedRows.length > 0 || removedRows.length > 0) && (
        <section aria-labelledby="novidades" className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
          <h2 id="novidades" className="mb-1 font-medium">
            Novidades nos sites das indústrias (últimos {NOVIDADES_DIAS} dias)
          </h2>
          <p className="mb-3 text-sm text-neutral-600">Para avisar seus clientes: o que entrou e o que saiu da linha.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-green-800 dark:text-green-400">Entraram ({addedRows.length})</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {addedRows.map((p) => (
                  <li key={p.id}>
                    {safeHref(p.source_url) ? <a className="underline" href={safeHref(p.source_url)} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}
                    <span className="text-neutral-500"> · {p.industries?.name} · {p.source_first_seen_at && data(p.source_first_seen_at)}</span>
                  </li>
                ))}
                {addedRows.length === 0 && <li className="list-none text-neutral-500">Nenhum.</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-400">Saíram do site ({removedRows.length})</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {removedRows.map((p) => (
                  <li key={p.id}>
                    {p.name}
                    <span className="text-neutral-500"> · {p.industries?.name} · {p.inactive_since && data(p.inactive_since)}</span>
                  </li>
                ))}
                {removedRows.length === 0 && <li className="list-none text-neutral-500">Nenhum.</li>}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="sites" className="rounded-lg border p-4">
        <h2 id="sites" className="mb-1 font-medium">
          Sites das indústrias
        </h2>
        <p className="mb-4 text-sm text-neutral-600">
          Uma vez por dia (06h, horário de Brasília) o robô lê estas páginas: produto novo entra sem preço, com foto, link e fichas;
          produto que saiu do site fica inativo. Preço continua exigindo tabela e vigência.
        </p>
        {sources.error && <Alert kind="error">Não foi possível carregar os sites.</Alert>}
        {sourceRows.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2 text-sm">
            {sourceRows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
                <div>
                  <span className="font-medium">{s.industries?.name}</span>
                  {s.label && <span> · {s.label}</span>}
                  {!s.active && <span className="text-neutral-500"> · pausado</span>}
                  <a className="block break-all text-blue-700 underline dark:text-blue-400" href={safeHref(s.url)} target="_blank" rel="noopener noreferrer">
                    {s.url}
                  </a>
                  <span className={s.last_status && s.last_status !== "ok" ? "block text-red-700" : "block text-neutral-500"}>
                    {s.last_run_at
                      ? `${PRODUCT_SYNC_STATUS_LABELS[s.last_status ?? ""] ?? "Última coleta"} em ${dataHora(s.last_run_at)}${s.last_found != null ? ` · ${s.last_found} produtos no site` : ""}${s.last_message ? ` · ${s.last_message}` : ""}`
                      : "Aguardando a primeira coleta"}
                  </span>
                </div>
                {writable && (
                  <div className="flex gap-3">
                    <form action={toggleProductSource}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="source_id" value={s.id} />
                      <input type="hidden" name="active" value={String(!s.active)} />
                      <button className="underline">{s.active ? "Pausar" : "Retomar"}</button>
                    </form>
                    <form action={deleteProductSource}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="source_id" value={s.id} />
                      <button className="text-red-700 underline" aria-label={`Remover o site ${s.url}`}>Remover</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!sources.error && sourceRows.length === 0 && <p className="mb-4 text-sm text-neutral-500">Nenhum site cadastrado.</p>}
        {writable && (industries.data?.length ? (
          <ProductSourceForm tenantId={tenantId} industries={industries.data} />
        ) : (
          <p className="text-sm text-neutral-500">Cadastre uma indústria antes de cadastrar o site dela.</p>
        ))}
      </section>
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
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        {safeHref(p.image_url) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={safeHref(p.image_url)} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 rounded object-contain" />
                        )}
                        <div>
                          <span className="font-medium">{p.name}</span>
                          {safeHref(p.source_url) && (
                            <a className="block text-xs text-blue-700 underline dark:text-blue-400" href={safeHref(p.source_url)} target="_blank" rel="noopener noreferrer">
                              Ver no site da indústria
                            </a>
                          )}
                          {(p.source_documents ?? []).filter((d) => safeHref(d.url)).map((d) => (
                            <a key={d.url} className="mr-2 text-xs text-blue-700 underline dark:text-blue-400" href={safeHref(d.url)} target="_blank" rel="noopener noreferrer">
                              {d.kind === "outro" ? d.label : d.kind}
                            </a>
                          ))}
                          {p.source_seen_at && <span className="block text-xs text-neutral-500">Conferido no site em {data(p.source_seen_at)}</span>}
                        </div>
                      </div>
                    </td>
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
                      {p.active
                        ? "Ativo"
                        : p.inactive_reason === "removed_from_source"
                          ? `Inativo: saiu do site${p.inactive_since ? ` em ${data(p.inactive_since)}` : ""}`
                          : "Inativo"}
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
