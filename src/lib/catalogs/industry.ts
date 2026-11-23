/**
 * Indústria do catálogo: existente (id) ou criada na hora, no mesmo envio.
 * Se o envio do catálogo falhar depois de criar a indústria, ela é removida,
 * para o usuário poder tentar de novo sem ficar com cadastro pela metade.
 */
export const NEW_INDUSTRY = "nova";

export type IndustryPorts = {
  insertIndustry(): Promise<{ id: string } | { error: string }>;
  deleteIndustry(id: string): Promise<{ error?: string }>;
  log?(event: string, data: Record<string, unknown>): void;
};

export type WithIndustryResult<T> =
  | { ok: true; industryId: string; created: boolean; value: T }
  | { ok: false; stage: "industry" | "upload"; error: string };

export async function withCatalogIndustry<T>(
  choice: { existingId: string } | { create: true },
  ports: IndustryPorts,
  upload: (
    industryId: string,
  ) => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
): Promise<WithIndustryResult<T>> {
  let industryId: string;
  let created = false;
  if ("existingId" in choice) {
    industryId = choice.existingId;
  } else {
    const ins = await ports.insertIndustry();
    if ("error" in ins)
      return { ok: false, stage: "industry", error: ins.error };
    industryId = ins.id;
    created = true;
  }
  const res = await upload(industryId);
  if (res.ok) return { ok: true, industryId, created, value: res.value };
  if (created) {
    const del = await ports.deleteIndustry(industryId);
    if (del.error) ports.log?.("industry.cleanup_failed", { industryId });
  }
  return { ok: false, stage: "upload", error: res.error };
}
