import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj } from "@/lib/validation/cnpj";
import { Alert, EmptyState } from "@/components/ui";
import { CompanyForm } from "../forms";

export const metadata = { title: "Empresas · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, legal_name, cnpj, cnae, segment, state_code, kind, source")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Clientes e prospects</h1>
      {can(ctx.role, "crm.write") && (
        <section aria-labelledby="nova-empresa" className="rounded-lg border p-4">
          <h2 id="nova-empresa" className="mb-4 font-medium">
            Nova empresa
          </h2>
          <CompanyForm tenantId={tenantId} />
        </section>
      )}
      {error && <Alert kind="error">Não foi possível carregar as empresas.</Alert>}
      {!error && data?.length === 0 && <EmptyState title="Nenhuma empresa cadastrada" />}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Razão social</th>
                <th className="py-2 pr-4">CNPJ</th>
                <th className="py-2 pr-4">CNAE</th>
                <th className="py-2 pr-4">UF</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2">Origem</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="py-2 pr-4 font-medium">
                    <Link href={`/app/${tenantId}/empresas/${c.id}`} className="underline">
                      {c.legal_name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{c.cnpj ? formatCnpj(c.cnpj) : "—"}</td>
                  <td className="py-2 pr-4">{c.cnae ?? "—"}</td>
                  <td className="py-2 pr-4">{c.state_code ?? "—"}</td>
                  <td className="py-2 pr-4">{c.kind === "customer" ? "Cliente" : "Prospect"}</td>
                  <td className="py-2">{c.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
