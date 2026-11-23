import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { extractDetail, extractListing, nextPageUrl, productKey } from "./product-extract.mjs";
import { isAllowed } from "./robots.mjs";

const fixture = (f: string) => parseHTML(readFileSync(join(__dirname, "fixtures", f), "utf8")).document;
const BASE = "https://www.industria.example/produtos.php";

describe("extractListing (cards montados por JavaScript, sem JSON-LD)", () => {
  const items = extractListing(fixture("lista-grade-js.html"), BASE);

  it("acha só os cards de produto, sem menu, rodapé, categoria ou banner", () => {
    expect(items.map((i: { key: string }) => i.key)).toEqual(["101", "102", "103", "104"]);
  });

  it("nome, categoria, foto e link absolutos; sem preço", () => {
    expect(items[0]).toEqual({
      key: "101",
      name: "SUPLEMENTO EXEMPLO VITAMINA C 60 CÁPSULAS",
      url: "https://www.industria.example/produtos.php?produto_id=101",
      category: "Nutracêuticos",
      image_url: "https://cdn.example/upload/101.png",
    });
    expect(items[1].name).toBe("LUVA DE PROCEDIMENTO EXEMPLO M");
    expect(items[1].category).toBe("Hospitalar");
    expect(Object.keys(items[0])).not.toContain("price");
  });

  it("usa o alt da foto quando o card não tem texto; foto preguiçosa (data-src)", () => {
    expect(items[2]).toMatchObject({ name: "Repelente Exemplo 100mL", category: null, image_url: "https://www.industria.example/upload/103.png" });
  });

  it("ignora #âncora e une links do mesmo produto", () => {
    expect(items[3]).toMatchObject({ name: "KIT INFANTIL EXEMPLO (SH 200mL + COND 180mL)", url: "https://www.industria.example/produtos.php?produto_id=104" });
  });

  it("aceita padrão de link informado pelo usuário", () => {
    const only = extractListing(fixture("lista-grade-js.html"), BASE, { linkPattern: "produto_id=10[12]$" });
    expect(only.map((i: { key: string }) => i.key)).toEqual(["101", "102"]);
  });

  it("página sem cards não inventa produtos", () => {
    expect(extractListing(parseHTML("<html><body><a href='/a'>A</a><a href='/b'>B</a></body></html>").document, BASE)).toEqual([]);
  });
});

describe("extractListing com JSON-LD", () => {
  it("usa Product/ItemList do schema.org e ignora JSON inválido", () => {
    const items = extractListing(fixture("lista-jsonld.html"), "https://loja.example/produtos");
    items.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    expect(items).toEqual([
      { sku: "AG-500", key: "alcool-gel-500", name: "Álcool Gel Exemplo 500 mL", url: "https://loja.example/produto/alcool-gel-500", category: "Higiene", image_url: "https://loja.example/img/ag.png" },
      { key: "mascara-tripla", name: "Máscara Tripla Exemplo", url: "https://loja.example/produto/mascara-tripla", category: null, image_url: null },
    ]);
  });
});

describe("extractDetail", () => {
  const d = extractDetail(fixture("detalhe-produto.html"), `${BASE}?produto_id=101`);

  it("acha FT, FDS e PDFs visíveis, ignorando a lista escondida", () => {
    expect(d.documents).toEqual([
      { kind: "FT", label: "FT-1", url: "https://uploads.example/abc123" },
      { kind: "FDS", label: "FDS", url: "https://uploads.example/def456" },
      { kind: "outro", label: "Laudo de análise", url: "https://www.industria.example/docs/laudo.pdf" },
    ]);
  });

  it("descrição sem o rótulo e sem o texto genérico do site", () => {
    expect(d.description).toBe("A vitamina C auxilia no funcionamento do sistema imune.\nEspecificações\nTomar 1 cápsula ao dia.");
    expect(d.description).toContain("Tomar 1 cápsula ao dia.");
    expect(d.description).not.toContain("Texto genérico");
  });
});

describe("productKey", () => {
  it("prefere o parâmetro de id; senão o último trecho do caminho", () => {
    expect(productKey("https://x.example/p.php?cat=a&produto_id=55")).toBe("55");
    expect(productKey("https://x.example/produto/luva-m.html")).toBe("luva-m");
  });
});

