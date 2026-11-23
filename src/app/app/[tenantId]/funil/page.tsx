import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type DealStage } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { DealForm } from "../forms";
import { DealBoard, type BoardDeal } from "./board";

export const metadata = { title: "Funil · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const [deals, companies, industries] = await Promise.all([
    supabase
      .from("deals")
      .select("id, title, stage, amount, lost_reason, company_id, industry_id, companies(legal_name), industries(name)")
      .eq("tenant_id", tenantId)
      .order("position")
      .order("created_at"),
    supabase.from("companies").select("id, legal_name").eq("tenant_id", tenantId).order("legal_name").limit(500),
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).order("name").limit(500),
  ]);
  const writable = can(ctx.role, "deals.write");
  type Row = {
    id: string; title: string; stage: DealStage; amount: number | null; lost_reason: string | null;
    company_id: string; industry_id: string | null;
    companies: { legal_name: string } | null; industries: { name: string } | null;
  };
  const list: BoardDeal[] = ((deals.data ?? []) as unknown as Row[]).map(({ companies: c, industries: i, ...d }) => ({
    ...d,
    company_name: c?.legal_name ?? null,
    industry_name: i?.name ?? null,
  }));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Funil comercial</h1>
      {writable && (
        <section aria-labelledby="novo-negocio" className="rounded-lg border p-4">
          <h2 id="novo-negocio" className="mb-4 font-medium">
            Novo negócio
          </h2>
          {companies.data?.length ? (
            <DealForm tenantId={tenantId} companies={companies.data} industries={industries.data ?? []} />
          ) : (
            <p className="text-sm text-neutral-500">Cadastre uma empresa antes de criar negócios.</p>
          )}
        </section>
      )}
      {deals.error && <Alert kind="error">Não foi possível carregar o funil.</Alert>}
      {!deals.error && list.length === 0 && <EmptyState title="Nenhum negócio no funil" />}
      {list.length > 0 && (
        <DealBoard
          tenantId={tenantId}
          deals={list}
          companies={companies.data ?? []}
          industries={industries.data ?? []}
          writable={writable}
        />
      )}
    </div>
  );
}
