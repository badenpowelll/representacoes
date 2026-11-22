import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { DealForm, MoveDealForm } from "../forms";

export const metadata = { title: "Funil · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const [deals, companies] = await Promise.all([
    supabase
      .from("deals")
      .select("id, title, stage, amount, lost_reason, companies(legal_name)")
      .eq("tenant_id", tenantId)
      .order("position")
      .order("created_at"),
    supabase.from("companies").select("id, legal_name").eq("tenant_id", tenantId).order("legal_name").limit(500),
  ]);
  const writable = can(ctx.role, "deals.write");
  type Deal = { id: string; title: string; stage: DealStage; amount: number | null; lost_reason: string | null; companies: { legal_name: string } | null };
  const list = (deals.data ?? []) as unknown as Deal[];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Funil comercial</h1>
      {writable && (
        <section aria-labelledby="novo-negocio" className="rounded-lg border p-4">
          <h2 id="novo-negocio" className="mb-4 font-medium">
            Novo negócio
          </h2>
          {companies.data?.length ? (
            <DealForm tenantId={tenantId} companies={companies.data} />
          ) : (
            <p className="text-sm text-neutral-500">Cadastre uma empresa antes de criar negócios.</p>
          )}
        </section>
      )}
      {deals.error && <Alert kind="error">Não foi possível carregar o funil.</Alert>}
      {!deals.error && list.length === 0 && <EmptyState title="Nenhum negócio no funil" />}
      {list.length > 0 && (
        <div className="grid auto-cols-[minmax(14rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
          {DEAL_STAGES.map((stage) => {
            const items = list.filter((d) => d.stage === stage);
            return (
              <section key={stage} aria-labelledby={`col-${stage}`} className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900">
                <h2 id={`col-${stage}`} className="mb-3 text-sm font-semibold">
                  {DEAL_STAGE_LABELS[stage]} <span className="font-normal text-neutral-500">({items.length})</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((d) => (
                    <li key={d.id} className="rounded-md border bg-white p-3 text-sm dark:bg-neutral-950">
                      <p className="font-medium">{d.title}</p>
                      <p className="text-neutral-500">{d.companies?.legal_name}</p>
                      {d.amount != null && (
                        <p>{Number(d.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                      )}
                      {d.lost_reason && <p className="text-red-700">Motivo: {d.lost_reason}</p>}
                      {writable && <MoveDealForm tenantId={tenantId} dealId={d.id} stage={d.stage} />}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
