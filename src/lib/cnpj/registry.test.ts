import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchCnpjFromBrasilApi } from "./brasilapi";
import { formatAddress, formatPhone, isInactiveStatus, normalizeBrasilApiCnpj, toRegistryRow } from "./registry";

// Resposta sintética no formato da BrasilAPI (CNPJ de teste, dados fictícios).
const sample = {
  uf: "RN",
  cep: "59000000",
  qsa: [
    {
      pais: null,
      nome_socio: "FULANA DE TAL",
      faixa_etaria: "Entre 41 a 50 anos",
      cnpj_cpf_do_socio: "***123456**",
      qualificacao_socio: "Sócio-Administrador",
      data_entrada_sociedade: "2015-03-10",
      nome_representante_legal: "",
      qualificacao_representante_legal: "Não informada",
    },
    { nome_socio: "", qualificacao_socio: "Sócio" },
  ],
  cnpj: "99999999999999",
  email: "CONTATO@EXEMPLO.COM.BR",
  porte: "MICRO EMPRESA",
  bairro: "CENTRO",
  numero: "100",
  municipio: "NATAL",
  logradouro: "DAS FLORES",
  cnae_fiscal: 4744001,
  complemento: "SALA 2",
  razao_social: "  EMPRESA EXEMPLO LTDA ",
  nome_fantasia: "EXEMPLO",
  capital_social: 50000,
  ddd_telefone_1: "8432221234",
  ddd_telefone_2: "84999998888",
  opcao_pelo_mei: false,
  cnaes_secundarios: [
    { codigo: 4672900, descricao: "Comércio atacadista de ferragens" },
    { codigo: 0, descricao: "" },
  ],
  natureza_juridica: "Sociedade Empresária Limitada",
  opcao_pelo_simples: true,
  cnae_fiscal_descricao: "Comércio varejista de ferragens e ferramentas",
  codigo_municipio_ibge: 2408102,
  data_inicio_atividade: "2015-03-10",
  data_situacao_cadastral: "2015-03-10",
  descricao_situacao_cadastral: "ATIVA",
  descricao_tipo_de_logradouro: "RUA",
  identificador_matriz_filial: 1,
  ignorado: "<script>",
};

describe("normalizeBrasilApiCnpj", () => {
  const d = normalizeBrasilApiCnpj(sample, "11444777000161");

  it("usa sempre o CNPJ pedido, não o da resposta", () => {
    expect(d.cnpj).toBe("11444777000161");
  });

  it("extrai identificação, situação, CNAEs e endereço", () => {
    expect(d).toMatchObject({
      legalName: "EMPRESA EXEMPLO LTDA",
      tradeName: "EXEMPLO",
      registrationStatus: "ATIVA",
      mainCnae: "4744001",
      stateCode: "RN",
      municipalityId: 2408102,
      email: "contato@exemplo.com.br",
      simplesOptIn: true,
      meiOptIn: false,
      isHeadquarters: true,
      shareCapital: 50000,
    });
    expect(d.secondaryCnaes).toEqual([{ code: "4672900", description: "Comércio atacadista de ferragens" }]);
    expect(formatAddress(d.address)).toBe("RUA DAS FLORES, 100 · SALA 2 · CENTRO · NATAL/RN · CEP 59000-000");
  });

  it("traz telefones e sócios (descartando sócio sem nome)", () => {
    expect(d.phones).toEqual(["8432221234", "84999998888"]);
    expect(d.phones.map(formatPhone)).toEqual(["(84) 3222-1234", "(84) 99999-8888"]);
    expect(d.partners).toHaveLength(1);
    expect(d.partners[0]).toMatchObject({ name: "FULANA DE TAL", role: "Sócio-Administrador", document: "***123456**", since: "2015-03-10" });
  });

  it("descarta valores fora do formato (UF, IBGE, e-mail, telefone)", () => {
    const bad = normalizeBrasilApiCnpj(
      { ...sample, uf: "XX", codigo_municipio_ibge: 12, email: "não é email", ddd_telefone_1: "123", ddd_telefone_2: null, cnae_fiscal: "8299-7/99" },
      "11444777000161",
    );
    expect(bad).toMatchObject({ stateCode: null, municipalityId: null, email: null, phones: [], mainCnae: "8299799" });
  });

  it("recusa resposta sem razão social", () => {
    expect(() => normalizeBrasilApiCnpj({ ...sample, razao_social: "" }, "11444777000161")).toThrow();
  });

  it("linha do banco guarda o JSON bruto e os campos normalizados", () => {
    const row = toRegistryRow(d, sample);
    expect(row.raw).toBe(sample);
    expect(row.partners).toHaveLength(1);
  });
});

describe("isInactiveStatus", () => {
  it("só ATIVA não alerta", () => {
    expect(isInactiveStatus("ATIVA")).toBe(false);
    expect(isInactiveStatus("BAIXADA")).toBe(true);
    expect(isInactiveStatus(null)).toBe(false);
  });
});

describe("fetchCnpjFromBrasilApi", () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("chama a URL da BrasilAPI só com dígitos", async () => {
    const f = respond(200, sample);
    const r = await fetchCnpjFromBrasilApi("11444777000161", f);
    expect(r.ok).toBe(true);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://brasilapi.com.br/api/cnpj/v1/11444777000161");
  });

  it("mapeia erros para motivos genéricos", async () => {
    expect(await fetchCnpjFromBrasilApi("11444777000161", respond(404, {}))).toEqual({ ok: false, reason: "not_found" });
    expect(await fetchCnpjFromBrasilApi("11444777000161", respond(429, {}))).toEqual({ ok: false, reason: "rate_limited" });
    expect(await fetchCnpjFromBrasilApi("11444777000161", respond(500, {}))).toEqual({ ok: false, reason: "unavailable" });
    expect(await fetchCnpjFromBrasilApi("11444777000161", respond(200, "não é json"))).toEqual({ ok: false, reason: "invalid_response" });
    const boom = vi.fn(async () => {
      throw new Error("rede");
    }) as unknown as typeof fetch;
    expect(await fetchCnpjFromBrasilApi("11444777000161", boom)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("não chama a API para entrada fora do formato", async () => {
    const f = respond(200, sample);
    expect(await fetchCnpjFromBrasilApi("../../x", f)).toEqual({ ok: false, reason: "not_found" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("cnpjApiBaseUrl", async () => {
  const { cnpjApiBaseUrl } = await import("./brasilapi");
  it("só aceita servidor simulado em localhost no ambiente de desenvolvimento", () => {
    const real = "https://brasilapi.com.br/api/cnpj/v1/";
    expect(cnpjApiBaseUrl({})).toBe(real);
    expect(cnpjApiBaseUrl({ CNPJ_API_BASE_URL: "http://127.0.0.1:4010/cnpj" })).toBe("http://127.0.0.1:4010/cnpj/");
    expect(cnpjApiBaseUrl({ CNPJ_API_BASE_URL: "http://127.0.0.1:4010/", APP_ENV: "production" })).toBe(real);
    expect(cnpjApiBaseUrl({ CNPJ_API_BASE_URL: "https://evil.example/" })).toBe(real);
  });
});
