import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj } from "@/lib/validation/cnpj";
import { fromRegistryRow, REGISTRY_COLUMNS, type RegistryRow } from "@/lib/cnpj/registry";
import { parseChannels } from "@/lib/cnpj/contact-info";
import { Alert } from "@/components/ui";
import { ReceitaDetails } from "@/components/receita-details";
import { RefreshCnpjButton } from "@/components/refresh-cnpj-button";
import { ContactInfoView } from "@/components/contact-info-view";
import { ContactInfoForm } from "@/components/contact-info-form";

export const metadata = { title: "Indústria · Rep360" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ tenantId: string; industryId: string }> }) {
  const { tenantId, industryId } = await params;
  const ctx = await requireTenantPage(tenantId);
  if (!UUID_RE.test(industryId)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: industry } = await supabase
    .from("industries")
    .select("id, name, cnpj, segment, website, website_source, contact_channels, active")
    .eq("tenant_id", tenantId)
    .eq("id", industryId)
    .maybeSingle();
  if (!industry) notFound();
  const registry = industry.cnpj
    ? await supabase.from("cnpj_registry").select(REGISTRY_COLUMNS).eq("tenant_id", tenantId).eq("cnpj", industry.cnpj).maybeSingle()
    : { data: null, error: null };
  const receita = registry.data ? fromRegistryRow(registry.data as RegistryRow) : null;
  const writable = can(ctx.role, "catalog.write");
  const channels = parseChannels(industry.contact_channels);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/app/${tenantId}/industrias`} className="text-sm underline">
          ← Indústrias
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{industry.name}</h1>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-neutral-500">CNPJ</dt><dd>{industry.cnpj ? formatCnpj(industry.cnpj) : "—"}</dd></div>
          <div><dt className="text-neutral-500">Segmento</dt><dd>{industry.segment ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Situação no Rep360</dt><dd>{industry.active ? "Ativa" : "Inativa"}</dd></div>
        </dl>
      </div>

      <section aria-labelledby="canais" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="canais" className="font-medium">
          Site e canais de contato
        </h2>
        <ContactInfoView website={industry.website} websiteSource={industry.website_source} channels={channels} />
        {writable && (
          <details>
            <summary className="cursor-pointer text-sm underline">Editar site e canais</summary>
            <div className="mt-3">
              <ContactInfoForm tenantId={tenantId} entity="industry" id={industry.id} website={industry.website} channels={channels} />
            </div>
          </details>
        )}
        <p className="text-xs text-neutral-500">Atualizar os dados da Receita não apaga nem altera o que está aqui.</p>
      </section>

      {industry.cnpj && (
        <section aria-labelledby="receita" className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 id="receita" className="font-medium">
            Dados da Receita Federal
          </h2>
          {registry.error && <Alert kind="error">Não foi possível carregar os dados da Receita.</Alert>}
          {!registry.error && !receita && <p className="text-sm text-neutral-500">Este CNPJ ainda não foi consultado.</p>}
          {receita && <ReceitaDetails data={receita} />}
          {writable && (
            <RefreshCnpjButton tenantId={tenantId} cnpj={industry.cnpj} label={receita ? "Atualizar dados da Receita" : "Buscar dados na Receita"} />
          )}
        </section>
      )}
    </div>
  );
}
