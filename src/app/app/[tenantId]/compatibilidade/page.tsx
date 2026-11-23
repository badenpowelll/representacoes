import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import Link from "next/link";
import { review, showCompatible } from "./actions";

export const metadata = { title: "Compatibilidade · Rep360" };

/** Motivo da nota em linguagem simples (o banco guarda o texto técnico). */
function reasonText(r: { criterion: string; detail: string }): string {
  const tail = r.detail.split(" ").slice(1).join(" ");
  switch (r.criterion) {
    case "territory":
      return `Fica em ${r.detail.replace(/^Cobertura na UF /, "")}, onde a indústria atua`;
    case "cnae":
      return `A atividade (CNAE ${r.detail.match(/\d{7}/)?.[0] ?? tail}) é uma das que a indústria procura`;
    case "segment":
      return `Segmento ${tail}`;
    case "reachable":
      return "Tem contato com e-mail que pode receber mensagens";
    default:
      return r.detail;
  }
}

const REVIEW_LABEL = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado" } as const;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ industria?: string; calculado?: string }>;
}) {
  const { tenantId } = await params;
  const { industria, calculado } = await searchParams;
  const ctx = await requireTenantPage(tenantId);
  const writable = can(ctx.role, "deals.write");
  const supabase = await createSupabaseServerClient();
  const { data: industries } = await supabase.from("industries").select("id, name, target_cnaes").eq("tenant_id", tenantId).eq("active", true).order("name");
  const byCustomer = industria === "clientes";
  const selected = byCustomer ? undefined : (industries?.find((i) => i.id === industria) ?? industries?.[0]);
  type MixRow = { company_id: string; score: number; review: keyof typeof REVIEW_LABEL; industries: { name: string } | null; companies: { legal_name: string; state_code: string | null } | null };
  const { data: mixData, error: mixError } = byCustomer
    ? await supabase
        .from("matches")
        .select("company_id, score, review, industries(name), companies(legal_name, state_code)")
        .eq("tenant_id", tenantId)
        .neq("review", "rejected")
        .order("score", { ascending: false })
        .limit(2000)
    : { data: [], error: null };
  const customers = new Map<string, { name: string; uf: string | null; items: { industry: string; score: number; review: keyof typeof REVIEW_LABEL }[] }>();
  for (const m of (mixData ?? []) as unknown as MixRow[]) {
    const c = customers.get(m.company_id) ?? { name: m.companies?.legal_name ?? "—", uf: m.companies?.state_code ?? null, items: [] };
    c.items.push({ industry: m.industries?.name ?? "—", score: m.score, review: m.review });
    customers.set(m.company_id, c);
  }
  const customerList = [...customers.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[1].name.localeCompare(b[1].name));
  const { data: matches, error } = selected
    ? await supabase
        .from("matches")
        .select("id, score, reasons, review, companies(legal_name, state_code, cnae)")
        .eq("tenant_id", tenantId)
        .eq("industry_id", selected.id)
        .order("score", { ascending: false })
        .limit(200)
    : { data: [], error: null };
  type Reason = { criterion: string; points: number; detail: string };
  type Row = { id: string; score: number; reasons: Reason[]; review: keyof typeof REVIEW_LABEL; companies: { legal_name: string; state_code: string | null; cnae: string | null } | null };
  const rows = (matches ?? []) as unknown as Row[];

  // O que falta para aparecerem empresas (explicado na tela, em vez de lista vazia).
  const [{ data: terr }, { data: cc }, { count: companyCount }] = await Promise.all([
    selected
      ? supabase.from("territories").select("state_code").eq("tenant_id", tenantId).eq("industry_id", selected.id)
      : Promise.resolve({ data: [] as { state_code: string }[] }),
    supabase.from("commercial_contexts").select("cnaes").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);
  const ufs = [...new Set((terr ?? []).map((t) => t.state_code as string))].sort();
  const { count: inAreaCount } = selected && ufs.length
    ? await supabase.from("companies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("state_code", ufs)
    : { count: 0 };
  const cnaes = [...new Set([...((selected?.target_cnaes as string[] | null) ?? []), ...(((cc?.cnaes as string[] | null) ?? []))])];
  const prospectLink = selected ? `/app/${tenantId}/prospeccao?industria=${selected.id}` : `/app/${tenantId}/prospeccao`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Compatibilidade</h1>
        <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
          Escolha uma indústria e veja quais empresas da sua carteira combinam com ela, com a nota e o motivo. Para buscar empresas
          novas na base da Receita, use a <Link href={prospectLink} className="underline">Prospecção</Link>.
        </p>
      </div>
      {!industries?.length ? (
        <EmptyState title="Cadastre primeiro a indústria que você representa">
          <Link href={`/app/${tenantId}/prospeccao`} className="underline">Cadastrar indústria na Prospecção</Link>
        </EmptyState>
      ) : (
        <form action={showCompatible} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <div className="flex flex-col gap-1">
            <label htmlFor="industria" className="text-sm font-medium">
              Indústria
            </label>
            <select id="industria" name="industria" defaultValue={byCustomer ? "clientes" : selected?.id} className="rounded-md border px-3 py-2">
              {industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
              <option value="clientes">Todas, agrupadas por cliente</option>
            </select>
          </div>
          <button className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white">Ver empresas compatíveis</button>
          {!writable && <p className="text-sm text-neutral-500">Seu acesso é de leitura: você vê o último cálculo feito pela equipe.</p>}
        </form>
      )}
      <details className="max-w-3xl rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Como a nota é calculada</summary>
        <ul className="mt-2 list-disc pl-5 text-neutral-600 dark:text-neutral-400">
          <li>A empresa precisa ficar num estado (ou município) onde a indústria atua. Sem isso, ela não aparece.</li>
          <li>+40 por estar na área da indústria.</li>
          <li>+30 se a atividade da empresa (CNAE) é uma das que a indústria procura.</li>
          <li>+20 se o segmento da empresa é o da indústria.</li>
          <li>+10 se tem um contato com e-mail que pode receber mensagens.</li>
        </ul>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Nada é enviado daqui. Você aprova as que fazem sentido e elas viram leads no funil.
        </p>
      </details>
      {byCustomer && (
        <section aria-labelledby="por-cliente" className="flex flex-col gap-3">
          <h2 id="por-cliente" className="font-medium">Indústrias que podem vender para cada cliente</h2>
          {mixError && <Alert kind="error">Não foi possível carregar os resultados.</Alert>}
          {!mixError && customerList.length === 0 && (
            <EmptyState title={calculado ? "Nenhuma empresa compatível com as indústrias cadastradas." : "Clique em Ver empresas compatíveis."}>
              Confira se cada indústria tem estados em <Link href={`/app/${tenantId}/territorios`} className="underline">Territórios</Link> e
              se há empresas na carteira (traga pela <Link href={`/app/${tenantId}/prospeccao`} className="underline">Prospecção</Link>).
            </EmptyState>
          )}
          <ul className="flex flex-col gap-3">
            {customerList.map(([id, c]) => (
              <li key={id} className="rounded-lg border p-4">
                <p className="font-medium">
                  <Link href={`/app/${tenantId}/empresas/${id}`} className="underline">{c.name}</Link>{" "}
                  <span className="text-sm text-neutral-500">{c.uf}</span> · {c.items.length} indústria(s)
                </p>
                <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                  {c.items.map((it) => (
                    <li key={it.industry} className="rounded-full border px-3 py-1">
                      {it.industry} · nota {it.score}/100 · {REVIEW_LABEL[it.review]}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <Alert kind="error">Não foi possível carregar os resultados.</Alert>}
      {selected && !error && (
        <section aria-label="O que falta" className="flex flex-col gap-2">
          {ufs.length === 0 ? (
            <Alert kind="info">
              A {selected.name} ainda não tem área de atuação. Diga em quais estados ela vende em{" "}
              <Link href={`/app/${tenantId}/territorios`} className="underline">Territórios</Link>; sem isso nenhuma empresa aparece.
            </Alert>
          ) : rows.length === 0 && (companyCount ?? 0) === 0 ? (
            <Alert kind="info">
              Sua carteira ainda não tem empresas. Busque empresas reais na{" "}
              <Link href={prospectLink} className="underline">Prospecção da {selected.name}</Link>, adicione as que interessam à carteira e
              volte aqui.
            </Alert>
          ) : rows.length === 0 && (inAreaCount ?? 0) === 0 ? (
            <Alert kind="info">
              Nenhuma empresa da sua carteira fica em {ufs.join(", ")}, onde a {selected.name} atua. Busque empresas dessa região na{" "}
              <Link href={prospectLink} className="underline">Prospecção</Link>.
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState title={calculado ? "Nenhuma empresa compatível." : "Clique em Ver empresas compatíveis."} />
          ) : null}
          {ufs.length > 0 && cnaes.length === 0 && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Dica: a {selected.name} não tem atividades (CNAEs) que procura. Cadastre na{" "}
              <Link href={prospectLink} className="underline">Prospecção</Link> para a nota ficar mais precisa.
            </p>
          )}
          {rows.length > 0 && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {rows.length} empresa(s) da carteira em {ufs.join(", ")} combinam com a {selected.name}.
            </p>
          )}
        </section>
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {m.companies?.legal_name} <span className="text-sm text-neutral-500">{m.companies?.state_code}</span>
                </p>
                <p>
                  Nota <strong className="text-lg">{m.score}</strong>/100 · {REVIEW_LABEL[m.review]}
                </p>
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                {m.reasons.map((r) => (
                  <li key={r.criterion}>
                    {reasonText(r)} (+{r.points})
                  </li>
                ))}
              </ul>
              {writable && m.review === "pending" && (
                <div className="mt-3 flex gap-2">
                  {(["approved", "rejected"] as const).map((d) => (
                    <form key={d} action={review}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="match_id" value={m.id} />
                      <input type="hidden" name="decision" value={d} />
                      <button className="rounded-md border px-3 py-1 text-sm">{d === "approved" ? "Aprovar e criar lead" : "Rejeitar"}</button>
                    </form>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
