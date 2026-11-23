/**
 * Campos que o importador conhece e os nomes de coluna mais comuns nas
 * planilhas das indústrias, para sugerir o mapeamento automaticamente. O
 * usuário sempre pode trocar a sugestão antes de importar.
 */
export type ImportKind = "companies" | "products";

export type FieldDef = {
  key: string;
  /** Cabeçalho usado no modelo para download. */
  template: string;
  label: string;
  hint?: string;
  /** Nomes de coluna reconhecidos (comparados sem acento, caixa ou pontuação). */
  aliases: string[];
  /** Grupo para organizar o seletor. */
  group?: string;
  example?: string;
};

export const COMPANY_FIELDS: FieldDef[] = [
  { key: "cnpj", template: "CNPJ", label: "CNPJ", aliases: ["cnpj", "cnpj cpf", "cpf cnpj", "cgc", "documento", "cnpj do cliente"], example: "11.222.333/0001-81", hint: "Com o CNPJ o sistema completa o resto pela Receita." },
  { key: "legal_name", template: "Razão social", label: "Razão social", aliases: ["razao social", "nome empresarial", "razao", "empresa", "cliente", "nome do cliente", "nome"], example: "Mercadinho Exemplo Ltda" },
  { key: "trade_name", template: "Nome fantasia", label: "Nome fantasia", aliases: ["nome fantasia", "fantasia", "apelido"], example: "Mercadinho Exemplo" },
  { key: "kind", template: "Tipo", label: "Tipo (cliente ou prospect)", aliases: ["tipo", "cliente prospect", "situacao"], example: "cliente" },
  { key: "segment", template: "Segmento", label: "Segmento", aliases: ["segmento", "ramo", "ramo de atividade", "atividade", "setor", "canal"], example: "Supermercado" },
  { key: "cnae", template: "CNAE", label: "CNAE", aliases: ["cnae", "cnae principal", "cnae fiscal"], example: "4711302" },
  { key: "state_code", template: "UF", label: "UF", aliases: ["uf", "estado"], example: "RN" },
  { key: "municipality", template: "Município", label: "Município", aliases: ["municipio", "cidade", "codigo ibge", "ibge"], example: "Natal" },
  { key: "website", template: "Site", label: "Site", aliases: ["site", "website", "url", "pagina"], example: "www.exemplo.com.br" },
  { key: "phone", template: "Telefone", label: "Telefone da empresa", aliases: ["telefone", "fone", "tel", "telefone comercial", "telefones"], example: "(84) 3222-1234" },
  { key: "whatsapp", template: "WhatsApp", label: "WhatsApp da empresa", aliases: ["whatsapp", "whats", "zap", "celular"], example: "(84) 99999-1234" },
  { key: "email", template: "E-mail", label: "E-mail da empresa", aliases: ["email", "e mail", "email comercial", "email da empresa"], example: "compras@exemplo.com.br" },
  { key: "notes", template: "Observações", label: "Observações", aliases: ["observacoes", "observacao", "obs", "anotacoes"], example: "Compra mensal" },
  { key: "contact_name", template: "Nome do contato", label: "Nome do contato (pessoa)", group: "Contato", aliases: ["contato", "nome do contato", "comprador", "responsavel", "pessoa de contato"], example: "Maria Souza" },
  { key: "contact_role", template: "Cargo do contato", label: "Cargo do contato", group: "Contato", aliases: ["cargo", "funcao", "cargo do contato"], example: "Compradora" },
  { key: "contact_email", template: "E-mail do contato", label: "E-mail do contato", group: "Contato", aliases: ["email do contato", "e mail do contato", "email comprador"], example: "maria@exemplo.com.br" },
  { key: "contact_phone", template: "Telefone do contato", label: "Telefone do contato", group: "Contato", aliases: ["telefone do contato", "celular do contato", "fone do contato"], example: "(84) 98888-7777" },
];

export const PRODUCT_FIELDS: FieldDef[] = [
  { key: "sku", template: "SKU", label: "Código (SKU)", aliases: ["sku", "codigo", "cod", "cod produto", "codigo do produto", "referencia", "ref", "item"], example: "NX-001" },
  { key: "name", template: "Produto", label: "Nome do produto", aliases: ["produto", "nome", "nome do produto", "descricao", "descricao do produto", "item descricao"], example: "Detergente neutro 5 L" },
  { key: "category", template: "Categoria", label: "Categoria / linha", aliases: ["categoria", "linha", "grupo", "familia", "departamento"], example: "Limpeza" },
  { key: "description", template: "Descrição detalhada", label: "Descrição detalhada", aliases: ["descricao detalhada", "detalhes", "especificacao", "observacoes"], example: "Biodegradável" },
  { key: "price", template: "Preço", label: "Preço autorizado (R$)", aliases: ["preco", "valor", "preco unitario", "valor unitario", "preco tabela", "vlr", "vlr unit", "preco de venda", "preco r"], example: "29,90" },
  { key: "valid_until", template: "Vigência", label: "Vigência do preço (válido até)", aliases: ["vigencia", "validade", "valido ate", "vigente ate", "data validade"], example: "31/12/2026" },
  { key: "unit", template: "Unidade", label: "Unidade / embalagem", aliases: ["unidade", "un", "und", "emb", "embalagem", "unid"], example: "CX 6 UN" },
  { key: "ean", template: "EAN", label: "Código de barras (EAN)", aliases: ["ean", "gtin", "codigo de barras", "cod barras", "ean13"], example: "7891234567895" },
];

export const FIELDS: Record<ImportKind, FieldDef[]> = { companies: COMPANY_FIELDS, products: PRODUCT_FIELDS };

/** Campos sem os quais a linha não entra. */
export const REQUIRED_HINT: Record<ImportKind, string> = {
  companies: "Cada linha precisa de CNPJ ou razão social.",
  products: "Cada linha precisa de código (SKU) e nome do produto.",
};

/** Valor especial do mapeamento: coluna ignorada ou guardada como informação extra. */
export const IGNORE = "__ignore";
export const EXTRA = "__extra";

export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Sugere um campo para cada coluna: primeiro nome exato, depois nome que
 * contém o apelido. Cada campo é usado no máximo uma vez.
 */
export function suggestMapping(kind: ImportKind, headers: string[]): string[] {
  const fields = FIELDS[kind];
  const used = new Set<string>();
  const out = headers.map(() => IGNORE);
  const norm = headers.map(normalizeHeader);
  // Passo 1: igualdade exata.
  norm.forEach((h, i) => {
    const compact = h.replace(/ /g, "");
    const f = fields.find((f) => !used.has(f.key) && f.aliases.some((a) => a === h || a.replace(/ /g, "") === compact));
    if (f) {
      out[i] = f.key;
      used.add(f.key);
    }
  });
  // Passo 2: a coluna contém o apelido como palavra(s) inteira(s); o apelido mais longo vence.
  norm.forEach((h, i) => {
    if (out[i] !== IGNORE || !h) return;
    let best: { key: string; len: number } | null = null;
    for (const f of fields) {
      if (used.has(f.key)) continue;
      for (const a of f.aliases) {
        if (a.length >= 2 && ` ${h} `.includes(` ${a} `) && (!best || a.length > best.len)) best = { key: f.key, len: a.length };
      }
    }
    if (best) {
      out[i] = best.key;
      used.add(best.key);
    } else if (kind === "products") {
      out[i] = EXTRA;
    }
  });
  return out;
}
