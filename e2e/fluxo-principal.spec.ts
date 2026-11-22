import { expect, test, type Page } from "@playwright/test";

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

test("cadastro, onboarding, CRM, funil e isolamento entre representações", async ({ browser }) => {
  const password = `Senha-forte-${run}`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();

  await signUpAndConfirm(a, "Ana Alfa", `ana-${run}@alfa.test`, password);

  // Onboarding
  await a.getByLabel("Nome da representação").fill("Alfa Representações");
  await a.getByLabel("Identificador").fill(`alfa-${run}`);
  await a.getByRole("button", { name: "Criar representação" }).click();
  await expect(a.getByRole("heading", { name: "Painel" })).toBeVisible();
  const tenantUrl = a.url();

  // Indústria com CNPJ inválido → erro; válido → listado
  await a.getByRole("link", { name: "Indústrias" }).click();
  await a.getByLabel("Nome").fill("Cimentos Exemplo");
  await a.getByLabel("CNPJ").fill("11.222.333/0001-00");
  await a.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(a.getByText("CNPJ inválido")).toBeVisible();
  await a.getByLabel("CNPJ").fill("11.222.333/0001-81");
  await a.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(a.getByRole("cell", { name: "Cimentos Exemplo" })).toBeVisible();

  // Empresa
  await a.getByRole("link", { name: "Empresas" }).click();
  await a.getByLabel("Razão social").fill("Loja de Materiais Natal");
  await a.getByLabel("UF").selectOption("RN");
  await a.getByLabel("Origem do dado").fill("indicação de cliente");
  await a.getByRole("button", { name: "Cadastrar empresa" }).click();
  await expect(a.getByRole("cell", { name: "Loja de Materiais Natal" })).toBeVisible();

  // Funil: criar, mover, perda sem motivo bloqueada
  await a.getByRole("link", { name: "Funil" }).click();
  await a.getByLabel("Título").fill("Pedido de cimento");
  await a.getByLabel("Empresa").selectOption({ label: "Loja de Materiais Natal" });
  await a.getByLabel("Valor (R$)").fill("12.500,00");
  await a.getByRole("button", { name: "Criar negócio" }).click();
  const novo = a.getByRole("region", { name: /Novo/ });
  await expect(novo.getByText("Pedido de cimento")).toBeVisible();
  await novo.getByLabel("Mover para etapa").selectOption("won");
  await novo.getByRole("button", { name: "Mover" }).click();
  await expect(a.getByRole("region", { name: /Ganho/ }).getByText("Pedido de cimento")).toBeVisible();

  await a.getByRole("link", { name: "Painel" }).click();
  await expect(a.getByText("R$ 12.500,00")).toBeVisible();

  // Outro usuário não acessa a representação de Alfa pela URL
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signUpAndConfirm(b, "Bia Beta", `bia-${run}@beta.test`, password);
  await b.goto(tenantUrl);
  await expect(b).toHaveURL(/\/app\?acesso=negado|\/app\/nova-representacao/);
  await b.goto(`${tenantUrl}/empresas`);
  await expect(b.getByText("Loja de Materiais Natal")).toHaveCount(0);

  // Sessão encerrada não acessa /app
  await a.goto("/app");
  await a.getByRole("button", { name: "Sair" }).click();
  await expect(a).toHaveURL(/\/entrar/);
  await a.goto(tenantUrl);
  await expect(a).toHaveURL(/\/entrar/);
});

test("login com senha errada mostra erro genérico", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(`naoexiste-${run}@exemplo.test`);
  await page.getByLabel("Senha").fill("qualquer-coisa");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});
