import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import Link from "next/link";
import { recompute, recomputeAll, review } from "./actions";

export const metadata = { title: "Compatibilidade · Rep360" };

const REVIEW_LABEL = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado" } as const;

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
  const writable = can(ctx.role, "deals.write");
  const supabase = await createSupabaseServerClient();
  const { data: industries } = await supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name");
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Compatibilidade</h1>
      <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
        Pontuação explicável: território da indústria (40, obrigatório), CNAE-alvo (30), segmento (20) e contato com e-mail apto e
        fora da lista de supressão (10). Toda sugestão passa por revisão humana; aprovar cria um lead qualificado.
      </p>
      {!industries?.length ? (
        <EmptyState title="Cadastre uma indústria e seus territórios para calcular compatibilidade" />
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <form className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="industria" className="text-sm font-medium">
                Indústria
              </label>
              <select id="industria" name="industria" defaultValue={byCustomer ? "clientes" : selected?.id} className="rounded-md border px-3 py-2">
                <option value="clientes">Por cliente (todas as indústrias)</option>
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="rounded-md border px-3 py-2">Ver</button>
          </form>
          {writable && selected && (
            <form action={recompute}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="industry_id" value={selected.id} />
              <button className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white">Calcular compatibilidade</button>
            </form>
          )}
          {writable && (
            <form action={recomputeAll}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <button className="rounded-md border px-4 py-2 font-medium">Calcular todas as indústrias</button>
            </form>
          )}
        </div>
      )}
      {byCustomer && (
        <section aria-labelledby="por-cliente" className="flex flex-col gap-3">
          <h2 id="por-cliente" className="font-medium">Indústrias que podem vender para cada cliente</h2>
          {mixError && <Alert kind="error">Não foi possível carregar os resultados.</Alert>}
          {!mixError && customerList.length === 0 && <EmptyState title="Nenhum resultado ainda. Clique em Calcular todas as indústrias." />}
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
                      {it.industry} · {it.score}/100 · {REVIEW_LABEL[it.review]}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <Alert kind="error">Não foi possível carregar os resultados.</Alert>}
      {selected && rows.length === 0 && !error && <EmptyState title="Nenhum resultado ainda. Clique em Calcular compatibilidade." />}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {m.companies?.legal_name} <span className="text-sm text-neutral-500">{m.companies?.state_code}</span>
                </p>
                <p>
                  <strong className="text-lg">{m.score}</strong>/100 · {REVIEW_LABEL[m.review]}
                </p>
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                {m.reasons.map((r) => (
                  <li key={r.criterion}>
                    {r.detail} (+{r.points})
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
