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
        <section aria-labelledby="lista-industrias" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="lista-industrias" className="font-semibold">
              Suas indústrias
            </h2>
            <span className="text-sm text-neutral-500">
              {data.length} {data.length === 1 ? "indústria" : "indústrias"}
            </span>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.map((i) => {
              const receita = i.cnpj ? receitaByCnpj.get(i.cnpj) : undefined;
              const channels = parseChannels(i.contact_channels);
              const href = `/app/${tenantId}/industrias/${i.id}`;
              const city = receita?.address.city
                ? `${receita.address.city}${receita.address.state ? `/${receita.address.state}` : ""}`
                : null;
              return (
                <li key={i.id} className="flex">
                  <article
                    aria-labelledby={`industria-${i.id}`}
                    className="flex w-full flex-col overflow-hidden rounded-[14px] border bg-white shadow-[0_1px_2px_rgba(0,15,55,0.04),0_8px_28px_rgba(0,15,55,0.06)] transition-shadow hover:shadow-[0_2px_4px_rgba(0,15,55,0.06),0_12px_32px_rgba(0,15,55,0.10)]"
                  >
                    <span aria-hidden="true" className="h-1 bg-argos-navy" />
                    <div className="flex flex-1 flex-col gap-4 p-5">
                      <header className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-argos-tint-navy text-sm font-bold text-argos-navy"
                        >
                          {initials(i.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 id={`industria-${i.id}`} className="text-base leading-tight font-semibold break-words">
                            <Link href={href} className="hover:text-[#c84a00]">
                              {i.name}
                            </Link>
                          </h3>
                          <p className="mt-1 text-xs text-neutral-500 tabular-nums">
                            {i.cnpj ? `CNPJ ${formatCnpj(i.cnpj)}` : "Sem CNPJ"}
                            {city ? ` · ${city}` : ""}
                          </p>
                        </div>
                        {!i.active && (
                          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
                            Inativa
                          </span>
                        )}
                      </header>

                      {i.segment && (
                        <p className="self-start rounded-full bg-argos-tint-orange px-3 py-1 text-xs font-semibold text-[#8a3200]">
                          {i.segment}
                        </p>
                      )}

                      <dl className="flex flex-col gap-2 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-neutral-500">Site</dt>
                          <dd className="min-w-0 break-all">
                            {i.website ? (
                              <a href={i.website} rel="noopener noreferrer" target="_blank" className="underline">
                                {i.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                              </a>
                            ) : (
                              <span className="text-neutral-400">Não informado</span>
                            )}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-neutral-500">Contatos</dt>
                          <dd className="flex min-w-0 flex-col gap-0.5">
                            {channels.length === 0 && <span className="text-neutral-400">Nenhum contato</span>}
                            {channels.slice(0, 3).map((c, k) => (
                              <span key={k} className="break-words">
                                <span className="text-neutral-500">{c.label || CHANNEL_KIND_LABELS[c.kind]}:</span> {c.value}
                              </span>
                            ))}
                            {channels.length > 3 && (
                              <Link href={href} className="text-xs underline">
                                e mais {channels.length - 3}
                              </Link>
                            )}
                          </dd>
                        </div>
                      </dl>

                      {receita && (
                        <details className="rounded-[10px] bg-neutral-50 px-3 py-2 text-sm">
                          <summary className="cursor-pointer font-medium text-argos-navy">
                            Dados da Receita Federal de {i.name}
                          </summary>
                          <div className="mt-2">
                            <ReceitaDetails data={receita} />
                          </div>
                        </details>
                      )}
                    </div>
                    <footer className="border-t px-5 py-3">
                      <Link href={href} className="text-sm font-semibold text-argos-navy hover:text-[#c84a00]">
                        Ver ficha completa <span aria-hidden="true">→</span>
                      </Link>
                    </footer>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function initials(name: string): string {
  const words = name
    .replace(/\b(LTDA|S\.?A\.?|ME|EPP|EIRELI|E|DE|DA|DO|DAS|DOS)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
