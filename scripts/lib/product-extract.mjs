// Extração genérica de produtos do site de uma indústria (ADR 0008).
//
// Trabalha sobre um Document (DOM) já renderizado; não faz rede. Estratégia:
//   1. JSON-LD (schema.org Product / ItemList), quando o site publica;
//   2. senão, links de produto repetidos na página: agrupa os links pelo
//      "formato" da URL (ex.: produtos.php?produto_id=*) e escolhe o grupo com
//      mais links distintos que envolvem uma foto (cards de produto).
// Nunca extrai preço: o site não é tabela de preços autorizada.

const MAX_NAME = 300;
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

function abs(href, base) {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** Chave estável do produto no site: id da query string ou último trecho do caminho. */
export function productKey(url) {
  const u = typeof url === "string" ? new URL(url) : url;
  const params = [...u.searchParams.entries()].filter(([, v]) => v.trim() !== "");
  if (params.length) {
    const named = params.find(([k]) => /(^|_)(id|cod|codigo|sku|ref)$|^(p|id|produto|product|item)$/i.test(k));
    return clean((named ?? params[0])[1]).slice(0, 300);
  }
  const seg = u.pathname.split("/").filter(Boolean).pop();
  if (seg) return decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, "").slice(0, 300);
  return u.toString().slice(0, 300);
}

function urlShape(u) {
  const keys = [...u.searchParams.keys()].sort().join("&");
  if (keys) return `${u.host}${u.pathname}?${keys}`;
  const parts = u.pathname.split("/").filter(Boolean);
  parts.pop();
  return `${u.host}/${parts.join("/")}/*`;
}

function hiddenOrChrome(el) {
  for (let n = el; n && n.tagName; n = n.parentElement) {
    const tag = n.tagName.toLowerCase();
    if (tag === "nav" || tag === "header" || tag === "footer") return true;
    if (/display\s*:\s*none/i.test(n.getAttribute?.("style") ?? "") || n.hasAttribute?.("hidden")) return true;
  }
  return false;
}

function imgSrc(img, base) {
  for (const attr of ["src", "data-src", "data-lazy-src", "data-original"]) {
    const v = img.getAttribute(attr);
    if (v && !v.startsWith("data:")) {
      const u = abs(v, base);
      if (u) return u.toString();
    }
  }
  return null;
}

function* jsonLdNodes(doc) {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const n = stack.shift();
      if (!n || typeof n !== "object") continue;
      yield n;
      if (Array.isArray(n["@graph"])) stack.push(...n["@graph"]);
      if (Array.isArray(n.itemListElement)) stack.push(...n.itemListElement);
      if (n.item && typeof n.item === "object") stack.push({ ...n.item, url: n.item.url ?? n.url });
    }
  }
}

function fromJsonLd(doc, base) {
  const out = [];
  for (const n of jsonLdNodes(doc)) {
    const type = [].concat(n["@type"] ?? []).join(" ");
    const isProduct = /Product/.test(type) || (/ListItem/.test(type) && n.name && n.url);
    if (!isProduct || !n.name || !n.url) continue;
    const u = abs(String(n.url), base);
    if (!u) continue;
    const image = [].concat(n.image ?? [])[0];
    out.push({
      ...(n.sku ? { sku: clean(String(n.sku)).slice(0, 100) } : {}),
      key: productKey(u),
      name: clean(String(n.name)).slice(0, MAX_NAME),
      url: u.toString(),
      category: n.category ? clean(String(n.category)).slice(0, 120) : null,
      image_url: image ? abs(typeof image === "string" ? image : image.url, base)?.toString() ?? null : null,
    });
  }
  return out;
}

function cardOf(anchor, url) {
  let n = anchor;
  for (let i = 0; i < 6 && n.parentElement; i++) {
    n = n.parentElement;
    const tag = n.tagName.toLowerCase();
    const named = [...n.querySelectorAll("a[href]")].some((a) => a !== anchor && clean(a.textContent) && a.__url === url);
    if (named || tag === "li" || tag === "article") return n;
  }
  return anchor.parentElement ?? anchor;
}

