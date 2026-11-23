import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { type Channel } from "@/lib/prospeccao/messages";
import { loadTenantTemplates } from "@/lib/mensagens/load";
import { formatCnae } from "@/lib/prospeccao/presets";
import { CnaeForm, StartIndustryForm, TemplateForm, VariablesHelp } from "./forms";
import { ProspectTable, type ProspectRow } from "./table";
import { MixView } from "./mix-view";

export const metadata = { title: "Prospecção · Rep360" };

const PAGE_SIZE = 50;

export type Search = {
  industria?: string;
  q?: string;
  municipio?: string;
  email?: string;
  telefone?: string;
  secundario?: string;
  ocultar?: string;
  pagina?: string;
};

export default async function Page({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Search> }) {
  const { tenantId } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const canIndustry = can(ctx.role, "catalog.write");
  const canCrm = can(ctx.role, "crm.write");
  const canTemplates = can(ctx.role, "deals.write");

  const [{ data: industries }, { data: tenant }, { data: profile }, { data: imports }] = await Promise.all([
    supabase.from("industries").select("id, name, target_cnaes").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabase.from("tenants").select("name").eq("id", tenantId).single(),
    supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
    supabase.from("ref_cnpj_imports").select("dataset_ref, states, finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(20),
  ]);

  const header = (
    <div>
      <h1 className="text-2xl font-semibold">Prospecção automática</h1>
      <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
        Escolha a indústria e o sistema lista as empresas <strong>reais e ativas</strong> no Cadastro Nacional da Pessoa Jurídica
        (Receita Federal, dados abertos) que têm a atividade (CNAE) e ficam nos estados e municípios que você atende. Daqui você
        adiciona à carteira, edita os dados e abre o e-mail ou o WhatsApp com o texto pronto.
      </p>
    </div>
  );

  if (!industries?.length) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {canIndustry ? (
          <section aria-labelledby="comecar" className="rounded-lg border p-4">
            <h2 id="comecar" className="mb-4 font-medium">Comece pela indústria que você representa</h2>
            <StartIndustryForm tenantId={tenantId} />
          </section>
        ) : (
          <EmptyState title="Nenhuma indústria cadastrada">Peça a um administrador ou gerente para cadastrar a indústria.</EmptyState>
        )}
      </div>
    );
  }

  // Com mais de uma indústria, o padrão é a visão de mix (um cliente, várias indústrias).
  const mixMode = sp.industria === "todas" || (!sp.industria && industries.length > 1);
  if (mixMode) {
    return (
      <MixView tenantId={tenantId} sp={sp} header={header} industries={industries} imports={imports ?? []}
        canWrite={canCrm} canIndustry={canIndustry}
        baseVars={{ representacao: tenant?.name ?? "", remetente: profile?.full_name ?? "" }} />
    );
  }
  const industry = industries.find((i) => i.id === sp.industria) ?? industries[0];
  const cnaes = (industry.target_cnaes ?? []) as string[];
  const page = Math.max(1, Number.parseInt(sp.pagina ?? "1", 10) || 1);
  const municipality = sp.municipio && /^\d{7}$/.test(sp.municipio) ? Number(sp.municipio) : null;

  const [{ data: territories }, { data: cnaeRefs }, { data: templates }, search, tenantTemplates] = await Promise.all([
    supabase.from("territories").select("state_code, municipality_id").eq("tenant_id", tenantId).eq("industry_id", industry.id),
    cnaes.length ? supabase.from("ref_cnaes").select("code, description").in("code", cnaes) : Promise.resolve({ data: [] }),
    supabase.from("message_templates").select("channel, subject, body").eq("tenant_id", tenantId).eq("industry_id", industry.id),
    supabase.rpc("prospect_search", {
      p_tenant: tenantId,
      p_industry: industry.id,
      p_municipality: municipality,
      p_query: sp.q || null,
      p_with_email: sp.email === "1",
      p_with_phone: sp.telefone === "1",
      p_include_secondary: sp.secundario === "1",
      p_hide_in_portfolio: sp.ocultar === "1",
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    loadTenantTemplates(supabase, tenantId),
  ]);

  const states = [...new Set((territories ?? []).map((t) => t.state_code as string))].sort();
  const { data: municipalities } = states.length
    ? await supabase.from("ref_municipalities").select("ibge_code, name, state_code").in("state_code", states).order("name").limit(2000)
    : { data: [] };
  const restricted = new Set((territories ?? []).filter((t) => t.municipality_id).map((t) => t.municipality_id as number));
  const wholeStates = new Set((territories ?? []).filter((t) => !t.municipality_id).map((t) => t.state_code as string));
  const cityOptions = (municipalities ?? []).filter((m) => wholeStates.has(m.state_code) || restricted.has(m.ibge_code));

  const rows = ((search.data ?? []) as (ProspectRow & { total_count: number })[]);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lastImport = (imports ?? []).find((i) => states.some((s) => (i.states as string[]).includes(s)));
  const tpl = (channel: Channel) => {
    const saved = templates?.find((t) => t.channel === channel);
    return { subject: saved?.subject ?? tenantTemplates.prospeccao[channel].subject, body: saved?.body ?? tenantTemplates.prospeccao[channel].body, saved: Boolean(saved) };
  };
  const query = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, industria: industry.id, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };
  const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

  return (
    <div className="flex flex-col gap-6">
      {header}

      <form className="flex flex-wrap items-end gap-3" aria-label="Escolher indústria">
        <div className="flex flex-col gap-1">
          <label htmlFor="industria" className="text-sm font-medium">Indústria</label>
          <select id="industria" name="industria" defaultValue={industry.id} className={sel}>
            {industries.length > 1 && <option value="todas">Todas as indústrias (mix por cliente)</option>}
            {industries.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
        <button className="rounded-md border px-3 py-2">Ver empresas</button>
        {canIndustry && <Link href={`/app/${tenantId}/industrias`} className="text-sm underline">Gerenciar indústrias</Link>}
      </form>

      <section aria-labelledby="perfil" className="rounded-lg border p-4">
        <h2 id="perfil" className="font-medium">Quem é cliente de {industry.name}</h2>
        <div className="mt-2 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="font-medium">Atividades (CNAE)</p>
            {cnaes.length ? (
              <ul className="mt-1 list-disc pl-5 text-neutral-700 dark:text-neutral-300">
                {cnaes.map((c) => (
                  <li key={c}>
                    {formatCnae(c)} {cnaeRefs?.find((r) => r.code === c)?.description ?? ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-neutral-500">Nenhum CNAE definido ainda.</p>
            )}
          </div>
          <div>
            <p className="font-medium">Onde (territórios)</p>
            {states.length ? (
              <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                {states.map((s) => (wholeStates.has(s) ? `${s} (estado todo)` : `${s} (municípios selecionados)`)).join(", ")}
              </p>
            ) : (
              <p className="text-neutral-500">Nenhum território. Sem território, nenhuma empresa aparece.</p>
            )}
            <Link href={`/app/${tenantId}/territorios`} className="underline">Ajustar territórios</Link>
          </div>
        </div>
        {canIndustry && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm underline">Editar CNAEs</summary>
            <div className="mt-2">
              <CnaeForm key={cnaes.join(",")} tenantId={tenantId} industryId={industry.id} current={cnaes} />
            </div>
          </details>
        )}
      </section>

      {lastImport ? (
        <p className="text-xs text-neutral-500">
          Fonte: Receita Federal, dados abertos do CNPJ, publicação {lastImport.dataset_ref}; carregada em{" "}
          {new Date(lastImport.finished_at as string).toLocaleDateString("pt-BR")}. Só estabelecimentos com situação ativa.
        </p>
      ) : (
        <Alert kind="info">
          A base da Receita ainda não foi carregada para {states.join(", ") || "os seus estados"}. Ela é importada pelo
          administrador da plataforma (rotina gratuita, sem envio de dados seus). Assim que for carregada, as empresas aparecem aqui.
        </Alert>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-lg border p-3" aria-label="Filtros">
        <input type="hidden" name="industria" value={industry.id} />
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
          ["ocultar", "Ocultar já na carteira"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-sm">
            <input type="checkbox" name={k} value="1" defaultChecked={sp[k] === "1"} /> {label}
          </label>
        ))}
        <button className="rounded-md border px-3 py-2">Filtrar</button>
      </form>

      {search.error && <Alert kind="error">Não foi possível buscar as empresas. Tente novamente.</Alert>}
      {!search.error && !cnaes.length && <EmptyState title="Defina os CNAEs desta indústria para ver as empresas" />}
      {!search.error && cnaes.length > 0 && rows.length === 0 && (
        <EmptyState title="Nenhuma empresa encontrada com estes filtros">
          {lastImport ? "Tente incluir CNAE secundário ou outra cidade." : "A base da Receita ainda não foi carregada."}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <>
          <p className="text-sm" aria-live="polite">
            <strong>{total.toLocaleString("pt-BR")}</strong> empresa(s) encontradas · página {page} de {pages}
          </p>
          <ProspectTable
            key={`${industry.id}-${page}`}
            tenantId={tenantId}
            industryId={industry.id}
            rows={rows}
            canWrite={canCrm}
            templates={{ email: tpl("email"), whatsapp: tpl("whatsapp") }}
            baseVars={{ industria: industry.name, representacao: tenant?.name ?? "", remetente: profile?.full_name ?? "" }}
          />
          <nav aria-label="Paginação" className="flex gap-4 text-sm">
            {page > 1 && <Link href={query({ pagina: String(page - 1) })} className="underline">Anterior</Link>}
            {page < pages && <Link href={query({ pagina: String(page + 1) })} className="underline">Próxima</Link>}
          </nav>
        </>
      )}

      <section aria-labelledby="modelos" className="flex flex-col gap-4 rounded-lg border p-4">
        <div>
          <h2 id="modelos" className="font-medium">Textos de e-mail e WhatsApp para {industry.name}</h2>
          <p className="text-sm text-neutral-500">Usados como ponto de partida em cada contato; você ainda pode editar antes de enviar.</p>
        </div>
        <VariablesHelp />
        {canTemplates ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {(["email", "whatsapp"] as const).map((ch) => {
              const t = tpl(ch);
              return <TemplateForm key={`${industry.id}-${ch}`} tenantId={tenantId} industryId={industry.id} channel={ch} {...t} />;
            })}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Apenas administradores, gerentes e representantes editam os modelos.</p>
        )}
      </section>
    </div>
  );
}
