import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ImportKind } from "@/lib/importacao/fields";

const STATUS: Record<string, string> = { running: "Em andamento", completed: "Concluída", failed: "Interrompida" };
const when = (v: string) =>
  new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Últimas importações da representação (só números; nenhum conteúdo das planilhas). */
export async function ImportHistory({ tenantId, kind }: { tenantId: string; kind: ImportKind }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_imports")
    .select("id, file_name, status, source, total_rows, created_count, updated_count, unchanged_count, error_count, contacts_created, created_at, industries(name)")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data?.length) return null;
  return (
    <section aria-labelledby="historico" className="flex flex-col gap-2">
      <h2 id="historico" className="font-medium">Importações anteriores</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Quando</th>
              <th className="py-2 pr-4">Arquivo</th>
              {kind === "products" && <th className="py-2 pr-4">Indústria</th>}
              <th className="py-2 pr-4">Origem</th>
              <th className="py-2 pr-4">Linhas</th>
              <th className="py-2 pr-4">Incluídos / atualizados / sem alteração / erros</th>
              <th className="py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {data.map((i) => (
              <tr key={i.id} className="border-b">
                <td className="py-2 pr-4">{when(i.created_at as string)}</td>
                <td className="py-2 pr-4">{i.file_name as string}</td>
                {kind === "products" && <td className="py-2 pr-4">{(i.industries as unknown as { name: string } | null)?.name ?? "—"}</td>}
                <td className="py-2 pr-4">{i.source as string}</td>
                <td className="py-2 pr-4">{i.total_rows as number}</td>
                <td className="py-2 pr-4">
                  {i.created_count} / {i.updated_count} / {i.unchanged_count} / {i.error_count}
                  {kind === "companies" && (i.contacts_created as number) > 0 ? ` · ${i.contacts_created} contato(s)` : ""}
                </td>
                <td className="py-2">{STATUS[i.status as string] ?? i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
