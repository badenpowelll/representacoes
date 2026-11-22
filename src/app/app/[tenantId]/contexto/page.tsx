import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui";
import { ContextForm } from "./form";

export const metadata = { title: "Contexto comercial · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("commercial_contexts").select("*").eq("tenant_id", tenantId).maybeSingle();
  const current = {
    segments: (data?.segments ?? []).join(", "),
    cnaes: (data?.cnaes ?? []).join(", "),
    ideal_customer: data?.ideal_customer ?? "",
    differentiators: data?.differentiators ?? "",
    restrictions: data?.restrictions ?? "",
    communication_tone: data?.communication_tone ?? "",
    goals: data?.goals ?? "",
  };
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Contexto comercial</h1>
      <p className="max-w-3xl text-neutral-600 dark:text-neutral-400">
        Estas informações orientam o motor de compatibilidade e, nas próximas fases, as mensagens sugeridas pelo agente.
      </p>
      {error && <Alert kind="error">Não foi possível carregar o contexto.</Alert>}
      <ContextForm tenantId={tenantId} current={current} readOnly={!can(ctx.role, "catalog.write")} />
    </div>
  );
}
