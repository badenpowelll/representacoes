import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { ProspectForm } from "./form";
import { leadToDeal, setLeadStatus } from "./actions";

export const metadata = { title: "Leads · Rep360" };

type Status = keyof typeof LEAD_STATUS_LABELS;

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const crm = can(ctx.role, "crm.write");
  const deals = can(ctx.role, "deals.write");
  const today = new Date().toISOString().slice(0, 10);

  const [leads, industries] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, source, source_date, created_at, companies(id, legal_name, state_code), industries(name), deals(id)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
  ]);
  type Row = {
    id: string; status: Status; source: string; source_date: string;
    companies: { id: string; legal_name: string; state_code: string | null } | null;
    industries: { name: string } | null; deals: { id: string }[];
  };
  const rows = (leads.data ?? []) as unknown as Row[];
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Leads e prospecção</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Para encontrar empresas automaticamente pela atividade e pelo território, use a{" "}
          <Link href={`/app/${tenantId}/prospeccao`} className="underline">
            Prospecção automática
          </Link>
          . Aqui você acompanha os leads e cadastra à mão uma empresa que já conhece (pelo CNPJ), sempre com a fonte do dado.
        </p>
      </div>
      {crm && (
        <section aria-labelledby="novo-prospect" className="rounded-lg border p-4">
          <h2 id="novo-prospect" className="mb-4 font-medium">
            Cadastrar empresa que você já conhece
          </h2>
          {industries.data?.length ? (
            <ProspectForm tenantId={tenantId} industries={industries.data} today={today} />
          ) : (
            <p className="text-sm text-neutral-500">Cadastre uma indústria antes de registrar prospects.</p>
          )}
        </section>
      )}
      {leads.error && <Alert kind="error">Não foi possível carregar os leads.</Alert>}
      {!leads.error && rows.length === 0 && <EmptyState title="Nenhum lead registrado" />}
      <ul className="flex flex-col gap-3">
        {rows.map((l) => (
          <li key={l.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {l.companies ? (
                <Link href={`/app/${tenantId}/empresas/${l.companies.id}`} className="font-medium underline">
                  {l.companies.legal_name}
                </Link>
              ) : (
                <span className="font-medium">Empresa</span>
              )}
              <span className="text-neutral-500">· {l.industries?.name}</span>
              {l.companies?.state_code && <span className="text-neutral-500">· {l.companies.state_code}</span>}
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{LEAD_STATUS_LABELS[l.status]}</span>
              {l.deals.length > 0 && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-900 dark:bg-green-950 dark:text-green-100">No funil</span>}
            </div>
            <p className="text-neutral-500">
              Fonte: {l.source} · {new Date(`${l.source_date}T12:00:00`).toLocaleDateString("pt-BR")}
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              {crm && l.status !== "qualified" && (
                <form action={setLeadStatus}>
                  {hidden("tenant_id", tenantId)}
                  {hidden("lead_id", l.id)}
                  {hidden("status", "qualified")}
                  <button className="underline">Qualificar</button>
                </form>
              )}
              {crm && l.status !== "discarded" && l.deals.length === 0 && (
                <form action={setLeadStatus}>
                  {hidden("tenant_id", tenantId)}
                  {hidden("lead_id", l.id)}
                  {hidden("status", "discarded")}
                  <button className="underline">Descartar</button>
                </form>
              )}
              {deals && l.deals.length === 0 && l.status !== "discarded" && (
                <form action={leadToDeal}>
                  {hidden("tenant_id", tenantId)}
                  {hidden("lead_id", l.id)}
                  <button className="underline">Levar ao funil</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
