import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj } from "@/lib/validation/cnpj";
import { CONTACT_PURPOSE_LABELS, ELIGIBILITY_REASON_LABELS, LEGAL_BASIS_LABELS, type ContactPurpose } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { ContactForm, ContactRightsButtons } from "./contact-form";
import { RefreshCnpjButton } from "./cnpj-section";
import { fromRegistryRow, REGISTRY_COLUMNS, type RegistryRow } from "@/lib/cnpj/registry";
import { ReceitaDetails } from "@/components/receita-details";

export const metadata = { title: "Empresa · Rep360" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ tenantId: string; companyId: string }> }) {
  const { tenantId, companyId } = await params;
  const ctx = await requireTenantPage(tenantId);
  if (!UUID_RE.test(companyId)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, legal_name, trade_name, cnpj, cnae, segment, state_code, municipality_id, kind, source, source_date")
    .eq("tenant_id", tenantId)
    .eq("id", companyId)
    .maybeSingle();
  if (!company) notFound();

  const [contacts, eligibility, municipio, registry] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, role_title, email, phone, legal_basis, purposes, consent_at, opted_out_at, source, source_date")
      .eq("tenant_id", tenantId)
      .eq("company_id", companyId)
      .order("name"),
    // Elegibilidade calculada no servidor (supressão completa, base legal, finalidade).
    supabase.rpc("contact_eligibility", { p_tenant: tenantId, p_company: companyId, p_purpose: "prospecting", p_channel: "email" }),
    company.municipality_id
      ? supabase.from("ref_municipalities").select("name").eq("ibge_code", company.municipality_id).maybeSingle()
      : Promise.resolve({ data: null }),
    company.cnpj
      ? supabase.from("cnpj_registry").select(REGISTRY_COLUMNS).eq("tenant_id", tenantId).eq("cnpj", company.cnpj).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const receita = registry.data ? fromRegistryRow(registry.data as RegistryRow) : null;
  // Fail-closed: se a elegibilidade não puder ser calculada, ninguém é elegível.
  const eligibleById = new Map<string, { eligible: boolean; reason: string | null }>();
  if (!eligibility.error) {
    for (const r of (eligibility.data ?? []) as { contact_id: string; eligible: boolean; reason: string | null }[]) {
      eligibleById.set(r.contact_id, { eligible: r.eligible, reason: r.reason });
    }
  }
  const statusOf = (id: string) => eligibleById.get(id) ?? { eligible: false, reason: "unknown" };
  const writable = can(ctx.role, "crm.write");
  const base = `/app/${tenantId}/empresas`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={base} className="text-sm underline">
          ← Clientes e prospects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{company.legal_name}</h1>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {company.trade_name && <div><dt className="text-neutral-500">Nome fantasia</dt><dd>{company.trade_name}</dd></div>}
          <div><dt className="text-neutral-500">CNPJ</dt><dd>{company.cnpj ? formatCnpj(company.cnpj) : "—"}</dd></div>
          <div><dt className="text-neutral-500">CNAE</dt><dd>{company.cnae ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Localização</dt><dd>{[municipio.data?.name, company.state_code].filter(Boolean).join(" / ") || "—"}</dd></div>
          <div><dt className="text-neutral-500">Tipo</dt><dd>{company.kind === "customer" ? "Cliente" : "Prospect"}</dd></div>
          <div><dt className="text-neutral-500">Segmento</dt><dd>{company.segment ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Origem do dado</dt><dd>{company.source ?? "—"}{company.source_date ? ` (${company.source_date})` : ""}</dd></div>
        </dl>
      </div>

      {company.cnpj && (
        <section aria-labelledby="receita" className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 id="receita" className="font-medium">
            Dados da Receita Federal
          </h2>
          {registry.error && <Alert kind="error">Não foi possível carregar os dados da Receita.</Alert>}
          {!registry.error && !receita && <p className="text-sm text-neutral-500">Este CNPJ ainda não foi consultado.</p>}
          {receita && <ReceitaDetails data={receita} />}
          {writable && <RefreshCnpjButton tenantId={tenantId} cnpj={company.cnpj} label={receita ? "Atualizar dados da Receita" : "Buscar dados na Receita"} />}
        </section>
      )}

      {writable && (
        <section aria-labelledby="novo-contato" className="rounded-lg border p-4">
          <h2 id="novo-contato" className="mb-4 font-medium">
            Novo contato
          </h2>
          <ContactForm tenantId={tenantId} companyId={companyId} />
        </section>
      )}

      <section aria-labelledby="contatos" className="flex flex-col gap-3">
        <h2 id="contatos" className="font-medium">
          Contatos
        </h2>
        {contacts.error && <Alert kind="error">Não foi possível carregar os contatos.</Alert>}
        {eligibility.error && (
          <Alert kind="error">Não foi possível verificar bloqueios de comunicação. Por segurança, todos os contatos ficam bloqueados.</Alert>
        )}
        {!contacts.error && contacts.data?.length === 0 && <EmptyState title="Nenhum contato cadastrado" />}
        <ul className="flex flex-col gap-3">
          {(contacts.data ?? []).map((c) => {
            const st = statusOf(c.id);
            return (
              <li key={c.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.role_title && <span className="text-neutral-500">· {c.role_title}</span>}
                  {st.eligible ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
                      Pode receber prospecção por e-mail
                    </span>
                  ) : (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                      Comunicação bloqueada: {ELIGIBILITY_REASON_LABELS[st.reason ?? "unknown"] ?? st.reason}
                    </span>
                  )}
                </div>
                <p>{[c.email, c.phone].filter(Boolean).join(" · ") || "Sem e-mail ou telefone"}</p>
                <p className="text-neutral-500">
                  {LEGAL_BASIS_LABELS[c.legal_basis as keyof typeof LEGAL_BASIS_LABELS] ?? "Base legal não informada"}
                  {c.consent_at ? ` · consentimento em ${new Date(c.consent_at).toLocaleString("pt-BR")}` : ""}
                  {c.opted_out_at ? ` · oposição em ${new Date(c.opted_out_at).toLocaleString("pt-BR")}` : ""}
                  {c.source ? ` · origem: ${c.source}` : ""}
                  {c.purposes?.length
                    ? ` · finalidades: ${(c.purposes as ContactPurpose[]).map((p) => CONTACT_PURPOSE_LABELS[p] ?? p).join(", ")}`
                    : ""}
                </p>
                {writable && (
                  <ContactRightsButtons tenantId={tenantId} companyId={companyId} contactId={c.id} contactName={c.name}
                    optedOut={Boolean(c.opted_out_at)} />
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-neutral-500">
          A exclusão apaga os dados do contato. O e-mail continua na lista de supressão para que não volte a ser contatado, mesmo se for recadastrado.
        </p>
      </section>
    </div>
  );
}
