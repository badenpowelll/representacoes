import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { recompute, review } from "./actions";

export const metadata = { title: "Compatibilidade · Rep360" };

const REVIEW_LABEL = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado" } as const;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ industria?: string }>;
}) {
  const { tenantId } = await params;
  const { industria } = await searchParams;
  const ctx = await requireTenantPage(tenantId);
  const writable = can(ctx.role, "deals.write");
  const supabase = await createSupabaseServerClient();
  const { data: industries } = await supabase.from("industries").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name");
  const selected = industries?.find((i) => i.id === industria) ?? industries?.[0];
  const { data: matches, error } = selected
    ? await supabase
        .from("matches")
        .select("id, score, reasons, review, companies(legal_name, state_code, cnae)")
        .eq("tenant_id", tenantId)
        .eq("industry_id", selected.id)
        .order("score", { ascending: false })
        .limit(200)
    : { data: [], error: null };
  type Reason = { criterion: string; points: number; detail: string };
  type Row = { id: string; score: number; reasons: Reason[]; review: keyof typeof REVIEW_LABEL; companies: { legal_name: string; state_code: string | null; cnae: string | null } | null };
  const rows = (matches ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Compatibilidade</h1>
      <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
        Pontuação explicável: território da indústria (40, obrigatório), CNAE-alvo (30), segmento (20) e contato com e-mail apto e
        fora da lista de supressão (10). Toda sugestão passa por revisão humana; aprovar cria um lead qualificado.
      </p>
      {!industries?.length ? (
        <EmptyState title="Cadastre uma indústria e seus territórios para calcular compatibilidade" />
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <form className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="industria" className="text-sm font-medium">
                Indústria
              </label>
              <select id="industria" name="industria" defaultValue={selected?.id} className="rounded-md border px-3 py-2">
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="rounded-md border px-3 py-2">Ver</button>
          </form>
          {writable && selected && (
            <form action={recompute}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="industry_id" value={selected.id} />
              <button className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white">Calcular compatibilidade</button>
            </form>
          )}
        </div>
      )}
      {error && <Alert kind="error">Não foi possível carregar os resultados.</Alert>}
      {selected && rows.length === 0 && !error && <EmptyState title="Nenhum resultado ainda. Clique em Calcular compatibilidade." />}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {m.companies?.legal_name} <span className="text-sm text-neutral-500">{m.companies?.state_code}</span>
                </p>
                <p>
                  <strong className="text-lg">{m.score}</strong>/100 · {REVIEW_LABEL[m.review]}
                </p>
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                {m.reasons.map((r) => (
                  <li key={r.criterion}>
                    {r.detail} (+{r.points})
                  </li>
                ))}
              </ul>
              {writable && m.review === "pending" && (
                <div className="mt-3 flex gap-2">
                  {(["approved", "rejected"] as const).map((d) => (
                    <form key={d} action={review}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="match_id" value={m.id} />
                      <input type="hidden" name="decision" value={d} />
                      <button className="rounded-md border px-3 py-1 text-sm">{d === "approved" ? "Aprovar e criar lead" : "Rejeitar"}</button>
                    </form>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
