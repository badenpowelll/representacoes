import { describe, expect, it, vi } from "vitest";
import { withCatalogIndustry, type IndustryPorts } from "./industry";

function ports(over: Partial<IndustryPorts> = {}) {
  const industries = new Set<string>();
  const base: IndustryPorts = {
    insertIndustry: async () => (industries.add("ind-1"), { id: "ind-1" }),
    deleteIndustry: async (id) => (industries.delete(id), {}),
    log: vi.fn(),
  };
  return { industries, ports: { ...base, ...over } };
}

describe("withCatalogIndustry", () => {
  it("usa a indústria existente sem criar outra", async () => {
    const { industries, ports: p } = ports();
    const upload = vi.fn(async () => ({ ok: true as const, value: "cat" }));
    const r = await withCatalogIndustry({ existingId: "ind-x" }, p, upload);
    expect(r).toEqual({
      ok: true,
      industryId: "ind-x",
      created: false,
      value: "cat",
    });
    expect(upload).toHaveBeenCalledWith("ind-x");
    expect(industries.size).toBe(0);
  });

  it("cria a indústria na hora e envia o catálogo vinculado a ela", async () => {
    const { industries, ports: p } = ports();
    const r = await withCatalogIndustry({ create: true }, p, async (id) => ({
      ok: true,
      value: id,
    }));
    expect(r).toEqual({
      ok: true,
      industryId: "ind-1",
      created: true,
      value: "ind-1",
    });
    expect([...industries]).toEqual(["ind-1"]);
  });

  it("se o envio falhar, remove a indústria recém-criada", async () => {
    const { industries, ports: p } = ports();
    const r = await withCatalogIndustry({ create: true }, p, async () => ({
      ok: false,
      error: "storage fora",
    }));
    expect(r).toEqual({ ok: false, stage: "upload", error: "storage fora" });
    expect(industries.size).toBe(0);
  });

  it("não apaga indústria existente quando o envio falha", async () => {
    const deleteIndustry = vi.fn(async () => ({}));
    const { ports: p } = ports({ deleteIndustry });
    await withCatalogIndustry({ existingId: "ind-x" }, p, async () => ({
      ok: false,
      error: "x",
    }));
    expect(deleteIndustry).not.toHaveBeenCalled();
  });

  it("erro ao criar a indústria não tenta enviar o arquivo", async () => {
    const upload = vi.fn();
    const { ports: p } = ports({
      insertIndustry: async () => ({ error: "Já existe" }),
    });
    const r = await withCatalogIndustry({ create: true }, p, upload);
    expect(r).toEqual({ ok: false, stage: "industry", error: "Já existe" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("registra evento se a limpeza da indústria falhar", async () => {
    const log = vi.fn();
    const { ports: p } = ports({
      deleteIndustry: async () => ({ error: "x" }),
      log,
    });
    await withCatalogIndustry({ create: true }, p, async () => ({
      ok: false,
      error: "y",
    }));
    expect(log).toHaveBeenCalledWith("industry.cleanup_failed", {
      industryId: "ind-1",
    });
  });
});
