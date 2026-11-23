import { EXTRA, IGNORE } from "./fields";
import type { Cell, RawRow } from "./normalize";

export type SheetGrid = { name: string; rows: Cell[][] };

const isEmpty = (c: Cell | undefined) => c == null || (typeof c === "string" && c.trim() === "");

/** Converte valores lidos do Excel em tipos simples e serializáveis (datas viram AAAA-MM-DD). */
export function toCell(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return String(v);
}

/**
 * Linha do cabeçalho: tabelas de preço costumam ter título e logotipo antes.
 * Escolhe, entre as 15 primeiras linhas, a que tem mais células de texto.
 */
export function detectHeaderRow(rows: Cell[][]): number {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const textCells = r.filter((c) => typeof c === "string" && c.trim() !== "" && !/^[\d.,/\s-]+$/.test(c)).length;
    if (textCells > bestScore && textCells >= 2) {
      best = i;
      bestScore = textCells;
    }
  });
  return best;
}

export function headersOf(rows: Cell[][], headerRow: number): string[] {
  const width = Math.max(0, ...rows.slice(headerRow, headerRow + 200).map((r) => r.length));
  const h = rows[headerRow] ?? [];
  return Array.from({ length: width }, (_, i) => {
    const v = h[i];
    const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
    return s || `Coluna ${i + 1}`;
  });
}

/** Linhas de dados (sem as vazias), com o número real da linha na planilha. */
export function dataRows(rows: Cell[][], headerRow: number): { row: number; cells: Cell[] }[] {
  const out: { row: number; cells: Cell[] }[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.every(isEmpty)) continue;
    out.push({ row: i + 1, cells });
  }
  return out;
}

/** Aplica o mapeamento escolhido: campo -> valor, e colunas extras pelo nome. */
export function applyMapping(rows: { row: number; cells: Cell[] }[], headers: string[], mapping: string[]): RawRow[] {
  return rows.map(({ row, cells }) => {
    const values: Record<string, Cell> = {};
    const extra: Record<string, Cell> = {};
    mapping.forEach((m, i) => {
      const c = cells[i] ?? null;
      if (m === IGNORE || isEmpty(c)) return;
      if (m === EXTRA) extra[headers[i].slice(0, 200)] = typeof c === "string" ? c.slice(0, 10000) : c;
      else values[m] = typeof c === "string" ? c.slice(0, 10000) : c;
    });
    return Object.keys(extra).length ? { row, values, extra } : { row, values };
  });
}
