import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj } from "@/lib/validation/cnpj";
import { LEGAL_BASIS_LABELS } from "@/lib/validation/schemas";
import { Alert, EmptyState } from "@/components/ui";
import { ContactForm } from "./contact-form";
import { deleteContact, optOutContact } from "./actions";

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

  const [contacts, suppressed, municipio] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, role_title, email, phone, legal_basis, consent_at, opted_out_at, source, source_date")
      .eq("tenant_id", tenantId)
      .eq("company_id", companyId)
      .order("name"),
    supabase.from("suppression_list").select("email, domain").eq("tenant_id", tenantId),
    company.municipality_id
      ? supabase.from("ref_municipalities").select("name").eq("ibge_code", company.municipality_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const blockedEmails = new Set((suppressed.data ?? []).map((s) => s.email?.toLowerCase()).filter(Boolean));
  const blockedDomains = new Set((suppressed.data ?? []).map((s) => s.domain?.toLowerCase()).filter(Boolean));
  const isBlocked = (email: string | null) =>
    Boolean(email) && (blockedEmails.has(email!.toLowerCase()) || blockedDomains.has(email!.split("@")[1]?.toLowerCase()));
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
          <div><dt className="text-neutral-500">CNPJ</dt><dd>{company.cnpj ? formatCnpj(company.cnpj) : "—"}</dd></div>
          <div><dt className="text-neutral-500">CNAE</dt><dd>{company.cnae ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Localização</dt><dd>{[municipio.data?.name, company.state_code].filter(Boolean).join(" / ") || "—"}</dd></div>
          <div><dt className="text-neutral-500">Tipo</dt><dd>{company.kind === "customer" ? "Cliente" : "Prospect"}</dd></div>
          <div><dt className="text-neutral-500">Segmento</dt><dd>{company.segment ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Origem do dado</dt><dd>{company.source ?? "—"}{company.source_date ? ` (${company.source_date})` : ""}</dd></div>
        </dl>
      </div>

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
        {!contacts.error && contacts.data?.length === 0 && <EmptyState title="Nenhum contato cadastrado" />}
        <ul className="flex flex-col gap-3">
          {(contacts.data ?? []).map((c) => {
            const blocked = c.opted_out_at || isBlocked(c.email);
            return (
              <li key={c.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.role_title && <span className="text-neutral-500">· {c.role_title}</span>}
                  {blocked && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                      Comunicação bloqueada
                    </span>
                  )}
                </div>
                <p>{[c.email, c.phone].filter(Boolean).join(" · ") || "Sem e-mail ou telefone"}</p>
                <p className="text-neutral-500">
                  {LEGAL_BASIS_LABELS[c.legal_basis as keyof typeof LEGAL_BASIS_LABELS] ?? "Base legal não informada"}
                  {c.consent_at ? ` · consentimento em ${new Date(c.consent_at).toLocaleString("pt-BR")}` : ""}
                  {c.opted_out_at ? ` · oposição em ${new Date(c.opted_out_at).toLocaleString("pt-BR")}` : ""}
                  {c.source ? ` · origem: ${c.source}` : ""}
                </p>
                {writable && (
                  <div className="mt-2 flex gap-4">
                    {!c.opted_out_at && (
                      <form action={optOutContact}>
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="company_id" value={companyId} />
                        <input type="hidden" name="contact_id" value={c.id} />
                        <button className="underline">Registrar oposição (não contatar)</button>
                      </form>
                    )}
                    <form action={deleteContact}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="contact_id" value={c.id} />
                      <button className="text-red-700 underline" aria-label={`Excluir dados de ${c.name}`}>
                        Excluir dados
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-neutral-500">
          A exclusão apaga os dados do contato. Se houver oposição registrada, o e-mail continua na lista de supressão para que não volte a ser contatado.
        </p>
      </section>
    </div>
  );
}
