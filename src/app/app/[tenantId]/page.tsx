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

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Painel</h1>
      {deals.error && <p role="alert">Não foi possível carregar o funil.</p>}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border p-4">
            <dt className="text-sm text-neutral-500">{t.label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{t.value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="funil-resumo">
        <h2 id="funil-resumo" className="mb-3 font-medium">
          Negócios por etapa
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {DEAL_STAGES.map((s) => (
            <li key={s} className="rounded-md border px-3 py-2 text-sm">
              {DEAL_STAGE_LABELS[s]}: <strong>{byStage[s]}</strong>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
