import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { loadTenantTemplates } from "@/lib/mensagens/load";
import { CATALOG_VARIABLES, LINK_DAYS, previewMessage } from "@/lib/catalogos/envio";
import { createCampaign } from "../actions";

export const metadata = { title: "Enviar catálogo · Rep360" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRORS: Record<string, string> = {
  clientes: "Escolha ao menos um cliente (no máximo 500 por lote).",
  dados: "Confira o nome do envio e a mensagem.",
  versao: "Só é possível enviar uma versão publicada do catálogo.",
  permissao: "Você não tem permissão para enviar catálogos.",
  falha: "Não foi possível montar o envio. Tente novamente.",
};
const input = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ versao?: string; canal?: string; todos?: string; uf?: string; erro?: string }>;
}) {
  const { tenantId } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(tenantId);
  if (!sp.versao || !UUID_RE.test(sp.versao)) notFound();
  const channel = sp.canal === "whatsapp" ? "whatsapp" : "email";
  const onlyIndustry = sp.todos !== "1";
  const supabase = await createSupabaseServerClient();

  const [{ data: version }, { data: tenant }, { data: profile }] = await Promise.all([
    supabase
      .from("catalog_versions")
      .select("id, version, status, catalogs(title, industry_id, industries(name))")
      .eq("tenant_id", tenantId)
      .eq("id", sp.versao)
      .maybeSingle(),
    supabase.from("tenants").select("name").eq("id", tenantId).single(),
    supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
  ]);
  type V = { id: string; version: number; status: string; catalogs: { title: string; industry_id: string; industries: { name: string } | null } | null };
  const v = version as unknown as V | null;
  if (!v?.catalogs) notFound();

  let companyQuery = supabase
    .from("companies")
    .select("id, legal_name, trade_name, kind, state_code, municipality_id, contacts(email, phone, opted_out_at)")
    .eq("tenant_id", tenantId)
    .order("legal_name")
    .limit(500);
  if (sp.uf && /^[A-Z]{2}$/.test(sp.uf)) companyQuery = companyQuery.eq("state_code", sp.uf);
  if (onlyIndustry) {
    const { data: leads } = await supabase.from("leads").select("company_id").eq("tenant_id", tenantId).eq("industry_id", v.catalogs.industry_id).limit(2000);
    companyQuery = companyQuery.in("id", [...new Set((leads ?? []).map((l) => l.company_id as string))]);
  }
  const { data: companiesData, error } = await companyQuery;
  type C = {
    id: string; legal_name: string; trade_name: string | null; kind: string; state_code: string | null;
    municipality_id: number | null;
    contacts: { email: string | null; phone: string | null; opted_out_at: string | null }[];
  };
  const companies = (companiesData ?? []) as unknown as C[];
  const cityIds = [...new Set(companies.map((c) => c.municipality_id).filter((x): x is number => x != null))];
  const { data: cities } = cityIds.length
    ? await supabase.from("ref_municipalities").select("ibge_code, name").in("ibge_code", cityIds)
    : { data: [] as { ibge_code: number; name: string }[] };
  const cityName = (c: C) => cities?.find((m) => m.ibge_code === c.municipality_id)?.name;
  const states = [...new Set(companies.map((c) => c.state_code).filter(Boolean))].sort() as string[];
  const tpl = (await loadTenantTemplates(supabase, tenantId)).catalogo[channel];
  const vars = {
    catalogo: v.catalogs.title,
    industria: v.catalogs.industries?.name ?? "",
    representacao: tenant?.name ?? "",
    remetente: profile?.full_name ?? "",
  };
  const first = companies[0];
  const preview = previewMessage(tpl.body, {
    ...vars,
    empresa: first ? (first.trade_name ?? first.legal_name) : "",
    cidade: first ? cityName(first) : undefined,
    uf: first?.state_code,
  });
  const reach = (c: C) => {
    const active = c.contacts.filter((x) => !x.opted_out_at);
    return channel === "email" ? active.some((x) => x.email) : active.some((x) => x.phone);
  };
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries({ versao: v.id, canal: channel, todos: sp.todos, uf: sp.uf, ...over })) if (val) p.set(k, val);
    return `?${p.toString()}`;
  };
  // Pré-preenche com o texto da empresa (as variáveis da empresa são trocadas por cliente na fila).
  const defaultBody = previewMessage(tpl.body, vars);
  const defaultSubject = tpl.subject ? previewMessage(tpl.subject, vars) : "";

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/app/${tenantId}/catalogos`} className="text-sm underline">← Catálogos</Link>
      <h1 className="text-2xl font-semibold">Enviar catálogo para vários clientes</h1>
      <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
        <strong>{v.catalogs.title}</strong> (v{v.version}) · {v.catalogs.industries?.name}. O sistema monta a fila com a mensagem de cada
        cliente; você abre cada envio no seu e-mail ou WhatsApp com um clique. Só entram contatos com base legal, finalidade autorizada e
        sem oposição; quem não pode receber aparece como bloqueado, com o motivo.
      </p>
      {v.status !== "published" && <Alert kind="error">Esta versão ainda não foi publicada. Publique em Catálogos antes de enviar.</Alert>}
      {sp.erro && ERRORS[sp.erro] && <Alert kind="error">{ERRORS[sp.erro]}</Alert>}

      <nav aria-label="Canal" className="flex gap-2">
        {(["email", "whatsapp"] as const).map((ch) => (
          <Link
            key={ch}
            href={link({ canal: ch })}
            aria-current={ch === channel ? "page" : undefined}
            className={`rounded-md border px-3 py-2 text-sm ${ch === channel ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}
          >
            {ch === "email" ? "E-mail" : "WhatsApp"}
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border p-3 text-sm" aria-label="Filtrar clientes">
        <input type="hidden" name="versao" value={v.id} />
        <input type="hidden" name="canal" value={channel} />
        <label className="flex items-center gap-1">
          <input type="checkbox" name="todos" value="1" defaultChecked={!onlyIndustry} /> Incluir clientes de outras indústrias
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor="uf" className="font-medium">UF</label>
          <select id="uf" name="uf" defaultValue={sp.uf ?? ""} className={input}>
            <option value="">Todas</option>
            {[...new Set([...states, ...(sp.uf ? [sp.uf] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="rounded-md border px-3 py-2">Filtrar</button>
      </form>

      <form key={`${channel}-${sp.todos ?? ""}-${sp.uf ?? ""}`} action={createCampaign} className="flex flex-col gap-4">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="version_id" value={v.id} />
        <input type="hidden" name="channel" value={channel} />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium">Nome do envio</label>
            <input id="name" name="name" required minLength={2} maxLength={200} className={input}
              defaultValue={`${v.catalogs.title} · ${new Date().toLocaleDateString("pt-BR")}`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="days" className="text-sm font-medium">Link do catálogo vale por</label>
            <select id="days" name="days" defaultValue="30" className={input}>
              {LINK_DAYS.map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
          </div>
        </div>
        {channel === "email" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="subject" className="text-sm font-medium">Assunto</label>
            <input id="subject" name="subject" maxLength={300} defaultValue={defaultSubject} className={input} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="body" className="text-sm font-medium">Mensagem</label>
          <textarea id="body" name="body" required rows={channel === "email" ? 10 : 4} maxLength={4000} defaultValue={defaultBody} className={input} />
          <p className="text-xs text-neutral-500">
            Variáveis: {CATALOG_VARIABLES.map((x) => `{{${x.key}}}`).join(", ")}. O link do PDF e a linha &quot;responda SAIR&quot; entram
            automaticamente em cada mensagem.
          </p>
          {first && (
            <details className="text-sm">
              <summary className="cursor-pointer">Como fica para {first.trade_name ?? first.legal_name}</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md border p-3 font-sans">{preview}</pre>
            </details>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">Clientes ({companies.length})</legend>
          {error && <Alert kind="error">Não foi possível carregar os clientes.</Alert>}
          {!error && companies.length === 0 && (
            <EmptyState title="Nenhum cliente neste filtro">
              {onlyIndustry ? "Nenhum cliente ligado a esta indústria. Marque \"Incluir clientes de outras indústrias\" ou adicione pela Prospecção." : "Cadastre clientes ou use a Prospecção."}
            </EmptyState>
          )}
          <ul className="flex max-h-[28rem] flex-col divide-y overflow-auto rounded-lg border text-sm">
            {companies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" name="company_id" value={c.id} defaultChecked={reach(c)} />
                  <span>
                    {c.trade_name ?? c.legal_name}{" "}
                    <span className="text-neutral-500">
                      {[cityName(c), c.state_code].filter(Boolean).join("/")} · {c.kind === "customer" ? "cliente" : "prospect"}
                    </span>
                  </span>
                </label>
                {!reach(c) && <span className="text-xs text-amber-700 dark:text-amber-300">{channel === "email" ? "sem e-mail" : "sem telefone"}</span>}
              </li>
            ))}
          </ul>
        </fieldset>
        {can(ctx.role, "deals.write") && v.status === "published" && (
          <button className="self-start rounded-md bg-blue-700 px-4 py-2 font-medium text-white">Montar fila de envio</button>
        )}
      </form>
    </div>
  );
}