/**
 * Lista de produtos de uma página. `linkPattern` (regex) força quais links são
 * de produto quando a detecção automática não acertar.
 */
export function extractListing(doc, pageUrl, { linkPattern } = {}) {
  const fromLd = fromJsonLd(doc, pageUrl);
  if (fromLd.length) return dedupe(fromLd);

  const page = abs(pageUrl, pageUrl)?.toString();
  const pattern = linkPattern ? new RegExp(linkPattern, "i") : null;
  const anchors = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) continue;
    const u = abs(href, pageUrl);
    if (!u || u.toString() === page || hiddenOrChrome(a)) continue;
    a.__url = u.toString();
    a.__u = u;
    anchors.push(a);
  }

  let chosen;
  if (pattern) {
    chosen = anchors.filter((a) => pattern.test(a.__url));
  } else {
    const groups = new Map();
    for (const a of anchors) {
      const shape = urlShape(a.__u);
      if (!groups.has(shape)) groups.set(shape, []);
      groups.get(shape).push(a);
    }
    let best = null;
    let bestScore = 0;
    for (const list of groups.values()) {
      const withImg = new Set(list.filter((a) => a.querySelector("img")).map((a) => a.__url));
      if (withImg.size > bestScore) {
        best = list;
        bestScore = withImg.size;
      }
    }
    if (bestScore < 2) return [];
    chosen = best;
  }
  const imgUrls = new Set(chosen.filter((a) => a.querySelector("img")).map((a) => a.__url));
  const urls = [...new Set(chosen.map((a) => a.__url))].filter((u) => !imgUrls.size || imgUrls.has(u));

  const items = [];
  for (const url of urls) {
    const same = anchors.filter((a) => a.__url === url);
    const texts = same.map((a) => clean(a.textContent)).filter(Boolean).sort((x, y) => y.length - x.length);
    const imgAnchor = same.find((a) => a.querySelector("img"));
    const img = imgAnchor?.querySelector("img");
    const name = (texts[0] || clean(img?.getAttribute("alt")) || clean(same[0].getAttribute("title"))).slice(0, MAX_NAME);
    if (!name) continue;
    const card = cardOf(imgAnchor ?? same[0], url);
    let category = null;
    const labelled = [...card.querySelectorAll("[class]")].find(
      (el) => /categ|post-author|\btag\b|marca|brand/i.test(el.getAttribute("class")) && clean(el.textContent) && clean(el.textContent) !== name,
    );
    const cat = clean(labelled?.textContent);
    if (cat && cat.length <= 120) category = cat;
    const skuEl = card.querySelector("[data-product_sku], [itemprop=sku]");
    const sku = clean(skuEl?.getAttribute("data-product_sku") ?? skuEl?.getAttribute("content") ?? skuEl?.textContent).slice(0, 100);
    items.push({
      key: productKey(url),
      name,
      url,
      category,
      image_url: img ? imgSrc(img, pageUrl) : null,
      ...(sku ? { sku } : {}),
    });
  }
  return dedupe(items);
}

function dedupe(items) {
  const seen = new Map();
  for (const it of items) if (it.key && !seen.has(it.key)) seen.set(it.key, it);
  return [...seen.values()];
}

const BLOCK = /^(p|div|section|article|li|ul|ol|tr|table|h[1-6]|br|dt|dd|dl|blockquote|header|footer)$/i;

/** Texto do elemento preservando quebras de linha entre blocos (sem depender de CSS). */
export function blockText(el) {
  let out = "";
  const walk = (n, pre = false) => {
    if (n.nodeType === 3) {
      out += pre ? n.textContent.replace(/[ \t\r]+/g, " ") : n.textContent.replace(/[ \t\r\n]+/g, " ");
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return;
    const keep = pre || tag === "pre" || /white-space\s*:\s*pre/i.test(n.getAttribute("style") ?? "");
    const block = BLOCK.test(tag);
    if (block) out += "\n";
    for (const c of n.childNodes) walk(c, keep);
    if (block) out += "\n";
    else if (tag === "td" || tag === "th") out += " ";
  };
  walk(el);
  return out
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n+/g, "\n")
    .trim();
}