describe("robots.txt", () => {
  const profissional = "User-agent: *\nAllow: /\n\n# comentário\nDisallow: /*?\nDisallow: /busca.php\n";
  it("lista permitida e página com ? proibida (caso da linha Profissional)", () => {
    expect(isAllowed(profissional, "https://p.example/produtos.php")).toBe(true);
    expect(isAllowed(profissional, "https://p.example/produtos.php?produto_id=1")).toBe(false);
    expect(isAllowed(profissional, "https://p.example/busca.php")).toBe(false);
  });
  it("Allow: / libera tudo; grupo específico do robô tem prioridade; $ ancora", () => {
    expect(isAllowed("User-agent: *\nAllow: /\n", "https://n.example/produtos.php?produto_id=1")).toBe(true);
    const specific = "User-agent: *\nDisallow: /\n\nUser-agent: Rep360-ProdutosBot\nAllow: /produtos\n";
    expect(isAllowed(specific, "https://n.example/produtos.php")).toBe(true);
    expect(isAllowed(specific, "https://n.example/outra")).toBe(true);
    expect(isAllowed("User-agent: *\nDisallow: /*.pdf$\n", "https://n.example/a.pdf")).toBe(false);
    expect(isAllowed("User-agent: *\nDisallow: /*.pdf$\n", "https://n.example/a.pdf?x=1")).toBe(true);
    expect(isAllowed("User-agent: *\nDisallow:\n", "https://n.example/x")).toBe(true);
    expect(isAllowed("", "https://n.example/x")).toBe(true);
  });
});

describe("loja WooCommerce (ex.: laboratório farmacêutico)", () => {
  const BASE_W = "https://lab.example/categoria-produto/farma/";
  const doc = fixture("lista-woocommerce.html");
  const items = extractListing(doc, BASE_W);

  it("cards com nome, categoria, foto e SKU do botão; ignora menu de categorias", () => {
    expect(items).toEqual([
      {
        key: "exemplotrim-20-comprimidos",
        name: "Exemplotrim 20 Comprimidos Princípio exemplo + outro",
        url: "https://lab.example/produto/exemplotrim-20-comprimidos/",
        category: "Farma",
        image_url: "https://lab.example/wp-content/uploads/exemplotrim-900x900.jpg",
        sku: "1.0000.0120",
      },
      {
        key: "xarope-exemplo-100-ml",
        name: "Xarope Exemplo 100 mL",
        url: "https://lab.example/produto/xarope-exemplo-100-ml/",
        category: "Farma",
        image_url: "https://lab.example/wp-content/uploads/xarope.jpg",
      },
    ]);
  });

  it("acha a próxima página da listagem", () => {
    expect(nextPageUrl(doc, BASE_W)).toBe("https://lab.example/categoria-produto/farma/page/2/");
    expect(nextPageUrl(fixture("lista-grade-js.html"), BASE)).toBeNull();
  });

  it("detalhe: SKU, apresentação, descrição e informação adicional com quebras de linha", () => {
    const d = extractDetail(fixture("detalhe-woocommerce.html"), "https://lab.example/produto/exemplotrim-20-comprimidos/");
    expect(d.sku).toBe("1.0000.0120");
    expect(d.documents).toEqual([]);
    expect(d.description).toBe(
      "Apresentação\nComprimido 400mg – Caixa com 20 comprimidos\n\n" +
        "Princípio Ativo: Princípio exemplo + outro\nIndicações: Infecções causadas por germes sensíveis.\nVENDA SOB PRESCRIÇÃO MÉDICA\n\n" +
        "Informação adicional\nRegistro M.S. 1.0000.0130",
    );
  });
});

describe("vigiar página", () => {
  it("resume linhas que entraram e saíram, ignorando espaços", async () => {
    const { pageTextSummary } = await import("./watch.mjs");
    const before = "Álcool 70° INPM\nEmbalagem: 1 Litro\nÁlcool 46°  INPM\nEmbalagem: 500 ml";
    const after = "Álcool 70° INPM\nEmbalagem: 1 Litro\nÁlcool 70° Gel\nEmbalagem: 5 Litros";
    expect(pageTextSummary(before, after)).toBe("Entrou: Álcool 70° Gel | Embalagem: 5 Litros. Saiu: Álcool 46° INPM | Embalagem: 500 ml.");
    expect(pageTextSummary("a b c\n", "a  b c")).toBeNull();
  });
});
