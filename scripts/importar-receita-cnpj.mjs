#!/usr/bin/env node
// Importa o recorte da base pública do CNPJ (Receita Federal, dados abertos)
// para ref.cnpj_establishments: só estabelecimentos ATIVOS, nas UFs e CNAEs
// usados pelas indústrias cadastradas (ou os informados na linha de comando).
// Ver ADR 0007 e docs/prospeccao.md.
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/importar-receita-cnpj.mjs [opções]
// Opções:
//   --mes AAAA-MM        mês da publicação (padrão: o mais recente da listagem)
//   --ufs RN,PB          UFs (padrão: UFs dos territórios cadastrados)
//   --cnaes 8610101,...  CNAEs (padrão: CNAEs-alvo das indústrias cadastradas)
//   --dir caminho        usa ZIPs já baixados nessa pasta (não baixa nada)
//   --base-url URL       raiz dos dados abertos (padrão: Receita Federal)
//   --arquivos 0-9       quais partes (Estabelecimentos/Empresas N) processar
//   --max-linhas N       aborta sem gravar se o recorte passar de N (padrão 200000,
//                        ~100 MB com índices; protege o plano gratuito do Supabase)
//
// Precisa do comando `unzip`. O banco é escrito com a conexão de DATABASE_URL
// (papel com permissão no schema ref, ex.: postgres). Nunca imprime a URL.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import {
  buildMunicipalityIndex,
  latestMonthFromListing,
  normalizeName,
  parseCompany,
  parseEstablishment,
  readRecords,
} from "./lib/receita-cnpj.mjs";

const DEFAULT_BASE = "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj";

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return out;
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

function parts(spec) {
  if (!spec) return [...Array(10).keys()];
  const m = /^(\d)-(\d)$/.exec(spec);
  if (m) return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i);
  return spec.split(",").map(Number);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status}) ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

/** Abre o primeiro arquivo do ZIP como stream (via `unzip -p`). */
function unzipStream(zipPath) {
  const child = spawn("unzip", ["-p", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve, reject) =>
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`unzip ${zipPath}: ${code} ${stderr}`)))),
  );
  return { stream: child.stdout, done };
}

