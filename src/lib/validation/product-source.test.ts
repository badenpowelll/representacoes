import { describe, expect, it } from "vitest";
import { productSourceSchema } from "./schemas";

const IND = "6f1c7c1e-4a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("productSourceSchema", () => {
  it("aceita página de produtos http(s) e limpa campos vazios", () => {
    const r = productSourceSchema.parse({ industry_id: IND, url: " https://www.nutriex.com.br/produtos.php ", label: "", link_pattern: "" });
    expect(r).toEqual({ industry_id: IND, mode: "list", url: "https://www.nutriex.com.br/produtos.php", label: null, link_pattern: null });
    expect(productSourceSchema.parse({ industry_id: IND, url: "https://www.petribu.com.br/alcoolsaneantes", mode: "watch" }).mode).toBe("watch");
    expect(productSourceSchema.safeParse({ industry_id: IND, url: "https://x.com.br/p", mode: "outro" }).success).toBe(false);
  });
  it("recusa endereço sem protocolo, javascript: e padrão inválido", () => {
    expect(productSourceSchema.safeParse({ industry_id: IND, url: "nutriex.com.br" }).success).toBe(false);
    expect(productSourceSchema.safeParse({ industry_id: IND, url: "javascript:alert(1)" }).success).toBe(false);
    expect(productSourceSchema.safeParse({ industry_id: IND, url: "https://x.com.br/p", link_pattern: "([" }).success).toBe(false);
  });
});
