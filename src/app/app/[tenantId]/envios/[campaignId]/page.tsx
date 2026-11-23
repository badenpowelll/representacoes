import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui";
import { BLOCK_REASONS, previewMessage } from "@/lib/catalogos/envio";
import { formatPhone, isMobile } from "@/lib/prospeccao/messages";
import { CampaignQueue, type QueueRow } from "./queue";

export const metadata = { title: "Fila de envio · Rep360" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  const { tenantId, campaignId } = await params;
  const ctx = await requireTenantPage(tenantId);
  if (!UUID_RE.test(campaignId)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: campaign }, { data: recips, error }, { data: tenant }, { data: profile }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, channel, subject, body, link_expires_at, created_at, catalog_versions(version, catalogs(title, industries(name)))")
      .eq("tenant_id", tenantId)
      .eq("id", campaignId)
      .maybeSingle(),
    supabase
      .from("campaign_recipients")
      .select("id, status, reason, sent_at, company_id, companies(legal_name, trade_name, state_code, municipality_id), contacts(email, phone)")
      .eq("tenant_id", tenantId)
      .eq("campaign_id", campaignId)
      .order("created_at"),
    supabase.from("tenants").select("name").eq("id", tenantId).single(),
    supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
  ]);
  type Cp = {
    id: string; name: string; channel: "email" | "whatsapp"; subject: string | null; body: string; link_expires_at: string;
    catalog_versions: { version: number; catalogs: { title: string; industries: { name: string } | null } | null } | null;
  };
  const c = campaign as unknown as Cp | null;
  if (!c) notFound();
  type R = {
    id: string; status: QueueRow["status"]; reason: string | null; sent_at: string | null; company_id: string;
    companies: { legal_name: string; trade_name: string | null; state_code: string | null; municipality_id: number | null } | null;
    contacts: { email: string | null; phone: string | null } | null;
  };
  const list = (recips ?? []) as unknown as R[];
  const cityIds = [...new Set(list.map((r) => r.companies?.municipality_id).filter((x): x is number => x != null))];
  const { data: cities } = cityIds.length
    ? await supabase.from("ref_municipalities").select("ibge_code, name").in("ibge_code", cityIds)
    : { data: [] as { ibge_code: number; name: string }[] };
  const base = {
    catalogo: c.catalog_versions?.catalogs?.title ?? "",
    industria: c.catalog_versions?.catalogs?.industries?.name ?? "",
    representacao: tenant?.name ?? "",
    remetente: profile?.full_name ?? "",
  };
  const rows: QueueRow[] = list.map((r) => {
    const empresa = r.companies?.trade_name ?? r.companies?.legal_name ?? "";
    const vars = { ...base, empresa, uf: r.companies?.state_code ?? "", cidade: cities?.find((m) => m.ibge_code === r.companies?.municipality_id)?.name ?? "" };
    const phone = r.contacts?.phone;
    const to = c.channel === "email" ? r.contacts?.email : phone ? `${formatPhone(phone)}${isMobile(phone) ? "" : " (fixo, pode não ter WhatsApp)"}` : null;
    return {
      id: r.id,
      companyId: r.company_id,
      company: empresa,
      to: to ?? null,
      status: r.status,
      reason: r.reason ? (BLOCK_REASONS[r.reason] ?? r.reason) : null,
      subject: c.subject ? previewMessage(c.subject, vars) : "",
      body: previewMessage(c.body, vars),
    };
  });
  const count = (s: QueueRow["status"]) => rows.filter((r) => r.status === s).length;
  const expired = new Date(c.link_expires_at).getTime() < Date.now();

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/app/${tenantId}/envios`} className="text-sm underline">← Envios</Link>
      <div>
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {c.channel === "email" ? "E-mail" : "WhatsApp"} · catálogo {base.catalogo} (v{c.catalog_versions?.version}) · link válido até{" "}
          {new Date(c.link_expires_at).toLocaleDateString("pt-BR")}
        </p>
      </div>
      <p className="text-sm" aria-live="polite">
        <strong>{count("sent")}</strong> enviado(s) · <strong>{count("pending")}</strong> na fila · {count("skipped")} pulado(s) ·{" "}
        {count("blocked")} bloqueado(s)
      </p>
      {expired && <Alert kind="info">O prazo do link deste lote acabou. Para continuar, crie um novo envio do catálogo.</Alert>}
      {error && <Alert kind="error">Não foi possível carregar a fila.</Alert>}
      <CampaignQueue tenantId={tenantId} channel={c.channel} rows={rows} canSend={can(ctx.role, "deals.write") && !expired} />
      <p className="text-xs text-neutral-500">
        Cada clique abre o seu {c.channel === "email" ? "programa de e-mail" : "WhatsApp"} com a mensagem pronta; o envio é seu. Antes de abrir,
        o sistema confere de novo se o contato pode receber (oposição registrada depois do lote bloqueia) e registra no histórico do cliente.
      </p>
    </div>
  );
}
