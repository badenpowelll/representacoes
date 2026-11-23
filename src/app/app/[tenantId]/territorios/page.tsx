import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { TerritoryForm } from "./form";
import { removeTerritory } from "./actions";

export const metadata = { title: "Territórios · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const writable = can(ctx.role, "catalog.write");
  const [territories, industries, states, members] = await Promise.all([
    supabase
      .from("territories")
      .select("id, state_code, municipality_id, exclusive, industries(name), memberships(profiles:user_id(full_name, email))")
      .eq("tenant_id", tenantId)
      .order("state_code"),
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabase.from("ref_states").select("code, name").order("code"),
    supabase
      .from("memberships")
      .select("id, profiles:user_id(full_name, email)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("role", ["representative", "manager", "tenant_admin"]),
  ]);
  type Profile = { full_name: string | null; email: string | null } | null;
  type Row = { id: string; state_code: string; municipality_id: number | null; exclusive: boolean; industries: { name: string } | null; memberships: { profiles: Profile } | null };
  const rows = (territories.data ?? []) as unknown as Row[];
  const municipioIds = [...new Set(rows.map((r) => r.municipality_id).filter((v): v is number => v != null))];
  const { data: municipios } = municipioIds.length
    ? await supabase.from("ref_municipalities").select("ibge_code, name").in("ibge_code", municipioIds)
    : { data: [] as { ibge_code: number; name: string }[] };
  const municipioName = new Map((municipios ?? []).map((m) => [m.ibge_code, m.name]));
  const reps = ((members.data ?? []) as unknown as { id: string; profiles: Profile }[]).map((m) => ({
    id: m.id,
    label: m.profiles?.full_name ?? m.profiles?.email ?? "Membro",
  }));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Territórios</h1>
      {writable && (
        <section aria-labelledby="nova-cobertura" className="rounded-lg border p-4">
          <h2 id="nova-cobertura" className="mb-4 font-medium">
            Nova cobertura
          </h2>
          {industries.data?.length ? (
            <TerritoryForm tenantId={tenantId} industries={industries.data} states={states.data ?? []} reps={reps} />
          ) : (
            <p className="text-sm text-neutral-500">Cadastre uma indústria antes de definir territórios.</p>
          )}
          {states.error && <Alert kind="error">Não foi possível carregar as UFs.</Alert>}
        </section>
      )}
      {territories.error && <Alert kind="error">Não foi possível carregar os territórios.</Alert>}
      {!territories.error && rows.length === 0 && <EmptyState title="Nenhuma cobertura definida" />}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">UF</th>
                <th className="py-2 pr-4">Município</th>
                <th className="py-2 pr-4">Indústria</th>
                <th className="py-2 pr-4">Responsável</th>
                <th className="py-2 pr-4">Exclusivo</th>
                {writable && <th className="py-2">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2 pr-4 font-medium">{t.state_code}</td>
                  <td className="py-2 pr-4">{t.municipality_id ? (municipioName.get(t.municipality_id) ?? t.municipality_id) : "Toda a UF"}</td>
                  <td className="py-2 pr-4">{t.industries?.name}</td>
                  <td className="py-2 pr-4">{t.memberships?.profiles?.full_name ?? t.memberships?.profiles?.email ?? "Toda a equipe"}</td>
                  <td className="py-2 pr-4">{t.exclusive ? "Sim" : "Não"}</td>
                  {writable && (
                    <td className="py-2">
                      <form action={removeTerritory}>
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="territory_id" value={t.id} />
                        <button className="text-red-700 underline">Remover</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
