/**
 * Fluxo de envio de catálogo com compensação:
 *   1. cria o catálogo; 2. envia o PDF; 3. registra a versão 1.
 * Se 2 ou 3 falham, desfaz o que foi criado (objeto e catálogo). Se a própria
 * limpeza falhar, o resultado informa `orphan` para reconciliação posterior
 * (ver `public.orphan_catalog_objects`). Nunca registra segredos nos logs.
 */
export type UploadPorts = {
  insertCatalog(): Promise<{ id: string } | { error: string }>;
  deleteCatalog(id: string): Promise<{ error?: string }>;
  putObject(path: string, bytes: Uint8Array): Promise<{ error?: string }>;
  removeObject(path: string): Promise<{ error?: string }>;
  insertVersion(catalogId: string, path: string): Promise<{ error?: string }>;
  newId(): string;
  log?(event: string, data: Record<string, unknown>): void;
};

export type UploadResult =
  | { ok: true; catalogId: string; path: string }
  | { ok: false; stage: "catalog" | "object" | "version"; error: string; orphan?: { catalogId?: string; path?: string } };

export async function storeCatalogUpload(tenantId: string, bytes: Uint8Array, ports: UploadPorts): Promise<UploadResult> {
  const created = await ports.insertCatalog();
  if ("error" in created) return { ok: false, stage: "catalog", error: created.error };
  const catalogId = created.id;
  const path = `${tenantId}/${catalogId}/v1-${ports.newId()}.pdf`;

  const put = await ports.putObject(path, bytes);
  if (put.error) {
    const del = await ports.deleteCatalog(catalogId);
    if (del.error) ports.log?.("catalog.cleanup_failed", { tenantId, catalogId, stage: "object" });
    return { ok: false, stage: "object", error: put.error, orphan: del.error ? { catalogId } : undefined };
  }

  const ver = await ports.insertVersion(catalogId, path);
  if (ver.error) {
    const rm = await ports.removeObject(path);
    const del = await ports.deleteCatalog(catalogId);
    const orphan = rm.error || del.error ? { path: rm.error ? path : undefined, catalogId: del.error ? catalogId : undefined } : undefined;
    if (orphan) ports.log?.("catalog.cleanup_failed", { tenantId, ...orphan, stage: "version" });
    return { ok: false, stage: "version", error: ver.error, orphan };
  }
  return { ok: true, catalogId, path };
}
