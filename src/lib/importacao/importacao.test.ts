import { describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, parseCsv, toCsv } from "./csv";
import { COMPANY_FIELDS, EXTRA, IGNORE, PRODUCT_FIELDS, suggestMapping } from "./fields";
import { normalizeCompanyRow, normalizeProductRow, parseCnpj, parseDate, parseMoney, parsePhones, parseUf } from "./normalize";
import { companyImportOptionsSchema, productImportOptionsSchema } from "./options";
import { applyMapping, dataRows, detectHeaderRow, headersOf } from "./sheet";
import { templateRows } from "./templates";

describe("CSV", () => {
  it("lê ponto e vírgula, aspas e quebra de linha dentro da célula", () => {
    const text = 'CNPJ;Razão social;Obs\r\n11222333000181;"Mercado ""Bom"" Ltda";"linha 1\nlinha 2"\r\n';
    expect(detectDelimiter(text)).toBe(";");
    expect(parseCsv(text)).toEqual([
      ["CNPJ", "Razão social", "Obs"],
      ["11222333000181", 'Mercado "Bom" Ltda', "linha 1\nlinha 2"],
    ]);
  });

  it("detecta vírgula e decodifica Windows-1252 do Excel", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    const latin1 = new Uint8Array([0x52, 0x61, 0x7a, 0xe3, 0x6f]); // "Razão" em Windows-1252
    expect(decodeText(latin1)).toBe("Razão");
    expect(decodeText(new TextEncoder().encode("﻿Razão"))).toBe("Razão");
  });

  it("gera CSV com BOM e escapa separador", () => {
    expect(toCsv([["a;b", 'x"y']])).toBe('﻿"a;b";"x""y"\r\n');
  });
});

describe("mapeamento sugerido", () => {
  it("reconhece nomes comuns e não usa o mesmo campo duas vezes", () => {
    const m = suggestMapping("companies", ["C.N.P.J.", "Razão Social", "Nome Fantasia", "Cidade", "UF", "E-mail", "Celular", "Nome do contato", "Cliente desde"]);
    expect(m).toEqual(["cnpj", "legal_name", "trade_name", "municipality", "state_code", "email", "whatsapp", "contact_name", IGNORE]);
  });

  it("tabela de preços: descrição vira nome; colunas desconhecidas viram informação extra", () => {
    const m = suggestMapping("products", ["Cód.", "Descrição", "Linha", "Preço Unit. (R$)", "IPI %"]);
    expect(m).toEqual(["sku", "name", "category", "price", EXTRA]);
  });

  it("os cabeçalhos do modelo padrão são reconhecidos campo a campo", () => {
    for (const [kind, fields] of [["companies", COMPANY_FIELDS], ["products", PRODUCT_FIELDS]] as const) {
      expect(suggestMapping(kind, templateRows(kind)[0])).toEqual(fields.map((f) => f.key));
    }
  });
});

describe("valores", () => {
  it("preço: formatos brasileiros, nunca arredonda", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoney("29,9")).toBe(29.9);
    expect(parseMoney("29.90")).toBe(29.9);
    expect(parseMoney("1.234")).toBe(1234);
    expect(parseMoney("1,234.50")).toBe(1234.5);
    expect(parseMoney(12.3)).toBe(12.3);
    expect(parseMoney(12.345)).toBe("too_precise");
    expect(parseMoney("12,345")).toBe("too_precise");
    expect(parseMoney("abc")).toBe("invalid");
    expect(parseMoney("-5")).toBe("invalid");
    expect(parseMoney("")).toBeNull();
  });

  it("datas: dd/mm/aaaa, ISO e número de série do Excel", () => {
    expect(parseDate("31/12/2026")).toBe("2026-12-31");
    expect(parseDate("1/2/26")).toBe("2026-02-01");
    expect(parseDate("2026-12-31")).toBe("2026-12-31");
    expect(parseDate(46387)).toBe("2026-12-31");
    expect(parseDate("31/02/2026")).toBe("invalid");
  });

  it("CNPJ numérico do Excel recupera zeros à esquerda", () => {
    expect(parseCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(parseCnpj(191000100)).toBe("invalid");
    expect(parseCnpj(6990590000123)).toBe("06990590000123");
    expect(parseCnpj("11222333000182")).toBe("invalid");
  });

  it("UF por sigla ou nome; telefones múltiplos", () => {
    expect(parseUf("rn")).toBe("RN");
    expect(parseUf("Rio Grande do Norte")).toBe("RN");
    expect(parseUf("São Paulo")).toBe("SP");
    expect(parseUf("XX")).toBe("invalid");
    expect(parsePhones("(84) 3222-1234 / 84 99999-0000")).toEqual({ phones: ["8432221234", "84999990000"], invalid: false });
    expect(parsePhones("3222-1234").invalid).toBe(true);
  });
});

