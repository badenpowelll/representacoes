import { describe, expect, it } from "vitest";
import { mergeTemplates, withSignature } from "./templates";
import { OPT_OUT_LINE } from "@/lib/prospeccao/messages";

describe("modelos da representação", () => {
  it("usa o padrão da representação por cima do sistema", () => {
    const t = mergeTemplates([{ purpose: "catalogo", channel: "email", subject: "Nosso catálogo", body: "Texto próprio da Quindin" }], " Ana\nQuindin ");
    expect(t.catalogo.email).toEqual({ subject: "Nosso catálogo", body: "Texto próprio da Quindin" });
    expect(t.prospeccao.email.body).toContain("{{empresa}}");
    expect(t.signature).toBe("Ana\nQuindin");
  });
  it("assinatura entra uma vez, antes da linha de oposição", () => {
    expect(withSignature(`Olá\n\n${OPT_OUT_LINE}`, "Ana")).toBe(`Olá\n\nAna\n\n${OPT_OUT_LINE}`);
    expect(withSignature("Olá\nAna", "Ana")).toBe("Olá\nAna");
    expect(withSignature("Olá", null)).toBe("Olá");
  });
});
