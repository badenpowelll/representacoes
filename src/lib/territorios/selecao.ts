import { z } from "zod";
import { UF_CODES } from "@/lib/validation/schemas";

/** Regiões do IBGE, na ordem em que aparecem na tela. */
export const REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
export type Regiao = (typeof REGIOES)[number];

/** Limite de linhas por envio (todos os municípios do Brasil cabem com folga em uma indústria). */
export const MAX_LINHAS_POR_ENVIO = 6000;

const municipioIbge = z.number().int().min(1_000_000).max(9_999_999);

/**
 * Escolha de uma UF: "all" = a UF inteira (todos os municípios, inclusive os
 * que vierem a ser criados); lista = só esses municípios. Lista vazia é
 * recusada: nunca vira cobertura estadual por omissão (parecer 004-complemento, P1-1).
 */
const escolhaUf = z.object({
  uf: z.enum(UF_CODES, { message: "UF inválida" }),
  municipios: z.union([
    z.literal("all"),
    z.array(municipioIbge).min(1, "Escolha ao menos um município ou marque “Todos os municípios”.").max(1000),
  ]),
});

export const selecaoTerritorioSchema = z
  .object({
    industry_id: z.union([z.literal("all"), z.uuid()], { message: "Selecione a indústria" }),
    membership_id: z
      .string()
      .nullish()
      .transform((v) => v || null)
      .pipe(z.uuid().nullable()),
    exclusive: z
      .string()
      .nullish()
      .transform((v) => v === "on"),
    selection: z
      .string()
      .nullish()
      .transform((raw, ctx) => {
        try {
          return JSON.parse(raw || "[]") as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Seleção inválida." });
          return z.NEVER;
        }
      })
      .pipe(z.array(escolhaUf).min(1, "Escolha ao menos um estado.").max(UF_CODES.length)),
  })
  .superRefine((v, ctx) => {
    const ufs = v.selection.map((s) => s.uf);
    if (new Set(ufs).size !== ufs.length) ctx.addIssue({ code: "custom", path: ["selection"], message: "Estado repetido na seleção." });
    v.selection.forEach((s, i) => {
      if (s.municipios !== "all" && new Set(s.municipios).size !== s.municipios.length) {
        ctx.addIssue({ code: "custom", path: ["selection", i], message: `Município repetido em ${s.uf}.` });
      }
    });
  });

export type SelecaoTerritorio = z.output<typeof selecaoTerritorioSchema>;

export type LinhaTerritorio = {
  industry_id: string;
  state_code: string;
  municipality_id: number | null;
  membership_id: string | null;
  exclusive: boolean;
};

export type CoberturaExistente = Pick<LinhaTerritorio, "industry_id" | "state_code" | "municipality_id" | "membership_id">;

/** Mesma chave do índice único territories_unique_scope. */
export function chaveCobertura(c: CoberturaExistente): string {
  return [c.industry_id, c.state_code, c.municipality_id ?? 0, c.membership_id ?? "-"].join("|");
}

/**
 * Transforma a seleção em linhas de `territories`, uma por indústria × UF
 * (UF inteira) ou indústria × município, e descarta as que já existem.
 */
export function montarLinhas(
  selecao: SelecaoTerritorio,
  industryIds: string[],
  existentes: CoberturaExistente[],
): { linhas: LinhaTerritorio[]; jaExistiam: number } {
  const ja = new Set(existentes.map(chaveCobertura));
  const linhas: LinhaTerritorio[] = [];
  let jaExistiam = 0;
  for (const industry_id of industryIds) {
    for (const s of selecao.selection) {
      const municipios = s.municipios === "all" ? [null] : s.municipios;
      for (const municipality_id of municipios) {
        const linha = { industry_id, state_code: s.uf, municipality_id, membership_id: selecao.membership_id, exclusive: selecao.exclusive };
        const k = chaveCobertura(linha);
        if (ja.has(k)) {
          jaExistiam++;
          continue;
        }
        ja.add(k);
        linhas.push(linha);
      }
    }
  }
  return { linhas, jaExistiam };
}

/** Resumo legível da seleção, ex.: "RN (todos os municípios), CE (3 municípios)". */
export function resumoSelecao(selection: { uf: string; municipios: "all" | number[] }[]): string {
  return selection
    .map((s) =>
      s.municipios === "all"
        ? `${s.uf} (todos os municípios)`
        : `${s.uf} (${s.municipios.length} ${s.municipios.length === 1 ? "município" : "municípios"})`,
    )
    .join(", ");
}
