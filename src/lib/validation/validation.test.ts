import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj } from "./cnpj";
import { companySchema, dealSchema, industrySchema, moveDealSchema, optionalMunicipality } from "./schemas";

describe("CNPJ", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });
  it("formata", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("schemas", () => {
  it("indústria normaliza CNPJ e campos vazios", () => {
    const r = industrySchema.parse({ name: " Metalúrgica ", cnpj: "11.222.333/0001-81", segment: "", website: "" });
    expect(r).toEqual({ name: "Metalúrgica", cnpj: "11222333000181", segment: null, website: null });
  });
  it("indústria rejeita CNPJ inválido e site sem protocolo", () => {
    expect(industrySchema.safeParse({ name: "X Y", cnpj: "11222333000100" }).success).toBe(false);
    expect(industrySchema.safeParse({ name: "X Y", website: "exemplo.com" }).success).toBe(false);
  });
  it("empresa exige origem do dado", () => {
    expect(companySchema.safeParse({ legal_name: "Loja", source: "" }).success).toBe(false);
    expect(companySchema.parse({ legal_name: "Loja", source: "indicação", state_code: "RN" }).kind).toBe("prospect");
  });
  it("valor do deal aceita formato brasileiro", () => {
    const r = dealSchema.parse({ title: "Pedido", company_id: "6f1c1e0a-3b7a-4c55-9d43-6f0b8f2d9a11", amount: "15.000,50" });
    expect(r.amount).toBe(15000.5);
  });
  it("perda exige motivo", () => {
    const id = "6f1c1e0a-3b7a-4c55-9d43-6f0b8f2d9a11";
    expect(moveDealSchema.safeParse({ deal_id: id, stage: "lost", lost_reason: "" }).success).toBe(false);
    expect(moveDealSchema.safeParse({ deal_id: id, stage: "lost", lost_reason: "preço" }).success).toBe(true);
  });
});

describe("município opcional", () => {
  it("vazio vira null e código válido vira número", () => {
    expect(optionalMunicipality.parse("")).toBeNull();
    expect(optionalMunicipality.parse(undefined)).toBeNull();
    expect(optionalMunicipality.parse("2408102")).toBe(2408102);
  });
  it("rejeita código fora do formato IBGE", () => {
    expect(optionalMunicipality.safeParse("123").success).toBe(false);
    expect(optionalMunicipality.safeParse("24081O2").success).toBe(false);
  });
});
