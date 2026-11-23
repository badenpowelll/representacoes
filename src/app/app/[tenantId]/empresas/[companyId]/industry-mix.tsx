import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS } from "@/lib/validation/schemas";
import { linkIndustry } from "./mix-actions";

type Fit = {
  industry_id: string;
  industry_name: string;
  cnae_match: boolean;
  territory_match: boolean;
  lead_id: string | null;
  lead_status: keyof typeof LEAD_STATUS_LABELS | null;
};

/** Indústrias representadas que podem vender para este cliente (mix). */
export async function IndustryMix({ tenantId, companyId, writable }: { tenantId: string; companyId: string; writable: boolean }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("company_industry_fit", { p_tenant: tenantId, p_company: companyId });
  const rows = (data ?? []) as Fit[];
  if (error || rows.length === 0) return null;
  const linked = rows.filter((r) => r.lead_id).length;
  const open = rows.filter((r) => !r.lead_id && r.cnae_match && r.territory_match).length;
  return (
    <section aria-labelledby="mix-industrias" className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 id="mix-industrias" className="font-medium">Indústrias para este cliente</h2>
        <p className="text-sm text-neutral-500">
          {linked} vinculada(s){open ? ` · ${open} compatível(is) ainda não oferecida(s)` : ""}. Um cliente pode comprar de várias
          indústrias que você representa.
        </p>
      </div>
      <ul className="flex flex-col divide-y text-sm">
        {rows.map((r) => (
          <li key={r.industry_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p className="font-medium">{r.industry_name}</p>
              <p className="text-xs text-neutral-500">
                {r.lead_id
                  ? `Vinculada · lead ${LEAD_STATUS_LABELS[r.lead_status ?? "new"].toLowerCase()}`
                  : !r.territory_match
                    ? "Fora do território desta indústria"
                    : r.cnae_match
                      ? "Compatível (atividade e território)"
                      : "No território, mas a atividade não está no perfil da indústria"}
              </p>
            </div>
            {writable && !r.lead_id && r.territory_match && (
              <form action={linkIndustry}>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="industry_id" value={r.industry_id} />
                <button className="rounded-md border px-3 py-1">Vincular {r.industry_name}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
