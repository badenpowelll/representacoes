import { describe, expect, it } from "vitest";
import {
  buildMailto,
  buildWhatsAppUrl,
  DEFAULT_TEMPLATES,
  formatPhone,
  isMobile,
  normalizePhone,
  renderTemplate,
  unresolvedVariables,
  withOptOut,
} from "./messages";
import { formatCnae, parseCnaeList, PROSPECT_PRESETS } from "./presets";

describe("modelos", () => {
  it("substitui variáveis e mantém as que faltam", () => {
    expect(renderTemplate("Olá {{empresa}}, de {{ cidade }}/{{uf}}", { empresa: "Hospital X", cidade: "Natal" })).toBe("Olá Hospital X, de Natal/{{uf}}");
    expect(unresolvedVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("os modelos padrão só usam variáveis conhecidas", () => {
    const vars = { empresa: "E", nome_fantasia: "F", cidade: "C", uf: "RN", industria: "I", representacao: "R", remetente: "S" };
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      expect(unresolvedVariables(renderTemplate(`${t.subject ?? ""} ${t.body}`, vars))).toEqual([]);
    }
  });

  it("acrescenta a linha de oposição só quando falta", () => {
    expect(withOptOut("Olá")).toMatch(/responder SAIR\.$/);
    expect(withOptOut("Responda SAIR para não receber")).toBe("Responda SAIR para não receber");
  });
});

describe("links", () => {
  it("mailto codifica assunto e corpo", () => {
    expect(buildMailto("compras@h.test", "Catálogo & preços", "linha 1\nlinha 2")).toBe(
      "mailto:compras@h.test?subject=Cat%C3%A1logo%20%26%20pre%C3%A7os&body=linha%201%0Alinha%202",
    );
  });

  it("wa.me com DDI 55 e telefone normalizado", () => {
    expect(buildWhatsAppUrl("(84) 99999-0000", "Olá!")).toBe("https://wa.me/5584999990000?text=Ol%C3%A1!");
    expect(buildWhatsAppUrl("+55 84 99999 0000", "x")).toBe("https://wa.me/5584999990000?text=x");
    expect(buildWhatsAppUrl("123", "x")).toBeNull();
  });

  it("telefones", () => {
    expect(normalizePhone("084 3200-0000")).toBe("8432000000");
    expect(formatPhone("84999990000")).toBe("(84) 99999-0000");
    expect(formatPhone("8432000000")).toBe("(84) 3200-0000");
    expect(isMobile("84999990000")).toBe(true);
    expect(isMobile("8432000000")).toBe(false);
  });
});

describe("CNAEs", () => {
  it("aceita códigos com máscara, ignora repetidos e aponta inválidos", () => {
    expect(parseCnaeList("8610-1/01, 8630503;8630503 abc 123")).toEqual({ codes: ["8610101", "8630503"], invalid: ["abc", "123"] });
    expect(formatCnae("8610101")).toBe("8610-1/01");
  });
  it("perfil de material hospitalar tem códigos válidos e sem repetição", () => {
    const p = PROSPECT_PRESETS.find((x) => x.key === "material-hospitalar")!;
    expect(new Set(p.cnaes).size).toBe(p.cnaes.length);
    expect(p.cnaes.every((c) => /^\d{7}$/.test(c))).toBe(true);
  });
});
