#!/usr/bin/env node
// Sincroniza os produtos de cada fonte cadastrada (página de produtos do site
// da indústria) com o Rep360. Ver ADR 0008 e docs/sincronizar-produtos.md.
//
// Para cada fonte ativa:
//   1. confere o robots.txt do site (página proibida = não abre);
//   2. abre a listagem num navegador sem janela (sites que montam a lista com
//      JavaScript), seguindo a paginação;
//   3. abre a página de cada produto novo ou com dados velhos (> 7 dias), se o
//      robots.txt permitir, para pegar descrição, SKU e fichas (FT, FDS);
//   4. grava via app.sync_product_source(): novo entra, o que saiu fica
//      inativo, o que voltou é reativado. Preço nunca vem do site.
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/sincronizar-produtos.mjs [opções]
// Opções:
//   --fonte UUID        só esta fonte
//   --url URL           não usa o banco: só mostra o que seria extraído (teste)
//   --padrao REGEX      com --url: padrão de link de produto
//   --max-detalhes N    páginas de produto abertas por fonte e execução (padrão 80)
//   --max-paginas N     páginas da listagem por fonte (padrão 30)
// Nunca imprime a DATABASE_URL.
import { chromium } from "@playwright/test";
import { parseHTML } from "linkedom";
import pg from "pg";
import { extractDetail, extractListing, nextPageUrl } from "./lib/product-extract.mjs";
import { isAllowed, USER_AGENT } from "./lib/robots.mjs";

const DETAILS_MAX_AGE_DAYS = 7;
const PAUSE_MS = 1000;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const robotsCache = new Map();
async function robotsFor(url) {
  const origin = new URL(url).origin;
  if (!robotsCache.has(origin)) {
    let text;
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
      if (res.status >= 400 && res.status < 500) text = ""; // sem robots.txt = tudo permitido
      else if (!res.ok) throw new Error(`robots.txt respondeu ${res.status}`);
      else text = await res.text();
    } catch (e) {
      // Sem resposta do robots.txt: por cautela, não abre o site nesta execução.
      text = null;
      log(`  robots.txt de ${origin} indisponível: ${e.message}`);
    }
    robotsCache.set(origin, text);
  }
  return robotsCache.get(origin);
}
async function allowed(url) {
  const robots = await robotsFor(url);
  return robots !== null && isAllowed(robots, url);
}

async function render(context, url) {
  const page = await context.newPage();
  try {
    await page.route("**/*", (route) =>
      ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
    );
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch(async (e) => {
      // Sites com conexões abertas (chat, analytics) nunca ficam "networkidle".
      if (/Timeout/i.test(e.message)) return null;
      throw e;
    });
    if (res && res.status() >= 400) throw new Error(`a página respondeu ${res.status()}`);
    await sleep(1500);
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await page.close();
  }
}

async function collectListing(context, startUrl, { linkPattern, maxPages }) {
  const items = new Map();
  let url = startUrl;
  const seen = new Set();
  for (let n = 0; url && n < maxPages && !seen.has(url); n++) {
    seen.add(url);
    if (!(await allowed(url))) {
      if (n === 0) throw new Error(`o robots.txt do site não permite ler ${url}`);
      break;
    }
    const { html, finalUrl } = await render(context, url);
    const { document } = parseHTML(html);
    const found = extractListing(document, finalUrl, { linkPattern });
    for (const it of found) if (!items.has(it.key)) items.set(it.key, it);
    log(`  página ${n + 1}: ${found.length} produtos (${items.size} no total)`);
    url = nextPageUrl(document, finalUrl);
    if (url) await sleep(PAUSE_MS);
  }
  return [...items.values()];
}

async function addDetails(context, items, { known, max }) {
  const stale = Date.now() - DETAILS_MAX_AGE_DAYS * 864e5;
  const want = items.filter((it) => {
    const k = known.get(it.key);
    return !k || !k.details_fetched_at || new Date(k.details_fetched_at).getTime() < stale;
  });
  let opened = 0;
  let blocked = 0;
  for (const it of want) {
    if (opened >= max) break;
    if (!(await allowed(it.url))) {
      blocked++;
      continue;
    }
    try {
      const { html, finalUrl } = await render(context, it.url);
      const d = extractDetail(parseHTML(html).document, finalUrl);
      it.details = true;
      it.description = d.description;
      it.documents = d.documents;
      if (!it.sku && d.sku) it.sku = d.sku;
    } catch (e) {
      log(`  detalhe falhou (${it.url}): ${e.message}`);
    }
    opened++;
    await sleep(PAUSE_MS);
  }
  if (blocked) log(`  ${blocked} páginas de produto não abertas: o robots.txt não permite (fica só o link)`);
  if (want.length > opened + blocked) log(`  ${want.length - opened - blocked} detalhes ficam para a próxima execução`);
}

async function main() {
  const opt = args(process.argv.slice(2));
  const maxPages = Number(opt["max-paginas"] ?? 30);
  const maxDetails = Number(opt["max-detalhes"] ?? 80);
  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: `Mozilla/5.0 (compatible; ${USER_AGENT})`, locale: "pt-BR" });
  try {
    if (opt.url) {
      const items = await collectListing(context, opt.url, { linkPattern: opt.padrao, maxPages });
      await addDetails(context, items, { known: new Map(), max: Math.min(maxDetails, 5) });
      console.log(JSON.stringify(items, null, 2));
      log(`${items.length} produtos (detalhes só dos 5 primeiros neste modo de teste)`);
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("defina DATABASE_URL (ou use --url para só testar a extração)");
    const db = new pg.Client({ connectionString: dbUrl });
    await db.connect();
    let failures = 0;
    try {
      const { rows: sources } = await db.query(
        `select s.id, s.url, s.link_pattern, s.label, i.name industry
           from public.product_sources s join public.industries i on i.id = s.industry_id
          where s.active and ($1::uuid is null or s.id = $1::uuid)
          order by s.created_at`,
        [opt.fonte ?? null],
      );
      log(`${sources.length} fonte(s) ativa(s)`);
      for (const s of sources) {
        log(`${s.industry} — ${s.label ?? s.url}`);
        try {
          const items = await collectListing(context, s.url, { linkPattern: s.link_pattern, maxPages });
          const { rows: knownRows } = await db.query(
            "select source_key, details_fetched_at from public.products where source_id = $1",
            [s.id],
          );
          await addDetails(context, items, { known: new Map(knownRows.map((r) => [r.source_key, r])), max: maxDetails });
          const { rows } = await db.query("select * from app.sync_product_source($1, $2::jsonb)", [s.id, JSON.stringify(items)]);
          const r = rows[0];
          log(`  ${r.status}: ${r.found} no site, ${r.added} novos, ${r.updated} atualizados, ${r.reactivated} voltaram, ${r.deactivated} saíram${r.message ? ` — ${r.message}` : ""}`);
          if (r.status !== "ok") failures++;
        } catch (e) {
          failures++;
          log(`  erro: ${e.message}`);
          await db.query("select app.record_product_source_failure($1, $2)", [s.id, String(e.message).slice(0, 2000)]);
        }
      }
    } finally {
      await db.end();
    }
    if (failures) {
      log(`${failures} fonte(s) com problema; veja a tela Produtos.`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
