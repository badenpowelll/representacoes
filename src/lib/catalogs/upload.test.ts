import { describe, expect, it, vi } from "vitest";
import { storeCatalogUpload, type UploadPorts } from "./upload";

function ports(overrides: Partial<UploadPorts> = {}) {
  const state = { catalogs: new Set<string>(), objects: new Set<string>(), versions: [] as string[] };
  const base: UploadPorts = {
    insertCatalog: async () => (state.catalogs.add("cat-1"), { id: "cat-1" }),
    deleteCatalog: async (id) => (state.catalogs.delete(id), {}),
    putObject: async (p) => (state.objects.add(p), {}),
    removeObject: async (p) => (state.objects.delete(p), {}),
    insertVersion: async (_c, p) => (state.versions.push(p), {}),
    newId: () => "u1",
    log: vi.fn(),
  };
  return { state, ports: { ...base, ...overrides } as UploadPorts };
}
const pdf = new Uint8Array([37, 80, 68, 70, 45]);

describe("storeCatalogUpload", () => {
  it("caminho feliz cria catálogo, objeto e versão no prefixo do tenant", async () => {
    const { state, ports: p } = ports();
    const r = await storeCatalogUpload("t1", pdf, p);
    expect(r).toEqual({ ok: true, catalogId: "cat-1", path: "t1/cat-1/v1-u1.pdf" });
    expect([...state.objects]).toEqual(["t1/cat-1/v1-u1.pdf"]);
  });

  it("falha ao registrar a versão remove o objeto e o catálogo (sem órfãos)", async () => {
    const { state, ports: p } = ports({ insertVersion: async () => ({ error: "falha injetada" }) });
    const r = await storeCatalogUpload("t1", pdf, p);
    expect(r).toMatchObject({ ok: false, stage: "version", orphan: undefined });
    expect(state.objects.size).toBe(0);
    expect(state.catalogs.size).toBe(0);
  });

  it("falha no upload remove o catálogo", async () => {
    const { state, ports: p } = ports({ putObject: async () => ({ error: "storage fora" }) });
    const r = await storeCatalogUpload("t1", pdf, p);
    expect(r).toMatchObject({ ok: false, stage: "object" });
    expect(state.catalogs.size).toBe(0);
  });

  it("se a limpeza também falhar, informa o órfão e registra evento sem dados sensíveis", async () => {
    const log = vi.fn();
    const { ports: p } = ports({
      insertVersion: async () => ({ error: "falha injetada" }),
      removeObject: async () => ({ error: "falha na limpeza" }),
      log,
    });
    const r = await storeCatalogUpload("t1", pdf, p);
    expect(r).toMatchObject({ ok: false, orphan: { path: "t1/cat-1/v1-u1.pdf" } });
    expect(log).toHaveBeenCalledWith("catalog.cleanup_failed", expect.objectContaining({ tenantId: "t1", stage: "version" }));
  });
});
