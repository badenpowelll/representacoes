import { Fragment } from "react";
import Link from "next/link";
import { CHANNEL_KIND_LABELS, parseChannels } from "@/lib/cnpj/contact-info";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj } from "@/lib/validation/cnpj";
import { Alert, EmptyState } from "@/components/ui";
import { IndustryForm } from "../forms";
import { ReceitaDetails } from "@/components/receita-details";
import { fromRegistryRow, REGISTRY_COLUMNS, type RegistryRow } from "@/lib/cnpj/registry";

export const metadata = { title: "Indústrias · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("industries")
    .select("id, name, cnpj, segment, website, contact_channels, active")
    .eq("tenant_id", tenantId)
    .order("name");
  const cnpjs = (data ?? []).map((i) => i.cnpj).filter((c): c is string => Boolean(c));
  const { data: registry } = cnpjs.length
    ? await supabase.from("cnpj_registry").select(REGISTRY_COLUMNS).eq("tenant_id", tenantId).in("cnpj", cnpjs)
    : { data: [] };
  const receitaByCnpj = new Map((registry ?? []).map((r) => [r.cnpj as string, fromRegistryRow(r as RegistryRow)]));

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
                <th className="py-2 pr-4">Site</th>
                <th className="py-2">Contatos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((i) => {
                const receita = i.cnpj ? receitaByCnpj.get(i.cnpj) : undefined;
                return (
                <Fragment key={i.id}>
                <tr className={receita ? "" : "border-b"}>
                  <td className="py-2 pr-4 font-medium">
                    <Link href={`/app/${tenantId}/industrias/${i.id}`} className="underline">
                      {i.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{i.cnpj ? formatCnpj(i.cnpj) : "—"}</td>
                  <td className="py-2 pr-4">{i.segment ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {i.website ? (
                      <a href={i.website} rel="noopener noreferrer" target="_blank" className="underline">
                        {i.website}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2">
                    {parseChannels(i.contact_channels)
                      .slice(0, 2)
                      .map((c, k) => (
                        <div key={k}>
                          {c.label || CHANNEL_KIND_LABELS[c.kind]}: {c.value}
                        </div>
                      ))}
                    {parseChannels(i.contact_channels).length > 2 && (
                      <Link href={`/app/${tenantId}/industrias/${i.id}`} className="text-xs underline">
                        e mais {parseChannels(i.contact_channels).length - 2}
                      </Link>
                    )}
                    {parseChannels(i.contact_channels).length === 0 && "—"}
                  </td>
                </tr>
                {receita && (
                  <tr className="border-b">
                    <td colSpan={5} className="pb-3">
                      <details>
                        <summary className="cursor-pointer text-sm underline">Dados da Receita Federal de {i.name}</summary>
                        <div className="mt-2">
                          <ReceitaDetails data={receita} />
                        </div>
                      </details>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
