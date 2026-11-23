#!/usr/bin/env node
// Gera a migration de municípios a partir do snapshot versionado
// supabase/reference/municipios_ibge.csv (ver supabase/reference/README.md).
// Uso: node scripts/gerar-migration-municipios.mjs > supabase/migrations/<timestamp>_ref_municipios.sql
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = new URL("../supabase/reference/municipios_ibge.csv", import.meta.url);
const raw = readFileSync(path);
const sha256 = createHash("sha256").update(raw).digest("hex");
const [header, ...lines] = raw.toString("utf8").trimEnd().split("\n");
if (header !== "ibge_code,uf_ibge_code,name") throw new Error("cabeçalho inesperado: " + header);

const seen = new Set();
const values = lines.map((line, i) => {
  const m = line.match(/^(\d{7}),(\d{2}),(.+)$/);
  if (!m) throw new Error("linha " + (i + 2) + " inválida: " + line);
  const [, code, uf, rawName] = m;
  const name = rawName.startsWith('"') ? rawName.slice(1, -1).replace(/""/g, '"') : rawName;
  if (code.slice(0, 2) !== uf) throw new Error("linha " + (i + 2) + ": código " + code + " não pertence à UF " + uf);
  if (seen.has(code)) throw new Error("código duplicado " + code);
  seen.add(code);
  return "(" + code + "," + uf + ",'" + name.replace(/'/g, "''") + "')";
});

const sql = [
  "-- Municípios brasileiros (referência global, código IBGE de 7 dígitos).",
  "-- GERADO por scripts/gerar-migration-municipios.mjs — não edite à mão.",
  "-- Snapshot: supabase/reference/municipios_ibge.csv",
  "-- sha256: " + sha256,
  "-- Registros: " + values.length,
  "-- Idempotente: reaplicar atualiza nomes; não remove municípios (podem existir vínculos).",
  "",
  "create temporary table _municipios (ibge_code integer, uf_ibge smallint, name text);",
  "insert into _municipios (ibge_code, uf_ibge, name) values",
  values.join(",\n") + ";",
  "",
  "do $$",
  "begin",
  "  if exists (select 1 from _municipios m left join ref.states s on s.ibge_code = m.uf_ibge where s.code is null) then",
  "    raise exception 'município com UF desconhecida no snapshot';",
  "  end if;",
  "end",
  "$$;",
  "",
  "insert into ref.municipalities (ibge_code, state_code, name)",
  "select m.ibge_code, s.code, m.name",
  "from _municipios m",
  "join ref.states s on s.ibge_code = m.uf_ibge",
  "on conflict (ibge_code) do update set name = excluded.name, state_code = excluded.state_code;",
  "",
  "drop table _municipios;",
  "",
];
process.stdout.write(sql.join("\n"));