async function main() {
  const opt = args(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("defina DATABASE_URL");
  const base = (opt["base-url"] ?? DEFAULT_BASE).replace(/\/+$/, "");
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();

  let month = opt.mes;
  if (!month && !opt.dir) {
    const html = await (await fetch(`${base}/`)).text();
    month = latestMonthFromListing(html);
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error("informe --mes AAAA-MM");

  const states = new Set(
    opt.ufs
      ? opt.ufs.split(",").map((s) => s.trim().toUpperCase())
      : (await db.query("select distinct state_code from public.territories")).rows.map((r) => r.state_code),
  );
  const cnaes = new Set(
    opt.cnaes
      ? opt.cnaes.split(",").map((s) => s.replace(/\D/g, ""))
      : (await db.query("select distinct unnest(target_cnaes) as c from public.industries where active")).rows.map((r) => r.c),
  );
  if (!states.size || !cnaes.size) {
    log("Nada a importar: nenhuma UF de território ou nenhum CNAE-alvo cadastrado.");
    await db.end();
    return;
  }
  log(`Mês ${month} · UFs ${[...states].join(",")} · ${cnaes.size} CNAE(s)`);

  const work = opt.dir ?? mkdtempSync(join(tmpdir(), "receita-cnpj-"));
  const fetchZip = async (name) => {
    const local = join(work, name);
    if (existsSync(local)) return local;
    if (opt.dir) throw new Error(`arquivo ausente em --dir: ${name}`);
    log(`baixando ${name}…`);
    await download(`${base}/${month}/${name}`, local);
    log(`  ${(statSync(local).size / 1e6).toFixed(0)} MB`);
    return local;
  };
  const discard = (path) => {
    if (!opt.dir) rmSync(path, { force: true });
  };

  const run = (
    await db.query("insert into ref.cnpj_imports (dataset_ref, states, cnaes) values ($1, $2, $3) returning id, started_at", [
      month, [...states].sort(), [...cnaes].sort(),
    ])
  ).rows[0];

  try {
    // 1. Tabelas auxiliares: CNAEs (descrições) e municípios da Receita.
    const cnaeZip = await fetchZip("Cnaes.zip");
    const cnaeRows = [];
    {
      const { stream, done } = unzipStream(cnaeZip);
      for await (const f of readRecords(stream)) if (/^\d{7}$/.test(f[0]) && f[1]) cnaeRows.push([f[0], f[1].trim()]);
      await done;
    }
    for (let i = 0; i < cnaeRows.length; i += 500) {
      const chunk = cnaeRows.slice(i, i + 500);
      await db.query(
        `insert into ref.cnaes (code, description) select * from unnest($1::text[], $2::text[])
         on conflict (code) do update set description = excluded.description`,
        [chunk.map((r) => r[0]), chunk.map((r) => r[1])],
      );
    }
    discard(cnaeZip);
    log(`CNAEs: ${cnaeRows.length}`);

    const munZip = await fetchZip("Municipios.zip");
    const rfbMunicipalities = new Map();
    {
      const { stream, done } = unzipStream(munZip);
      for await (const f of readRecords(stream)) if (f[0]) rfbMunicipalities.set(f[0].trim(), f[1]?.trim() ?? "");
      await done;
    }
    discard(munZip);
    const ibge = (await db.query("select ibge_code, state_code, name from ref.municipalities")).rows;
    const ibgeIndex = buildMunicipalityIndex(ibge);

    // 2. Estabelecimentos no recorte.
    const found = new Map(); // cnpj → registro
    const bases = new Set();
    for (const n of parts(opt.arquivos)) {
      const zip = await fetchZip(`Estabelecimentos${n}.zip`);
      const { stream, done } = unzipStream(zip);
      let seen = 0;
      for await (const f of readRecords(stream)) {
        seen++;
        const e = parseEstablishment(f, { states, cnaes });
        if (!e) continue;
        found.set(e.cnpj, e);
        bases.add(e.cnpjBase);
      }
      await done;
      discard(zip);
      log(`Estabelecimentos${n}: ${seen} lidos, ${found.size} no recorte até agora`);
    }

    const maxRows = Number(opt["max-linhas"] ?? 200000);
    if (found.size > maxRows) {
      throw new Error(`recorte com ${found.size} estabelecimentos passa do limite de ${maxRows}; reduza UFs/CNAEs ou use --max-linhas`);
    }

    // 3. Razão social, natureza e porte (Empresas), só das bases encontradas.
    const companies = new Map();
    for (const n of parts(opt.arquivos)) {
      if (companies.size === bases.size) break;
      const zip = await fetchZip(`Empresas${n}.zip`);
      const { stream, done } = unzipStream(zip);
      for await (const f of readRecords(stream)) {
        if (!bases.has(f[0])) continue;
        const c = parseCompany(f);
        if (c) companies.set(c.cnpjBase, c);
      }
      await done;
      discard(zip);
      log(`Empresas${n}: ${companies.size}/${bases.size} razões sociais`);
    }

    // 4. Grava em lotes.
    let unmatched = 0;
    const rows = [...found.values()].map((e) => {
      const c = companies.get(e.cnpjBase);
      const munName = rfbMunicipalities.get(e.rfbMunicipality) ?? null;
      const ibgeCode = munName ? (ibgeIndex.get(`${e.stateCode}:${normalizeName(munName)}`) ?? null) : null;
      if (!ibgeCode) unmatched++;
      return { ...e, legalName: c?.legalName ?? e.tradeName ?? `CNPJ ${e.cnpj}`, legalNature: c?.legalNature ?? null, size: c?.size ?? null, munName, ibgeCode };
    });
    const cols = (r) => [
      r.cnpj, r.legalName, r.tradeName, r.isHeadquarters, r.openedOn, r.mainCnae, `{${r.secondaryCnaes.join(",")}}`,
      r.legalNature, r.size, r.stateCode, r.ibgeCode, r.munName, r.street, r.number, r.complement, r.district, r.zipCode,
      `{${r.phones.join(",")}}`, r.email,
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map(cols);
      const col = (k) => chunk.map((r) => r[k]);
      await db.query(
        `insert into ref.cnpj_establishments (cnpj, legal_name, trade_name, is_headquarters, opened_on, main_cnae, secondary_cnaes,
           legal_nature_code, company_size, state_code, municipality_id, municipality_name, street, number, complement, district,
           zip_code, phones, email, dataset_ref, imported_at)
         select c1, c2, c3, c4, c5, c6, c7::text[], c8, c9, c10, c11, c12, c13, c14, c15, c16, c17, c18::text[], c19, $20, now() from unnest($1::text[], $2::text[], $3::text[], $4::boolean[], $5::date[], $6::text[], $7::text[],
           $8::text[], $9::text[], $10::char(2)[], $11::integer[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[],
           $17::text[], $18::text[], $19::text[]) as t(c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16, c17, c18, c19)
         on conflict (cnpj) do update set legal_name = excluded.legal_name, trade_name = excluded.trade_name,
           is_headquarters = excluded.is_headquarters, opened_on = excluded.opened_on, main_cnae = excluded.main_cnae,
           secondary_cnaes = excluded.secondary_cnaes, legal_nature_code = excluded.legal_nature_code,
           company_size = excluded.company_size, state_code = excluded.state_code, municipality_id = excluded.municipality_id,
           municipality_name = excluded.municipality_name, street = excluded.street, number = excluded.number,
           complement = excluded.complement, district = excluded.district, zip_code = excluded.zip_code,
           phones = excluded.phones, email = excluded.email, dataset_ref = excluded.dataset_ref, imported_at = excluded.imported_at`,
        [...Array.from({ length: 19 }, (_, k) => col(k)), month],
      );
    }

    // 5. Remove do recorte o que deixou de estar ativo (não veio nesta carga).
    const removed = await db.query(
      `delete from ref.cnpj_establishments
        where imported_at < $1 and state_code = any ($2::char(2)[])
          and (main_cnae = any ($3::text[]) or secondary_cnaes && $3::text[])`,
      [run.started_at, [...states], [...cnaes]],
    );
    await db.query("update ref.cnpj_imports set status = 'done', finished_at = now(), rows_upserted = $2, rows_removed = $3 where id = $1", [
      run.id, rows.length, removed.rowCount,
    ]);
    log(`Gravados ${rows.length} estabelecimentos; removidos ${removed.rowCount}; ${unmatched} sem município IBGE casado.`);
    const size = await db.query(
      "select pg_size_pretty(pg_total_relation_size('ref.cnpj_establishments')) as t, pg_size_pretty(pg_database_size(current_database())) as d",
    );
    log(`Tamanho: tabela ${size.rows[0].t}; banco inteiro ${size.rows[0].d} (plano gratuito: 500 MB).`);
  } catch (error) {
    await db.query("update ref.cnpj_imports set status = 'failed', finished_at = now(), error = $2 where id = $1", [
      run.id, String(error?.message ?? error).slice(0, 1000),
    ]);
    throw error;
  } finally {
    if (!opt.dir) rmSync(work, { recursive: true, force: true });
    await db.end();
  }
}

main().catch((e) => {
  console.error("Falha na importação:", e?.message ?? e);
  process.exit(1);
});
