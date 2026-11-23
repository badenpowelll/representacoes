import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { totp } from "../tests/support/totp";

/*
 * Importação de planilhas: clientes (completados pelo CNPJ na "Receita"
 * simulada em CNPJ_API_BASE_URL=http://127.0.0.1:4010/) e tabela de preços.
 * Dados 100% fictícios. Se outro spec já estiver servindo a porta 4010, o
 * servidor dele responde o mesmo CNPJ de teste.
 */
const MOCK_PORT = 4010;
const CNPJ = "11444777000161";
const RECEITA = {
  cnpj: CNPJ,
  razao_social: "MATERIAIS EXEMPLO LTDA",
  nome_fantasia: "CASA EXEMPLO",
  descricao_situacao_cadastral: "ATIVA",
  cnae_fiscal: 4744001,
  cnae_fiscal_descricao: "Comércio varejista de ferragens e ferramentas",
  cnaes_secundarios: [{ codigo: 4672900, descricao: "Comércio atacadista de ferragens" }],
  descricao_tipo_de_logradouro: "RUA",
  logradouro: "DAS FLORES",
  numero: "100",
  bairro: "CENTRO",
  cep: "59000000",
  municipio: "NATAL",
  uf: "RN",
  codigo_municipio_ibge: 2408102,
  ddd_telefone_1: "8432221234",
  email: "contato@exemplo.test",
  qsa: [{ nome_socio: "FULANA DE TAL", qualificacao_socio: "Sócio-Administrador", cnpj_cpf_do_socio: "***123456**" }],
};
let mock: Server | null = null;

test.beforeAll(async () => {
  const server = createServer((req, res) => {
    const cnpj = (req.url ?? "").split("/").pop() ?? "";
    res.setHeader("content-type", "application/json");
    if (cnpj === CNPJ) res.end(JSON.stringify(RECEITA));
    else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "CNPJ não encontrado" }));
    }
  });
  mock = await new Promise<Server | null>((resolve) => {
    server.once("error", () => resolve(null));
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server));
  });
});
test.afterAll(async () => new Promise<void>((r) => (mock ? mock.close(() => r()) : r())));

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const run = Date.now().toString(36);

async function confirmationLink(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Text: string };
      const match = (msg.Text + msg.HTML).match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/);
      if (match) return match[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`e-mail de confirmação não chegou para ${email}`);
}

async function submitTotp(page: Page, secret: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    const outcome = await Promise.race([
      page.waitForURL((u) => !u.pathname.startsWith("/app/seguranca"), { timeout: 10_000 }).then(() => "ok"),
      page.getByText("Código inválido ou expirado").waitFor({ timeout: 10_000 }).then(() => "retry"),
    ]);
    if (outcome === "ok") return;
    await page.waitForTimeout(31_000 - (Date.now() % 30_000));
  }
  throw new Error("TOTP recusado duas vezes");
}

