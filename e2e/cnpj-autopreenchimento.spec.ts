import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { totp } from "../tests/support/totp";

/*
 * Preenchimento automático por CNPJ. O app consulta a "Receita" num servidor
 * simulado (CNPJ_API_BASE_URL=http://127.0.0.1:4010/, só aceito em
 * desenvolvimento e localhost), com dados fictícios no formato da BrasilAPI.
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
let mock: Server;
const calls: string[] = [];

test.beforeAll(async () => {
  mock = createServer((req, res) => {
    const cnpj = (req.url ?? "").split("/").pop() ?? "";
    calls.push(cnpj);
    res.setHeader("content-type", "application/json");
    if (cnpj === CNPJ) res.end(JSON.stringify(RECEITA));
    else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "CNPJ não encontrado" }));
    }
  });
  await new Promise<void>((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
});
test.afterAll(async () => new Promise<void>((r) => mock.close(() => r())));

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

async function signUpAndConfirm(page: Page, name: string, email: string, password: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText("link de confirmação");
  await page.goto(await confirmationLink(email));
  await expect(page).toHaveURL(/\/app\/nova-representacao/);
}

/** Digita o TOTP atual; se o servidor recusar (código da janela já usado), espera a próxima janela. */
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

/** Cadastra o autenticador na tela de segurança e retorna o segredo (conta sintética de teste). */
async function enrollTotp(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();
  await page.getByRole("button", { name: "Configurar aplicativo autenticador" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await submitTotp(page, secret);
  return secret;
}

/** Onboarding de administrador: cria a representação e ativa o MFA. */
async function createTenant(page: Page, name: string, slug: string): Promise<string> {
  await page.getByLabel("Nome da representação").fill(name);
  await page.getByLabel("Identificador").fill(slug);
  await page.getByRole("button", { name: "Criar representação" }).click();
  await expect(page).toHaveURL(/\/app\/seguranca\?novo=1/);
  const secret = await enrollTotp(page);
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  return secret;
}

test("CNPJ preenche empresa, prospecção e indústria; ficha mostra sócios e endereço", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Gabi Admin", `gabi-${run}@zeta.test`, `Senha-forte-${run}`);
  await createTenant(page, "Zeta Representações", `zeta-${run}`);

  // Indústria: o nome vem do nome fantasia
  await page.getByRole("link", { name: "Indústrias" }).click();
  await page.getByLabel("CNPJ").fill("11.444.777/0001-61");
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("CASA EXEMPLO");
  await expect(page.getByLabel("Segmento")).toHaveValue("Comércio varejista de ferragens e ferramentas");
  await page.getByLabel("Nome", { exact: true }).fill("Exemplo Indústria");
  await page.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(page.getByRole("cell", { name: "Exemplo Indústria" })).toBeVisible();
  await page.getByText("Dados da Receita Federal de Exemplo Indústria").click();
  await expect(page.getByText("RUA DAS FLORES, 100 · CENTRO · NATAL/RN · CEP 59000-000")).toBeVisible();
  await expect(page.getByText("FULANA DE TAL")).toBeVisible();

  // Empresa: tudo preenchido, inclusive UF e município; o que o usuário digitou é preservado
  await page.getByRole("link", { name: "Empresas" }).click();
  await page.getByLabel("Origem do dado").fill("indicação");
  await page.getByLabel("CNPJ").fill(CNPJ);
  await expect(page.getByLabel("Razão social")).toHaveValue("MATERIAIS EXEMPLO LTDA");
  await expect(page.getByLabel("Nome fantasia")).toHaveValue("CASA EXEMPLO");
  await expect(page.getByLabel("CNAE principal")).toHaveValue("4744001");
  await expect(page.getByLabel("UF")).toHaveValue("RN");
  await expect(page.getByLabel("Município")).toHaveValue("2408102");
  await expect(page.getByLabel("Origem do dado")).toHaveValue("indicação");
  await expect(page.getByText("Situação cadastral: ATIVA")).toBeVisible();
  await expect(page.getByText("1 sócio(s) no quadro societário")).toBeVisible();
  await page.getByRole("button", { name: "Cadastrar empresa" }).click();
  await page.getByRole("link", { name: "MATERIAIS EXEMPLO LTDA" }).click();

  const receita = page.getByRole("region", { name: "Dados da Receita Federal" });
  await expect(receita).toContainText("RUA DAS FLORES, 100 · CENTRO · NATAL/RN · CEP 59000-000");
  await expect(receita).toContainText("(84) 3222-1234");
  await expect(receita).toContainText("FULANA DE TAL");
  await expect(receita).toContainText("Sócio-Administrador");
  await expect(receita).toContainText("CNAEs secundários (1)");

  // Prospecção: fonte "Receita Federal" preenchida (usa a consulta já salva, sem nova chamada)
  const before = calls.length;
  await page.getByRole("link", { name: "Leads" }).click();
  await expect(page).toHaveURL(/\/leads$/);
  await page.getByLabel("CNPJ").fill(CNPJ);
  await expect(page.getByLabel("Razão social")).toHaveValue("MATERIAIS EXEMPLO LTDA");
  await expect(page.getByLabel("Fonte do dado")).toHaveValue("Receita Federal (dados abertos) via BrasilAPI");
  await expect(page.getByLabel("UF")).toHaveValue("RN");
  expect(calls.length).toBe(before);

  // CNPJ inexistente: aviso, nada é preenchido
  await page.getByRole("link", { name: "Empresas" }).click();
  await expect(page).toHaveURL(/\/empresas$/);
  await page.getByLabel("CNPJ").fill("11.222.333/0001-81");
  await expect(page.getByText("CNPJ não encontrado na base da Receita Federal.")).toBeVisible();
  await expect(page.getByLabel("Razão social")).toHaveValue("");
});
