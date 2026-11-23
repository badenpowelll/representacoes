import Link from "next/link";
import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { DEFAULT_TEMPLATES } from "@/lib/prospeccao/messages";
import { ProspectTable, type ProspectRow } from "./table";
import type { Search } from "./page";

const PAGE_SIZE = 50;
const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

/**
 * Visão "todas as indústrias": cada empresa aparece uma vez, com todas as
 * indústrias representadas que podem vender para ela (CNAE-alvo + território).
 */
export async function MixView({
  tenantId,
  sp,
  header,
  industries,
  imports,
  canWrite,
  canIndustry,
  baseVars,
}: {
  tenantId: string;
  sp: Search;
  header: ReactNode;
  industries: { id: string; name: string; target_cnaes: string[] | null }[];
  imports: { dataset_ref: string; states: string[]; finished_at: string | null }[];
  canWrite: boolean;
  canIndustry: boolean;
  baseVars: { representacao: string; remetente: string };
}) {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number.parseInt(sp.pagina ?? "1", 10) || 1);
  const municipality = sp.municipio && /^\d{7}$/.test(sp.municipio) ? Number(sp.municipio) : null;

  const [{ data: territories }, search] = await Promise.all([
    supabase.from("territories").select("industry_id, state_code, municipality_id").eq("tenant_id", tenantId),
    supabase.rpc("prospect_search_mix", {
      p_tenant: tenantId,
      p_municipality: municipality,
      p_query: sp.q || null,
      p_with_email: sp.email === "1",
      p_with_phone: sp.telefone === "1",
      p_include_secondary: sp.secundario === "1",
      p_hide_in_portfolio: sp.ocultar === "1",
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
  ]);
  const states = [...new Set((territories ?? []).map((t) => t.state_code as string))].sort();
  const { data: municipalities } = states.length
    ? await supabase.from("ref_municipalities").select("ibge_code, name, state_code").in("state_code", states).order("name").limit(3000)
    : { data: [] };
  const wholeStates = new Set((territories ?? []).filter((t) => !t.municipality_id).map((t) => t.state_code as string));
  const restricted = new Set((territories ?? []).filter((t) => t.municipality_id).map((t) => t.municipality_id as number));
  const cityOptions = (municipalities ?? []).filter((m) => wholeStates.has(m.state_code) || restricted.has(m.ibge_code));

  const rows = (search.data ?? []) as (ProspectRow & { total_count: number })[];
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lastImport = imports.find((i) => states.some((s) => i.states.includes(s)));
  const withTerritory = new Set((territories ?? []).map((t) => t.industry_id as string));
  const incomplete = industries.filter((i) => !(i.target_cnaes?.length) || !withTerritory.has(i.id));
  const query = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, industria: "todas", ...over })) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      {header}

      <form className="flex flex-wrap items-end gap-3" aria-label="Escolher indústria">
        <div className="flex flex-col gap-1">
          <label htmlFor="industria" className="text-sm font-medium">Indústria</label>
          <select id="industria" name="industria" defaultValue="todas" className={sel}>
            <option value="todas">Todas as indústrias (mix por cliente)</option>
            {industries.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
        <button className="rounded-md border px-3 py-2">Ver empresas</button>
        {canIndustry && <Link href={`/app/${tenantId}/industrias`} className="text-sm underline">Gerenciar indústrias</Link>}
      </form>

      <section aria-labelledby="mix" className="rounded-lg border p-4 text-sm">
        <h2 id="mix" className="font-medium">Um cliente, várias indústrias</h2>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          Cada empresa aparece uma vez, com todas as indústrias que você representa e que podem vender para ela (atividade e
          território). Ao adicionar à carteira, o cliente fica ligado a cada uma delas, e você oferece o mix completo num só contato.
        </p>
        {incomplete.length > 0 && (
          <p className="mt-2 text-amber-800 dark:text-amber-200">
            Sem CNAEs ou sem território (não entram no mix): {incomplete.map((i) => i.name).join(", ")}. Escolha cada uma no seletor
            acima para completar o perfil.
          </p>
        )}
      </section>

      {lastImport ? (
        <p className="text-xs text-neutral-500">
          Fonte: Receita Federal, dados abertos do CNPJ, publicação {lastImport.dataset_ref}
          {lastImport.finished_at ? `; carregada em ${new Date(lastImport.finished_at).toLocaleDateString("pt-BR")}` : ""}. Só
          estabelecimentos com situação ativa.
        </p>
      ) : (
        <Alert kind="info">
          A base da Receita ainda não foi carregada para {states.join(", ") || "os seus estados"}. Assim que for carregada, as
          empresas aparecem aqui.
        </Alert>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-lg border p-3" aria-label="Filtros">
        <input type="hidden" name="industria" value="todas" />
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">Nome ou CNPJ</label>
          <input id="q" name="q" defaultValue={sp.q ?? ""} className={sel} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="municipio" className="text-sm font-medium">Cidade</label>
          <select id="municipio" name="municipio" defaultValue={sp.municipio ?? ""} className={sel}>
            <option value="">Todas</option>
            {cityOptions.map((m) => (
              <option key={m.ibge_code} value={m.ibge_code}>{m.name}/{m.state_code}</option>
            ))}
          </select>
        </div>
        {([
          ["email", "Com e-mail"],
          ["telefone", "Com telefone"],
          ["secundario", "Incluir CNAE secundário"],
          ["ocultar", "Ocultar já vinculados a todas"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-sm">
            <input type="checkbox" name={k} value="1" defaultChecked={sp[k] === "1"} /> {label}
          </label>
        ))}
        <button className="rounded-md border px-3 py-2">Filtrar</button>
      </form>

      {search.error && <Alert kind="error">Não foi possível buscar as empresas. Tente novamente.</Alert>}
      {!search.error && rows.length === 0 && (
        <EmptyState title="Nenhuma empresa encontrada">
          {lastImport ? "Confira os CNAEs e territórios das indústrias ou mude os filtros." : "A base da Receita ainda não foi carregada."}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <>
          <p className="text-sm" aria-live="polite">
            <strong>{total.toLocaleString("pt-BR")}</strong> empresa(s) encontradas · página {page} de {pages}
          </p>
          <ProspectTable
            key={`mix-${page}`}
            tenantId={tenantId}
            industryId={null}
            rows={rows}
            canWrite={canWrite}
            templates={DEFAULT_TEMPLATES}
            baseVars={baseVars}
          />
          <nav aria-label="Paginação" className="flex gap-4 text-sm">
            {page > 1 && <Link href={query({ pagina: String(page - 1) })} className="underline">Anterior</Link>}
            {page < pages && <Link href={query({ pagina: String(page + 1) })} className="underline">Próxima</Link>}
          </nav>
          <p className="text-xs text-neutral-500">
            No mix, o texto usa o modelo padrão e {"{{industria}}"} vira a lista das indústrias compatíveis com cada cliente. Os
            modelos por indústria são editados ao escolher a indústria no seletor.
          </p>
        </>
      )}
    </div>
  );
}
