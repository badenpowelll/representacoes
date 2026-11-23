import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  latestMonthFromListing,
  normalizeName,
  parseDate,
  parseEmail,
  parseEstablishment,
  parseLine,
  parsePhone,
  readRecords,
} from "./receita-cnpj.mjs";

const scope = { states: new Set(["RN"]), cnaes: new Set(["8610101"]) };
const est = (over: Record<number, string> = {}) => {
  const f = Array.from({ length: 30 }, () => "");
  Object.assign(f, {
    0: "90000000", 1: "0001", 2: "01", 3: "1", 4: "HOSPITAL TESTE", 5: "02", 10: "20100315", 11: "8610101",
    12: "8630503,4771701", 13: "RUA", 14: "DAS FLORES", 15: "10", 17: "CENTRO", 18: "59000000", 19: "RN", 20: "1761",
    21: "84", 22: "32000000", 23: "084", 24: "999990000", 27: "Contato@Hosp.Test",
  }, over);
  return f;
};

describe("parseLine", () => {
  it("separa campos entre aspas, com ; e aspas escapadas dentro", () => {
    expect(parseLine('"1";"A; B";"diz ""oi""";""')).toEqual(["1", "A; B", 'diz "oi"', ""]);
  });
});

describe("readRecords", () => {
  it("decodifica latin1 e junta quebra de linha dentro de aspas", async () => {
    const text = '"1";"S\xc3O JOS\xc9"\r\n"2";"linha\nquebrada"\n"3";"fim"';
    const rows: string[][] = [];
    for await (const r of readRecords(Readable.from([Buffer.from(text, "latin1")]))) rows.push(r);
    expect(rows).toEqual([["1", "SÃO JOSÉ"], ["2", "linha\nquebrada"], ["3", "fim"]]);
  });
});

describe("campos", () => {
  it("datas, telefones e e-mails", () => {
    expect(parseDate("20100315")).toBe("2010-03-15");
    expect(parseDate("0")).toBeNull();
    expect(parseDate("20230231")).toBeNull();
    expect(parsePhone("84", "32000000")).toBe("8432000000");
    expect(parsePhone("084", "99999-0000")).toBe("84999990000");
    expect(parsePhone("", "32000000")).toBeNull();
    expect(parsePhone("84", "123")).toBeNull();
    expect(parseEmail(" Contato@Hosp.Test ")).toBe("contato@hosp.test");
    expect(parseEmail("sem-arroba")).toBeNull();
    expect(normalizeName("São José de Mipibu")).toBe("SAOJOSEDEMIPIBU");
  });
});

describe("parseEstablishment", () => {
  it("mantém ativos no recorte e converte os campos", () => {
    expect(parseEstablishment(est(), scope)).toMatchObject({
      cnpj: "90000000000101", cnpjBase: "90000000", isHeadquarters: true, tradeName: "HOSPITAL TESTE",
      openedOn: "2010-03-15", mainCnae: "8610101", secondaryCnaes: ["8630503", "4771701"], street: "RUA DAS FLORES",
      district: "CENTRO", zipCode: "59000000", stateCode: "RN", rfbMunicipality: "1761",
      phones: ["8432000000", "84999990000"], email: "contato@hosp.test",
    });
  });
  it("descarta inativos, outra UF e CNAE fora do recorte; aceita CNAE secundário", () => {
    expect(parseEstablishment(est({ 5: "08" }), scope)).toBeNull();
    expect(parseEstablishment(est({ 19: "CE" }), scope)).toBeNull();
    expect(parseEstablishment(est({ 11: "1091102", 12: "" }), scope)).toBeNull();
    expect(parseEstablishment(est({ 11: "1091102", 12: "8610101" }), scope)?.mainCnae).toBe("1091102");
  });
});

describe("latestMonthFromListing", () => {
  it("pega a pasta AAAA-MM mais recente", () => {
    expect(latestMonthFromListing('<a href="2026-09/">2026-09/</a><a href="2026-10/">x</a><a href="temp/">')).toBe("2026-10");
    expect(latestMonthFromListing("<html></html>")).toBeNull();
  });
});