async function onboard(page: Page) {
  const email = `iara-${run}@importa.test`;
  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill("Iara Admin");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(`Senha-forte-${run}`);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText("link de confirmação");
  await page.goto(await confirmationLink(email));
  await page.getByLabel("Nome da representação").fill("Iota Representações");
  await page.getByLabel("Identificador").fill(`iota-imp-${run}`);
  await page.getByRole("button", { name: "Criar representação" }).click();
  await expect(page).toHaveURL(/\/app\/seguranca\?novo=1/);
  await page.getByRole("button", { name: "Configurar aplicativo autenticador" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await submitTotp(page, secret);
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
}

const stat = (page: Page, label: string) => page.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
const csv = (rows: string[][]) => Buffer.from("﻿" + rows.map((r) => r.join(";")).join("\r\n"), "utf8");

test("importa clientes pelo CNPJ e tabela de preços sem duplicar", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await onboard(page);

  // ---------------------------------------------------------------- clientes
  await page.getByRole("link", { name: "Empresas" }).click();
  await page.getByRole("link", { name: "Importar planilha" }).click();
  await expect(page.getByRole("heading", { name: "Importar planilha de clientes" })).toBeVisible();
  // O modelo .xlsx baixado é lido de volta com todas as colunas reconhecidas
  const modelo = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar modelo (.xlsx)" }).click();
  const download = await modelo;
  expect(download.suggestedFilename()).toBe("modelo-clientes-rep360.xlsx");
  const buffer = readFileSync((await download.path())!);
  await page.getByLabel("Planilha").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await expect(page.getByText("1 linhas de dados")).toBeVisible();
  await expect(page.getByLabel("Campo para a coluna CNPJ", { exact: true })).toHaveValue("cnpj");
  await expect(page.getByLabel("Campo para a coluna Telefone do contato", { exact: true })).toHaveValue("contact_phone");
  await page.getByRole("button", { name: "Trocar arquivo" }).click();

  const clientes = csv([
    ["Documento", "Cliente", "Cidade", "Estado", "Comprador", "E-mail comprador", "Cliente desde"],
    ["11.444.777/0001-61", "", "", "", "Maria Compras", "maria@exemplo.test", "2020"],
    ["", "Mercadinho Sem CNPJ", "Mossoró", "RN", "", "", ""],
    ["11.444.777/0001-61", "Repetida", "", "", "", "", ""],
    ["11.111.111/1111-11", "CNPJ Errado Ltda", "", "", "", "", ""],
  ]);
  await page.getByLabel("Planilha").setInputFiles({ name: "clientes-industria.csv", mimeType: "text/csv", buffer: clientes });
  await expect(page.getByText("4 linhas de dados")).toBeVisible();
  // Mapeamento sugerido e ajuste manual de uma coluna
  await expect(page.getByLabel("Campo para a coluna Documento", { exact: true })).toHaveValue("cnpj");
  await expect(page.getByLabel("Campo para a coluna Cliente", { exact: true })).toHaveValue("legal_name");
  await expect(page.getByLabel("Campo para a coluna Comprador", { exact: true })).toHaveValue("contact_name");
  await page.getByLabel("Campo para a coluna E-mail comprador", { exact: true }).selectOption("contact_email");
  await expect(page.getByLabel("Campo para a coluna Cliente desde", { exact: true })).toHaveValue("__ignore");

  await page.getByRole("button", { name: "Conferir antes de importar" }).click();
  await expect(page.getByText("Repetido na planilha (linha 2)")).toBeVisible();
  await expect(page.getByText("CNPJ inválido (dígitos não conferem)")).toBeVisible();
  await page.getByRole("button", { name: "Importar 2 linha(s)" }).click();
  await expect(page.getByText("Importação concluída.")).toBeVisible();
  await expect(stat(page, "Incluídos")).toContainText("2");
  await expect(stat(page, "Contatos incluídos")).toContainText("1");
  await expect(stat(page, "Não importados")).toContainText("2");
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar relatório (.csv)" }).click();
  expect((await report).suggestedFilename()).toMatch(/^relatorio-importacao-.*\.csv$/);

  // Empresa completada pela Receita, com origem do lote
  await page.getByRole("link", { name: "Ver empresas" }).click();
  await expect(page.getByRole("row", { name: /MATERIAIS EXEMPLO LTDA/ })).toContainText("Planilha de clientes \"clientes-industria.csv\"");
  await expect(page.getByRole("row", { name: /MATERIAIS EXEMPLO LTDA/ })).toContainText("4744001");
  await expect(page.getByRole("row", { name: /Mercadinho Sem CNPJ/ })).toContainText("RN");
  await page.getByRole("link", { name: "MATERIAIS EXEMPLO LTDA" }).click();
  await expect(page.getByText("Maria Compras")).toBeVisible();

  // Reimportar a mesma planilha não duplica nada
  await page.goto(page.url().replace(/\/empresas\/.*/, "/empresas/importar"));
  await page.getByLabel("Planilha").setInputFiles({ name: "clientes-industria.csv", mimeType: "text/csv", buffer: clientes });
  await page.getByLabel("Campo para a coluna E-mail comprador", { exact: true }).selectOption("contact_email");
  await page.getByRole("button", { name: "Conferir antes de importar" }).click();
  await expect(stat(page, "Novas")).toContainText("0");
  await page.getByRole("button", { name: "Importar 2 linha(s)" }).click();
  await expect(stat(page, "Incluídos")).toContainText("0");
  await expect(stat(page, "Contatos incluídos")).toContainText("0");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Importações anteriores" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "clientes-industria.csv", exact: true })).toHaveCount(2);

  // --------------------------------------------------------- tabela de preços
  await page.getByRole("link", { name: "Indústrias" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Indústria Preço Teste");
  await page.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(page.getByRole("cell", { name: "Indústria Preço Teste" })).toBeVisible();

  await page.getByRole("link", { name: "Produtos" }).click();
  await page.getByRole("link", { name: "Importar planilha de produtos e preços" }).click();
  const tabela = (preco: string) =>
    csv([
      ["TABELA DE PREÇOS NOVEMBRO", "", "", ""],
      ["Cód.", "Descrição", "Preço Unit.", "Caixa"],
      ["NX-1", "Detergente 5 L", preco, "6 un"],
      ["NX-2", "Sabão em pó 1 kg", "12,345", "12 un"],
      ["NX-3", "Água sanitária 2 L", "", "6 un"],
    ]);
  await page.getByLabel("Planilha").setInputFiles({ name: "Tabela Nov 2026.csv", mimeType: "text/csv", buffer: tabela("29,90") });
  await expect(page.getByLabel("Linha do cabeçalho")).toHaveValue("2");
  await expect(page.getByLabel("Campo para a coluna Caixa", { exact: true })).toHaveValue("__extra");
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Indústria Preço Teste" });
  await expect(page.getByLabel("Referência do documento")).toHaveValue("Tabela Nov 2026");
  await page.getByLabel("Vigência quando a linha não informar").fill("2099-12-31");
  await page.getByRole("button", { name: "Conferir antes de importar" }).click();
  await expect(page.getByText("Preço com mais de 2 casas decimais")).toBeVisible();
  await page.getByRole("button", { name: "Importar 2 linha(s)" }).click();
  await expect(stat(page, "Incluídos")).toContainText("2");
  await page.getByRole("link", { name: "Ver produtos" }).click();
  await expect(page.getByRole("row", { name: /Detergente 5 L/ })).toContainText(/R\$\s29,90/);

  // Nova tabela: mesmo SKU atualiza o preço, não duplica
  await page.getByRole("link", { name: "Importar planilha de produtos e preços" }).click();
  await page.getByLabel("Planilha").setInputFiles({ name: "Tabela Dez 2026.csv", mimeType: "text/csv", buffer: tabela("31,50") });
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Indústria Preço Teste" });
  await page.getByLabel("Vigência quando a linha não informar").fill("2099-12-31");
  await page.getByRole("button", { name: "Conferir antes de importar" }).click();
  await page.getByRole("button", { name: "Importar 2 linha(s)" }).click();
  await expect(stat(page, "Atualizados")).toContainText("1");
  await expect(stat(page, "Sem alteração")).toContainText("1");
  await page.getByRole("link", { name: "Ver produtos" }).click();
  await expect(page.getByRole("row", { name: /Detergente 5 L/ })).toHaveCount(1);
  await expect(page.getByRole("row", { name: /Detergente 5 L/ })).toContainText(/R\$\s31,50/);
});
