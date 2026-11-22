import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj } from "./cnpj";
import { companySchema, dealSchema, industrySchema, moveDealSchema, optionalMunicipality, contactSchema, productSchema, prospectSchema, territorySchema } from "./schemas";

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

describe("contato (LGPD)", () => {
  const base = { company_id: "6f1c1e0a-3b7a-4c55-9d43-6f0b8f2d9a11", name: "Ana", source: "feira", legal_basis: "legitimate_interest" };
  it("exige origem e base legal", () => {
    expect(contactSchema.safeParse({ ...base, source: "" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...base, legal_basis: "" }).success).toBe(false);
    expect(contactSchema.parse(base).consent).toBe(false);
  });
  it("base consentimento exige a confirmação", () => {
    const r = contactSchema.safeParse({ ...base, legal_basis: "consent" });
    expect(r.success).toBe(false);
    expect(contactSchema.parse({ ...base, legal_basis: "consent", consent: "on" }).consent).toBe(true);
  });
  it("valida e-mail e telefone", () => {
    expect(contactSchema.safeParse({ ...base, email: "x@" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...base, phone: "abc" }).success).toBe(false);
    expect(contactSchema.parse({ ...base, email: "", phone: "(84) 99999-0000" }).email).toBeNull();
  });
});

describe("produto", () => {
  const base = { industry_id: "6f1c1e0a-3b7a-4c55-9d43-6f0b8f2d9a11", sku: "CIM-50", name: "Cimento 50 kg" };
  it("preço é opcional e aceita formato brasileiro", () => {
    expect(productSchema.parse(base).authorized_price).toBeNull();
    expect(productSchema.parse({ ...base, authorized_price: "1.234,56" }).authorized_price).toBe(1234.56);
    expect(productSchema.parse({ ...base, authorized_price: "39,9" }).authorized_price).toBe(39.9);
  });
  it("rejeita preço malformado e vigência sem preço", () => {
    expect(productSchema.safeParse({ ...base, authorized_price: "12.34.5" }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, authorized_price: "-3" }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, price_valid_until: "2027-01-31" }).success).toBe(false);
  });
});

describe("prospecção manual", () => {
  const base = { industry_id: "6f1c1e0a-3b7a-4c55-9d43-6f0b8f2d9a11", legal_name: "Loja", source: "site da empresa", source_date: "2026-11-01" };
  it("exige fonte e data não futura", () => {
    expect(prospectSchema.safeParse(base).success).toBe(true);
    expect(prospectSchema.safeParse({ ...base, source: "" }).success).toBe(false);
    expect(prospectSchema.safeParse({ ...base, source_date: "" }).success).toBe(false);
    expect(prospectSchema.safeParse({ ...base, source_date: "2999-01-01" }).success).toBe(false);
  });
  it("UF e município opcionais", () => {
    const r = prospectSchema.parse({ ...base, state_code: "", municipality_id: "" });
    expect(r.state_code).toBeNull();
    expect(r.municipality_id).toBeNull();
    expect(prospectSchema.parse({ ...base, state_code: "RN", municipality_id: "2408102" }).municipality_id).toBe(2408102);
  });
});

describe("territorySchema (abrangência explícita)", () => {
  const base = { industry_id: "11111111-1111-4111-8111-111111111111", state_code: "RN", membership_id: "" };
  const err = (input: Record<string, unknown>) => {
    const r = territorySchema.safeParse(input);
    return r.success ? null : r.error.issues.map((i) => `${String(i.path[0])}:${i.message}`);
  };
  it("exige escolher UF inteira ou município", () => {
    expect(err(base)?.[0]).toMatch(/^coverage:/);
  });
  it("UF inteira não aceita município", () => {
    expect(territorySchema.parse({ ...base, coverage: "state", municipio_status: "loading" }).municipality_id).toBeNull();
    expect(err({ ...base, coverage: "state", municipality_id: "2408003" })?.[0]).toMatch(/^municipality_id:/);
  });
  it("município exige lista carregada e município escolhido", () => {
    expect(err({ ...base, coverage: "municipality", municipio_status: "loading", municipality_id: "" })?.[0]).toMatch(/não carregou/);
    expect(err({ ...base, coverage: "municipality", municipio_status: "failed" })?.[0]).toMatch(/não carregou/);
    expect(err({ ...base, coverage: "municipality" })?.[0]).toMatch(/não carregou/);
    expect(err({ ...base, coverage: "municipality", municipio_status: "ready", municipality_id: "" })?.[0]).toMatch(/Selecione o município/);
    const ok = territorySchema.parse({ ...base, coverage: "municipality", municipio_status: "ready", municipality_id: "2408003" });
    expect(ok).toEqual({ industry_id: base.industry_id, state_code: "RN", municipality_id: 2408003, membership_id: null, exclusive: false });
  });
});