describe("linha de cliente", () => {
  it("normaliza e separa empresa de contato", () => {
    const { data, issues } = normalizeCompanyRow(
      {
        row: 2,
        values: {
          cnpj: "11.222.333/0001-81", legal_name: "Mercado Exemplo Ltda", kind: "Cliente", state_code: "RN", municipality: "Natal",
          phone: "(84) 3222-1234", email: "Compras@Exemplo.com.br", contact_name: "Maria", contact_email: "maria@exemplo.com.br",
        },
      },
      { enrich: true },
    );
    expect(issues).toEqual([]);
    expect(data).toMatchObject({
      cnpj: "11222333000181", kind: "customer", state_code: "RN", municipality: { name: "Natal" },
      channels: [{ kind: "phone", value: "(84) 3222-1234" }, { kind: "email", value: "compras@exemplo.com.br" }],
      contact: { name: "Maria", email: "maria@exemplo.com.br" },
    });
  });

  it("só CNPJ basta quando o preenchimento pela Receita está ligado", () => {
    const row = { row: 3, values: { cnpj: "11222333000181" } };
    expect(normalizeCompanyRow(row, { enrich: true }).issues).toEqual([]);
    expect(normalizeCompanyRow(row, { enrich: false }).issues[0]).toMatchObject({ field: "legal_name", level: "error" });
  });

  it("aponta erros sem repetir o conteúdo da célula", () => {
    const { issues } = normalizeCompanyRow({ row: 4, values: { cnpj: "123", kind: "fornecedor", contact_email: "x@" } }, { enrich: true });
    expect(issues.map((i) => i.field)).toEqual(["cnpj", "legal_name", "kind", "contact_email"]);
    expect(issues.every((i) => !i.message.includes("fornecedor") && !i.message.includes("x@"))).toBe(true);
  });
});

describe("linha de produto", () => {
  const opts = { defaultValidUntil: "2026-12-31", today: "2026-11-23" };

  it("preço com vigência padrão e informações extras", () => {
    const { data, issues } = normalizeProductRow(
      { row: 5, values: { sku: 1001, name: "Detergente 5 L", price: "29,90", unit: "CX 6", ean: 7891234567895 }, extra: { "IPI %": 5 } },
      opts,
    );
    expect(issues).toEqual([]);
    expect(data).toMatchObject({ sku: "1001", price: 29.9, valid_until: "2026-12-31", metadata: { unidade: "CX 6", ean: "7891234567895", "IPI %": "5" } });
  });

  it("sem preço não leva vigência; preço sem vigência e vencido viram aviso", () => {
    expect(normalizeProductRow({ row: 6, values: { sku: "A", name: "X", valid_until: "31/12/2026" } }, opts).data?.valid_until).toBeNull();
    const semVig = normalizeProductRow({ row: 7, values: { sku: "A", name: "X", price: 10 } }, { ...opts, defaultValidUntil: null });
    expect(semVig.issues[0]).toMatchObject({ level: "warning", field: "valid_until" });
    const vencido = normalizeProductRow({ row: 8, values: { sku: "A", name: "X", price: 10, valid_until: "01/01/2026" } }, opts);
    expect(vencido.issues[0].message).toMatch(/vencida/);
  });

  it("SKU, nome e preço inválido são erros", () => {
    const r = normalizeProductRow({ row: 9, values: { price: "12,345" } }, opts);
    expect(r.data).toBeNull();
    expect(r.issues.map((i) => i.field)).toEqual(["sku", "name", "price"]);
  });
});

describe("planilha", () => {
  it("acha o cabeçalho depois do título e pula linhas vazias", () => {
    const rows = [["TABELA DE PREÇOS NOV/2026", null], [null, null], ["Código", "Produto", "Preço"], ["1", "A", 10], [null, "", null], ["2", "B", 12.5]];
    const h = detectHeaderRow(rows);
    expect(h).toBe(2);
    expect(headersOf(rows, h)).toEqual(["Código", "Produto", "Preço"]);
    const data = dataRows(rows, h);
    expect(data.map((d) => d.row)).toEqual([4, 6]);
    expect(applyMapping(data, ["Código", "Produto", "Preço"], ["sku", IGNORE, "price"])[1]).toEqual({ row: 6, values: { sku: "2", price: 12.5 } });
  });
});

describe("opções do lote", () => {
  const file = { file_name: "clientes.xlsx", total_rows: 10 };
  it("clientes: legítimo interesse exige justificativa e ao menos uma finalidade", () => {
    const bad = companyImportOptionsSchema.safeParse({ ...file, source: "Planilha", source_date: "2026-11-01", legal_basis: "legitimate_interest", legal_basis_note: "curta", purposes: [] });
    expect(bad.success).toBe(false);
    const ok = companyImportOptionsSchema.safeParse({ ...file, source: "Planilha", source_date: "2026-11-01", legal_basis: "contract", legal_basis_note: "Contrato com a indústria X", purposes: ["customer_relationship"] });
    expect(ok.success).toBe(true);
  });
  it("clientes: consentimento não é aceito por importação", () => {
    const r = companyImportOptionsSchema.safeParse({ ...file, source: "Planilha", source_date: "2026-11-01", legal_basis: "consent", legal_basis_note: "x".repeat(30), purposes: ["support"] });
    expect(r.success).toBe(false);
  });
  it("produtos: origem e referência do documento são obrigatórias", () => {
    const r = productImportOptionsSchema.safeParse({ ...file, industry_id: "00000000-0000-4000-8000-000000000000", source: "", price_reference: "" });
    expect(r.success).toBe(false);
  });
});
