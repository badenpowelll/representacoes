import { requireTenantPage } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEAL_STAGES, DEAL_STAGE_LABELS } from "@/lib/validation/schemas";

export const metadata = { title: "Painel · Rep360" };

export default async function Dashboard({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const count = async (table: string, filter?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    let q = base(table);
    if (filter) q = filter(q);
    const { count } = await q;
    return count ?? 0;
  };
  function base(table: string) {
    return supabase.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
  }

  const [industries, customers, prospects, leads, deals] = await Promise.all([
    count("industries"),
    count("companies", (q) => q.eq("kind", "customer")),
    count("companies", (q) => q.eq("kind", "prospect")),
    count("leads"),
    supabase.from("deals").select("stage, amount").eq("tenant_id", tenantId),
  ]);
  const byStage = Object.fromEntries(DEAL_STAGES.map((s) => [s, 0])) as Record<string, number>;
  let wonAmount = 0;
  for (const d of deals.data ?? []) {
    byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
    if (d.stage === "won") wonAmount += Number(d.amount ?? 0);
  }

  const tiles = [
    { label: "Indústrias", value: industries },
    { label: "Clientes", value: customers },
    { label: "Prospects", value: prospects },
    { label: "Leads", value: leads },
    { label: "Vendas ganhas", value: wonAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) },
  ];

  const totalDeals = Object.values(byStage).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Painel</h1>
        <p className="mt-1 text-sm text-neutral-500">Resumo da representação: carteira, prospecção e funil de vendas.</p>
      </div>
      {deals.error && <p role="alert">Não foi possível carregar o funil.</p>}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)]">
        {tiles.map((t, i) => (
          <div
            key={t.label}
            className={`relative overflow-hidden rounded-lg border p-5 ${i === tiles.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 top-0 h-1 ${i === tiles.length - 1 ? "bg-argos-orange" : "bg-argos-navy"}`}
            />
            <dt className="text-xs font-semibold tracking-[0.06em] uppercase">{t.label}</dt>
            <dd className="mt-2 text-2xl font-bold whitespace-nowrap tabular-nums xl:text-3xl">{t.value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="funil-resumo" className="rounded-lg border p-5">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="funil-resumo" className="font-semibold">
            Negócios por etapa
          </h2>
          <span className="text-sm text-neutral-500">
            {totalDeals} {totalDeals === 1 ? "negócio" : "negócios"}
          </span>
        </div>
        <ul className="flex flex-col gap-3">
          {DEAL_STAGES.map((s) => {
            const n = byStage[s];
            const pct = totalDeals ? Math.round((n / totalDeals) * 100) : 0;
            const color = s === "won" ? "bg-green-700" : s === "lost" ? "bg-argos-rust" : "bg-argos-navy";
            return (
              <li key={s} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="text-neutral-600">{DEAL_STAGE_LABELS[s]}</span>
                <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-neutral-100">
                  <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                </span>
                <strong className="text-right tabular-nums">{n}</strong>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
