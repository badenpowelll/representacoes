import { describe, expect, it } from "vitest";
import { montarLinhas, resumoSelecao, selecaoTerritorioSchema } from "./selecao";

const IND = "11111111-1111-4111-8111-111111111111";
const IND2 = "22222222-2222-4222-8222-222222222222";
const sel = (selection: unknown, extra: Record<string, unknown> = {}) =>
  selecaoTerritorioSchema.safeParse({ industry_id: IND, membership_id: "", selection: JSON.stringify(selection), ...extra });

describe("selecaoTerritorioSchema", () => {
  it("aceita estados inteiros e municípios escolhidos", () => {
    const r = sel([{ uf: "RN", municipios: "all" }, { uf: "CE", municipios: [2304400, 2303709] }], { exclusive: "on" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.exclusive).toBe(true);
      expect(r.data.membership_id).toBeNull();
      expect(r.data.selection).toHaveLength(2);
    }
  });
  it("exige ao menos um estado", () => {
    const r = sel([]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/ao menos um estado/);
  });
  it("lista de municípios vazia não vira UF inteira", () => {
    const r = sel([{ uf: "CE", municipios: [] }]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/ao menos um município/);
  });
  it("recusa UF inválida, código IBGE inválido, repetições e JSON quebrado", () => {
    expect(sel([{ uf: "XX", municipios: "all" }]).success).toBe(false);
    expect(sel([{ uf: "RN", municipios: [123] }]).success).toBe(false);
    expect(sel([{ uf: "RN", municipios: "all" }, { uf: "RN", municipios: "all" }]).success).toBe(false);
    expect(sel([{ uf: "RN", municipios: [2408003, 2408003] }]).success).toBe(false);
    expect(selecaoTerritorioSchema.safeParse({ industry_id: IND, selection: "{" }).success).toBe(false);
  });
  it("aceita 'todas as indústrias' e recusa indústria vazia", () => {
    expect(sel([{ uf: "RN", municipios: "all" }], { industry_id: "all" }).success).toBe(true);
    expect(sel([{ uf: "RN", municipios: "all" }], { industry_id: "" }).success).toBe(false);
  });
});

describe("montarLinhas", () => {
  it("gera uma linha por indústria × UF/município e pula as existentes", () => {
    const r = sel([{ uf: "RN", municipios: "all" }, { uf: "CE", municipios: [2304400, 2303709] }]);
    if (!r.success) throw r.error;
    const { linhas, jaExistiam } = montarLinhas(r.data, [IND, IND2], [
      { industry_id: IND, state_code: "RN", municipality_id: null, membership_id: null },
      { industry_id: IND2, state_code: "CE", municipality_id: 2304400, membership_id: "x" }, // outro responsável: não conta
    ]);
    expect(jaExistiam).toBe(1);
    expect(linhas).toHaveLength(5);
    expect(linhas.filter((l) => l.state_code === "RN").map((l) => l.municipality_id)).toEqual([null]);
    expect(linhas.every((l) => l.membership_id === null && l.exclusive === false)).toBe(true);
  });
});

describe("resumoSelecao", () => {
  it("descreve a seleção em português", () => {
    expect(resumoSelecao([{ uf: "RN", municipios: "all" }, { uf: "CE", municipios: [1] }, { uf: "PB", municipios: [1, 2] }])).toBe(
      "RN (todos os municípios), CE (1 município), PB (2 municípios)",
    );
  });
});
