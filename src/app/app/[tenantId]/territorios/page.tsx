import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { TerritoryForm } from "./form";
import { removeTerritory, removeTerritoryGroup } from "./actions";

export const metadata = { title: "Territórios · Rep360" };

const PAGINA = 1000;
const MOSTRAR = 8;

type Profile = { full_name: string | null; email: string | null } | null;
type Row = {
  id: string;
  industry_id: string;
  state_code: string;
  municipality_id: number | null;
  membership_id: string | null;
  exclusive: boolean;
  industries: { name: string } | null;
  memberships: { profiles: Profile } | null;
};

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const writable = can(ctx.role, "catalog.write");

  // Paginado: com municípios escolhidos um a um, passa fácil de 1000 linhas.
  const rows: Row[] = [];
  let territoriesError = false;
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await supabase
      .from("territories")
      .select("id, industry_id, state_code, municipality_id, membership_id, exclusive, industries(name), memberships(profiles:user_id(full_name, email))")
      .eq("tenant_id", tenantId)
      .order("state_code")
      .order("id")
      .range(from, from + PAGINA - 1);
    if (error) {
      territoriesError = true;
      break;
    }
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGINA) break;
  }

  const [industries, states, members] = await Promise.all([
    supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabase.from("ref_states").select("code, name, region").order("name"),
    supabase
      .from("memberships")
      .select("id, profiles:user_id(full_name, email)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("role", ["representative", "manager", "tenant_admin"]),
  ]);

  // Nomes dos municípios, buscados por UF (evita URL gigante com milhares de códigos).
  const ufsComMunicipio = [...new Set(rows.filter((r) => r.municipality_id != null).map((r) => r.state_code))];
  const municipioName = new Map<number, string>();
  for (const uf of ufsComMunicipio) {
    const { data } = await supabase.from("ref_municipalities").select("ibge_code, name").eq("state_code", uf);
    for (const m of data ?? []) municipioName.set(m.ibge_code as number, m.name as string);
  }

  const reps = ((members.data ?? []) as unknown as { id: string; profiles: Profile }[]).map((m) => ({
    id: m.id,
    label: m.profiles?.full_name ?? m.profiles?.email ?? "Membro",
  }));

  // Agrupa por indústria + UF + responsável: "Toda a UF" ou a lista de municípios.
  type Grupo = { key: string; uf: string; industria: string; responsavel: string; exclusivo: boolean; inteira: Row | null; municipios: Row[] };
  const grupos = new Map<string, Grupo>();
  for (const r of rows) {
    const key = `${r.industry_id}|${r.state_code}|${r.membership_id ?? "-"}`;
    const g =
      grupos.get(key) ??
      ({
        key,
        uf: r.state_code,
        industria: r.industries?.name ?? "",
        responsavel: r.memberships?.profiles?.full_name ?? r.memberships?.profiles?.email ?? "Toda a equipe",
        exclusivo: false,
        inteira: null,
        municipios: [],
      } satisfies Grupo);
    if (r.municipality_id == null) g.inteira = r;
    else g.municipios.push(r);
    g.exclusivo ||= r.exclusive;
    grupos.set(key, g);
  }
  const nomeMun = (r: Row) => municipioName.get(r.municipality_id!) ?? String(r.municipality_id);
  const lista = [...grupos.values()].sort((a, b) => a.uf.localeCompare(b.uf) || a.industria.localeCompare(b.industria, "pt-BR"));
  for (const g of lista) g.municipios.sort((a, b) => nomeMun(a).localeCompare(nomeMun(b), "pt-BR"));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Territórios</h1>
      {writable && (
        <section aria-labelledby="nova-cobertura" className="rounded-lg border p-4">
          <h2 id="nova-cobertura" className="mb-1 font-medium">
            Onde a representação atua
          </h2>
          <p className="mb-4 text-sm text-neutral-500">
            Escolha a região, marque os estados e, em cada estado, todos os municípios ou só os que quiser.
          </p>
          {industries.data?.length ? (
            <TerritoryForm
              tenantId={tenantId}
              industries={industries.data}
              states={(states.data ?? []) as { code: string; name: string; region: string }[]}
              reps={reps}
            />
          ) : (
            <p className="text-sm text-neutral-500">
              O território é definido por indústria representada.{" "}
              <Link href={`/app/${tenantId}/industrias`} className="text-blue-700 underline dark:text-blue-400">
                Cadastre uma indústria
              </Link>{" "}
              e volte aqui.
            </p>
          )}
          {states.error && <Alert kind="error">Não foi possível carregar as UFs.</Alert>}
        </section>
      )}
      {territoriesError && <Alert kind="error">Não foi possível carregar os territórios.</Alert>}
      {!territoriesError && lista.length === 0 && <EmptyState title="Nenhuma cobertura definida" />}
      {lista.length > 0 && (
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
              {lista.map((g) => {
                const todos = [...(g.inteira ? [g.inteira] : []), ...g.municipios];
                return (
                  <tr key={g.key} className="border-b align-top">
                    <td className="py-2 pr-4 font-medium">{g.uf}</td>
                    <td className="py-2 pr-4">
                      {g.inteira && <div>Toda a UF</div>}
                      {g.municipios.length > 0 && (
                        <MunicipiosCell tenantId={tenantId} writable={writable} nomes={g.municipios.map((r) => ({ id: r.id, nome: nomeMun(r) }))} />
                      )}
                    </td>
                    <td className="py-2 pr-4">{g.industria}</td>
                    <td className="py-2 pr-4">{g.responsavel}</td>
                    <td className="py-2 pr-4">{g.exclusivo ? "Sim" : "Não"}</td>
                    {writable && (
                      <td className="py-2">
                        <form action={removeTerritoryGroup}>
                          <input type="hidden" name="tenant_id" value={tenantId} />
                          <input type="hidden" name="territory_ids" value={todos.map((r) => r.id).join(",")} />
                          <button className="text-red-700 underline" aria-label={`Remover cobertura de ${g.uf} (${g.industria})`}>
                            Remover
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MunicipiosCell({ tenantId, writable, nomes }: { tenantId: string; writable: boolean; nomes: { id: string; nome: string }[] }) {
  if (nomes.length === 1 && !writable) return <div>{nomes[0].nome}</div>;
  const resumo =
    nomes.length <= MOSTRAR ? nomes.map((n) => n.nome).join(", ") : `${nomes.slice(0, MOSTRAR).map((n) => n.nome).join(", ")} e mais ${nomes.length - MOSTRAR}`;
  return (
    <details>
      <summary className="cursor-pointer">
        {nomes.length === 1 ? nomes[0].nome : `${nomes.length} municípios: ${resumo}`}
      </summary>
      <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
        {nomes.map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-4">
            <span>{n.nome}</span>
            {writable && (
              <form action={removeTerritory}>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="territory_id" value={n.id} />
                <button className="text-xs text-red-700 underline" aria-label={`Tirar ${n.nome}`}>
                  Tirar
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
