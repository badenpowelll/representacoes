import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";

export const metadata = { title: "Envios · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, channel, created_at, link_expires_at, campaign_recipients(status)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  type Row = { id: string; name: string; channel: string; created_at: string; link_expires_at: string; campaign_recipients: { status: string }[] };
  const rows = (data ?? []) as unknown as Row[];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Envios de catálogo</h1>
      <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
        Para enviar um catálogo a vários clientes de uma vez, publique-o em{" "}
        <Link href={`/app/${tenantId}/catalogos`} className="underline">Catálogos</Link> e clique em &quot;Enviar para clientes&quot;.
      </p>
      {error && <Alert kind="error">Não foi possível carregar os envios.</Alert>}
      {!error && rows.length === 0 && <EmptyState title="Nenhum envio ainda" />}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const n = (s: string) => r.campaign_recipients.filter((x) => x.status === s).length;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm">
              <span>
                <Link href={`/app/${tenantId}/envios/${r.id}`} className="font-medium underline">{r.name}</Link>{" "}
                <span className="text-neutral-500">· {r.channel === "email" ? "E-mail" : "WhatsApp"} · {new Date(r.created_at).toLocaleDateString("pt-BR")}</span>
              </span>
              <span>{n("sent")} enviado(s) · {n("pending")} na fila · {n("blocked")} bloqueado(s)</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
