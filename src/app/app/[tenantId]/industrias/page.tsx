import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj } from "@/lib/validation/cnpj";
import { Alert, EmptyState } from "@/components/ui";
import { IndustryForm } from "../forms";

export const metadata = { title: "Indústrias · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("industries")
    .select("id, name, cnpj, segment, website, active")
    .eq("tenant_id", tenantId)
    .order("name");

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Indústrias representadas</h1>
      {can(ctx.role, "catalog.write") && (
        <section aria-labelledby="nova-industria" className="rounded-lg border p-4">
          <h2 id="nova-industria" className="mb-4 font-medium">
            Nova indústria
          </h2>
          <IndustryForm tenantId={tenantId} />
        </section>
      )}
      {error && <Alert kind="error">Não foi possível carregar as indústrias.</Alert>}
      {!error && data?.length === 0 && (
        <EmptyState title="Nenhuma indústria cadastrada">Cadastre as empresas que sua representação atende.</EmptyState>
      )}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Nome</th>
                <th className="py-2 pr-4">CNPJ</th>
                <th className="py-2 pr-4">Segmento</th>
                <th className="py-2">Site</th>
              </tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="py-2 pr-4 font-medium">{i.name}</td>
                  <td className="py-2 pr-4">{i.cnpj ? formatCnpj(i.cnpj) : "—"}</td>
                  <td className="py-2 pr-4">{i.segment ?? "—"}</td>
                  <td className="py-2">
                    {i.website ? (
                      <a href={i.website} rel="noopener noreferrer" target="_blank" className="underline">
                        {i.website}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
