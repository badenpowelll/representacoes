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

test("convite: admin gera link, convidado se cadastra e entra com o papel definido", async ({ browser }) => {
  const password = `Senha-forte-${run}`;
  const admin = await (await browser.newContext()).newPage();
  await signUpAndConfirm(admin, "Carla Admin", `carla-${run}@gama.test`, password);
  await admin.getByLabel("Nome da representação").fill("Gama Representações");
  await admin.getByLabel("Identificador").fill(`gama-${run}`);
  await admin.getByRole("button", { name: "Criar representação" }).click();
  await expect(admin.getByRole("heading", { name: "Painel" })).toBeVisible();
  const tenantUrl = admin.url();

  await admin.getByRole("link", { name: "Equipe" }).click();
  await admin.getByLabel("E-mail do convidado").fill(`davi-${run}@gama.test`);
  await admin.getByLabel("Papel").selectOption("representative");
  await admin.getByRole("button", { name: "Gerar convite" }).click();
  const link = await admin.getByLabel(/Link do convite/).inputValue();
  expect(link).toMatch(/\/convite\/[0-9a-f]{64}$/);
  await expect(admin.getByText(`davi-${run}@gama.test · Representante`)).toBeVisible();

  // Convidado abre o link sem conta → login → cadastro → confirmação → volta ao convite
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await expect(guest).toHaveURL(/\/entrar\?next=/);
  await guest.getByRole("link", { name: "Criar conta" }).click();
  await guest.getByLabel("Nome completo").fill("Davi Rep");
  await guest.getByLabel("E-mail").fill(`davi-${run}@gama.test`);
  await guest.getByLabel("Senha").fill(password);
  await guest.getByRole("button", { name: "Criar conta" }).click();
  await guest.goto(await confirmationLink(`davi-${run}@gama.test`));
  await expect(guest).toHaveURL(/\/convite\//);
  await guest.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guest).toHaveURL(tenantUrl);
  await expect(guest.getByText("Gama Representações · Representante")).toBeVisible();

  // Reutilizar o link falha
  await guest.goto(link);
  await guest.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guest.getByRole("alert").filter({ hasText: "Convite inválido" })).toBeVisible();

  // Representante não vê a área de convites
  await guest.goto(`${tenantUrl}/equipe`);
  await expect(guest.getByText("Carla Admin")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Gerar convite" })).toHaveCount(0);
});

test("contexto comercial e territórios", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Edu Admin", `edu-${run}@delta.test`, `Senha-forte-${run}`);
  await page.getByLabel("Nome da representação").fill("Delta Representações");
  await page.getByLabel("Identificador").fill(`delta-${run}`);
  await page.getByRole("button", { name: "Criar representação" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  await page.getByRole("link", { name: "Contexto" }).click();
  await page.getByLabel("CNAEs-alvo").fill("4744-0/01, 123");
  await page.getByRole("button", { name: "Salvar contexto" }).click();
  await expect(page.getByText("Cada CNAE deve ter 7 dígitos")).toBeVisible();
  await expect(page.getByLabel("CNAEs-alvo")).toHaveValue("4744-0/01, 123");
  await page.getByLabel("CNAEs-alvo").fill("4744-0/01, 4742300");
  await page.getByLabel("Segmentos-alvo").fill("construção, varejo");
  await page.getByRole("button", { name: "Salvar contexto" }).click();
  await expect(page.getByText("Contexto comercial salvo.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("CNAEs-alvo")).toHaveValue("4744001, 4742300");

  await page.getByRole("link", { name: "Indústrias" }).click();
  await page.getByLabel("Nome").fill("Tintas Delta");
  await page.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(page.getByRole("cell", { name: "Tintas Delta" })).toBeVisible();

  await page.getByRole("link", { name: "Territórios" }).click();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tintas Delta" });
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Cobertura adicionada.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "RN", exact: true })).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tintas Delta" });
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Esta cobertura já está cadastrada.")).toBeVisible();
});

test("compatibilidade: calcula score explicável e aprovação gera lead", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Fábio Admin", `fabio-${run}@epsilon.test`, `Senha-forte-${run}`);
  await page.getByLabel("Nome da representação").fill("Epsilon Representações");
  await page.getByLabel("Identificador").fill(`epsilon-${run}`);
  await page.getByRole("button", { name: "Criar representação" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  await page.getByRole("link", { name: "Contexto" }).click();
  await page.getByLabel("CNAEs-alvo").fill("4744001");
  await page.getByRole("button", { name: "Salvar contexto" }).click();
  await expect(page.getByText("Contexto comercial salvo.")).toBeVisible();

  await page.getByRole("link", { name: "Indústrias" }).click();
  await page.getByLabel("Nome").fill("Cerâmica Epsilon");
  await page.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(page.getByRole("cell", { name: "Cerâmica Epsilon" })).toBeVisible();

  await page.getByRole("link", { name: "Territórios" }).click();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Cerâmica Epsilon" });
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Cobertura adicionada.")).toBeVisible();

  for (const [name, uf] of [
    ["Depósito Mossoró", "RN"],
    ["Loja Fortaleza", "CE"],
  ]) {
    await page.getByRole("link", { name: "Empresas" }).click();
    await page.getByLabel("Razão social").fill(name);
    await page.getByLabel("CNAE principal").fill("4744001");
    await page.getByLabel("UF").selectOption(uf);
    await page.getByLabel("Origem do dado").fill("feira do setor");
    await page.getByRole("button", { name: "Cadastrar empresa" }).click();
    await expect(page.getByRole("cell", { name })).toBeVisible();
  }

  await page.getByRole("link", { name: "Compatibilidade" }).click();
  await page.getByRole("button", { name: "Calcular compatibilidade" }).click();
  const item = page.getByRole("listitem").filter({ hasText: "Depósito Mossoró" }).first();
  await expect(item).toContainText("70/100");
  await expect(item).toContainText("Cobertura na UF RN");
  await expect(item).toContainText("CNAE 4744001 é alvo");
  await expect(page.getByText("Loja Fortaleza")).toHaveCount(0);
  await item.getByRole("button", { name: "Aprovar e criar lead" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Depósito Mossoró" }).first()).toContainText("Aprovado");

  await page.getByRole("link", { name: "Painel" }).click();
  await expect(page.locator("div").filter({ hasText: /^Leads1$/ })).toBeVisible();
});
