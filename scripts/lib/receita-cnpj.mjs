// Leitura dos arquivos de dados abertos do CNPJ (Receita Federal).
// Formato: CSV separado por ";", todos os campos entre aspas, sem cabeçalho,
// codificação ISO-8859-1. Funções puras, testadas em receita-cnpj.test.ts.

/**
 * Divide uma linha CSV da Receita em campos. Aspas duplicadas ("") viram uma aspa.
 * @param {string} line
 * @returns {string[]}
 */
export function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Quantidade de aspas: ímpar indica campo com quebra de linha que continua. */
export function hasOpenQuote(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '"') n++;
  return n % 2 === 1;
}

/**
 * Lê linhas lógicas (juntando quebras dentro de aspas) de um stream de Buffers latin1.
 * @param {AsyncIterable<Buffer>} stream
 * @returns {AsyncGenerator<string[]>}
 */
export async function* readRecords(stream) {
  const decoder = new TextDecoder("latin1");
  let buf = "";
  let pending = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      pending = pending ? pending + "\n" + line : line;
      if (hasOpenQuote(pending)) continue;
      if (pending.length) yield parseLine(pending);
      pending = "";
    }
  }
  buf += decoder.decode();
  const last = (pending ? pending + "\n" : "") + buf.replace(/\r$/, "");
  if (last.trim().length) yield parseLine(last);
}

const clean = (v) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t.length ? t : null;
};

/** AAAAMMDD → AAAA-MM-DD (ou null para 0/vazio/inválido). */
export function parseDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((v ?? "").trim());
  if (!m || m[1] === "0000") return null;
  const [, y, mo, d] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCMonth() + 1 !== Number(mo)) return null;
  return `${y}-${mo}-${d}`;
}

/** DDD + número → 10 ou 11 dígitos, ou null. */
export function parsePhone(ddd, number) {
  const d = (ddd ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const n = (number ?? "").replace(/\D/g, "");
  if (!d || !n) return null;
  const full = d + n;
  return /^[1-9][1-9][0-9]{8,9}$/.test(full) ? full : null;
}

/** E-mail em minúsculas se tiver formato plausível. */
export function parseEmail(v) {
  const e = (v ?? "").trim().toLowerCase();
  return /^[^@\s;,]+@[^@\s;,]+\.[a-z]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

/** Nome para comparação: sem acentos, maiúsculas, só letras e números. */
export function normalizeName(v) {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export const ACTIVE_STATUS = "02";

/**
 * Converte um registro de Estabelecimentos. Devolve null se não estiver no recorte
 * (situação ativa, UF e CNAE principal ou secundário).
 * @param {string[]} f
 * @param {{ states: Set<string>, cnaes: Set<string> }} scope
 */
export function parseEstablishment(f, scope) {
  if (f.length < 28) return null;
  if (f[5] !== ACTIVE_STATUS) return null;
  const state = (f[19] ?? "").trim().toUpperCase();
  if (!scope.states.has(state)) return null;
  const mainCnae = (f[11] ?? "").trim();
  const secondary = (f[12] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{7}$/.test(s));
  if (!/^\d{7}$/.test(mainCnae)) return null;
  if (!scope.cnaes.has(mainCnae) && !secondary.some((c) => scope.cnaes.has(c))) return null;
  const cnpj = `${f[0]}${f[1]}${f[2]}`.replace(/\D/g, "");
  if (!/^\d{14}$/.test(cnpj)) return null;
  const phones = [...new Set([parsePhone(f[21], f[22]), parsePhone(f[23], f[24])].filter(Boolean))];
  const street = [clean(f[13]), clean(f[14])].filter(Boolean).join(" ") || null;
  return {
    cnpj,
    cnpjBase: f[0],
    isHeadquarters: f[3] === "1",
    tradeName: clean(f[4]),
    openedOn: parseDate(f[10]),
    mainCnae,
    secondaryCnaes: secondary,
    street,
    number: clean(f[15]),
    complement: clean(f[16]),
    district: clean(f[17]),
    zipCode: clean(f[18])?.replace(/\D/g, "") || null,
    stateCode: state,
    rfbMunicipality: (f[20] ?? "").trim(),
    phones,
    email: parseEmail(f[27]),
  };
}

/** Registro de Empresas: razão social, natureza jurídica e porte. */
export function parseCompany(f) {
  if (f.length < 6) return null;
  return { cnpjBase: f[0], legalName: clean(f[1]), legalNature: clean(f[2]), size: clean(f[5]) };
}

/**
 * Índice "UF:NOME" → código IBGE, para casar os municípios da Receita (que têm
 * código próprio) com os do IBGE.
 * @param {{ ibge_code: number, state_code: string, name: string }[]} ibge
 */
export function buildMunicipalityIndex(ibge) {
  const index = new Map();
  for (const m of ibge) index.set(`${m.state_code}:${normalizeName(m.name)}`, m.ibge_code);
  return index;
}

/** Primeiro mês (AAAA-MM) encontrado como pasta numa listagem HTML. */
export function latestMonthFromListing(html) {
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/?"/g)].map((m) => m[1]);
  return months.sort().at(-1) ?? null;
}