/** Link para a próxima página da listagem (paginação), se houver. */
export function nextPageUrl(doc, pageUrl) {
  const el =
    doc.querySelector('link[rel="next"], a[rel="next"]') ??
    doc.querySelector("a.next, .pagination a.next, a.page-numbers.next") ??
    [...doc.querySelectorAll("a[href]")].find((a) => /^(próxima|proxima|next|›|»)$/i.test(clean(a.textContent) || clean(a.getAttribute("aria-label"))));
  const u = el ? abs(el.getAttribute("href"), pageUrl) : null;
  if (!u) return null;
  const here = abs(pageUrl, pageUrl);
  return u.host === here?.host && u.toString() !== here?.toString() ? u.toString() : null;
}

function docKind(text, url) {
  const s = `${text} ${url}`;
  if (/\bFDS\b|FISPQ|seguran[çc]a/i.test(s)) return "FDS";
  if (/\bFT\b|FT-\d|ficha\s+t[eé]cnica/i.test(s)) return "FT";
  return "outro";
}

/** Descrição e documentos (FT, FDS, laudos, PDFs) da página de um produto. */
export function extractDetail(doc, pageUrl) {
  const root = doc.querySelector("main") ?? doc.body ?? doc;
  const page = abs(pageUrl, pageUrl)?.toString();
  const documents = [];
  const seen = new Set();
  for (const a of root.querySelectorAll("a[href]")) {
    if (hiddenOrChrome(a)) continue;
    const u = abs(a.getAttribute("href"), pageUrl);
    if (!u || u.toString() === page || seen.has(u.toString())) continue;
    const text = clean(a.textContent);
    const isDoc = /\.pdf($|\?)/i.test(u.pathname) || /^(FT|FDS|FISPQ)\b|FT-\d|ficha|laudo|bula|manual|certificado/i.test(text);
    if (!isDoc) continue;
    seen.add(u.toString());
    const kind = docKind(text, u.pathname);
    documents.push({ kind, label: (text || kind).slice(0, 120), url: u.toString() });
    if (documents.length >= 10) break;
  }

  let description = null;
  let sku = null;
  for (const n of jsonLdNodes(doc)) {
    if (/Product/.test([].concat(n["@type"] ?? []).join(" "))) {
      if (n.description) description = String(n.description);
      if (n.sku) sku = clean(String(n.sku)).slice(0, 100);
      break;
    }
  }
  if (!sku) {
    const el = root.querySelector(".sku, [itemprop=sku]");
    const v = clean(el?.getAttribute("content") ?? el?.textContent);
    if (v && v.length <= 100 && !/^(n\/a|-)$/i.test(v)) sku = v;
  }
  if (!description) {
    const visible = (el) => el && !hiddenOrChrome(el);
    const candidates = [...root.querySelectorAll("div, p, section")].filter(visible);
    // Rótulo "Descrição ..." num bloco folha (ex.: Madnezz) ou painel/classe de descrição (ex.: WooCommerce).
    const byLabel = candidates.find((el) => /^\s*descri[cç][aã]o/i.test(el.textContent ?? "") && el.querySelectorAll("div, p").length === 0);
    const byClass = candidates.find((el) => /(^|[\s_-])description\b|descri[cç]/i.test(el.getAttribute("class") ?? "") && !/short/i.test(el.getAttribute("class") ?? ""));
    const parts = [
      candidates.find((el) => /short-description|resumo/i.test(el.getAttribute("class") ?? "")),
      byLabel ?? byClass,
      candidates.find((el) => /additional_information|informac/i.test(el.getAttribute("class") ?? "")),
    ]
      .filter(Boolean)
      .map((el, i, all) => {
        let t = blockText(el);
        if (all.length === 1 || el === (byLabel ?? byClass)) t = t.replace(/^\s*descri[cç][aã]o( do produto)?\s*:?\s*/i, "");
        return t;
      })
      .filter(Boolean);
    if (parts.length) description = [...new Set(parts)].join("\n\n");
  }
  description = description
    ? description.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000) || null
    : null;
  return { description, documents, ...(sku ? { sku } : {}) };
}
