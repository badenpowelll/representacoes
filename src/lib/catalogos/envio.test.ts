import { describe, expect, it } from "vitest";
import { CATALOG_TEMPLATES, finalMessage, linkExpiry, previewMessage } from "./envio";

describe("envio de catálogo", () => {
  it("pré-visualiza sem trocar o link", () => {
    const t = previewMessage(CATALOG_TEMPLATES.whatsapp.body, { empresa: "Clínica X", catalogo: "Linha 2027", link_catalogo: "x" });
    expect(t).toContain("Olá, Clínica X!");
    expect(t).toContain("{{link_catalogo}}");
  });
  it("insere link e linha de oposição; acrescenta o link se faltar", () => {
    expect(finalMessage("Veja {{link_catalogo}}", "https://l")).toBe("Veja https://l\n\nSe não quiser receber novos contatos nossos, basta responder SAIR.");
    expect(finalMessage("Olá", "https://l")).toContain("Olá\n\nhttps://l");
  });
  it("validade do link só nas opções permitidas", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(linkExpiry(7, now).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(linkExpiry(999, now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
