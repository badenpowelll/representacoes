import { expect, test, type Page } from "@playwright/test";
import { totp } from "../tests/support/totp";

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

test("cadastro, onboarding, CRM, funil e isolamento entre representações", async ({ browser }) => {
  const password = `Senha-forte-${run}`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();

  await signUpAndConfirm(a, "Ana Alfa", `ana-${run}@alfa.test`, password);

  // Onboarding: sem MFA o administrador fica só com leitura
  await a.getByLabel("Nome da representação").fill("Alfa Representações");
  await a.getByLabel("Identificador").fill(`alfa-${run}`);
  await a.getByRole("button", { name: "Criar representação" }).click();
  await expect(a).toHaveURL(/\/app\/seguranca\?novo=1/);
  await a.getByRole("link", { name: "Agora não (somente leitura)" }).click();
  await expect(a.getByRole("heading", { name: "Painel" })).toBeVisible();
  const tenantUrl = a.url();
  await expect(a.getByText("Você está com acesso somente de leitura")).toBeVisible();
  await a.getByRole("link", { name: "Indústrias" }).click();
  await expect(a.getByRole("button", { name: "Cadastrar indústria" })).toHaveCount(0);
  await a.getByRole("link", { name: "Ativar ou confirmar agora" }).click();
  const secretA = await enrollTotp(a);
  await expect(a).toHaveURL(tenantUrl);
  await expect(a.getByText("Você está com acesso somente de leitura")).toHaveCount(0);

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

  // Contatos (LGPD): sem base legal padrão; finalidade e evidência exigidas;
  // oposição e exclusão com retorno explícito; recadastro continua bloqueado.
  await a.getByRole("link", { name: "Loja de Materiais Natal" }).click();
  await expect(a.getByLabel("Base legal (LGPD)")).toHaveValue("");
  await a.getByLabel("Nome do contato").fill("Rita Compras");
  await a.getByLabel("E-mail").fill(`rita-${run}@loja.test`);
  await a.getByLabel("Origem do contato").fill("cartão de visita");
  await a.getByRole("button", { name: "Adicionar contato" }).click();
  await expect(a.getByText("Selecione a base legal")).toBeVisible();
  await a.getByLabel("Base legal (LGPD)").selectOption("consent");
  await a.getByRole("button", { name: "Adicionar contato" }).click();
  await expect(a.getByText("Escolha ao menos uma finalidade")).toBeVisible();
  await expect(a.getByText("Confirme que o contato deu consentimento")).toBeVisible();
  await expect(a.getByText("Descreva como o consentimento foi obtido")).toBeVisible();
  await a.getByLabel("Prospecção comercial").check();
  await a.getByLabel(/deu consentimento/).check();
  await a.getByLabel("Evidência do consentimento").fill("formulário assinado na feira de Natal");
  await a.getByRole("button", { name: "Adicionar contato" }).click();
  await expect(a.getByText("Contato cadastrado.")).toBeVisible();
  const rita = a.getByRole("listitem").filter({ hasText: "Rita Compras" });
  await expect(rita).toContainText("consentimento em");
  await expect(rita).toContainText("Pode receber prospecção por e-mail");
  await rita.getByRole("button", { name: "Registrar oposição (não contatar)" }).click();
  await expect(rita).toContainText("Oposição registrada.");
  await expect(rita).toContainText("Comunicação bloqueada: oposição registrada");
  await rita.getByRole("button", { name: "Excluir dados de Rita Compras" }).click();
  await expect(a.getByRole("listitem").filter({ hasText: "Rita Compras" })).toHaveCount(0);
  // Recadastro do mesmo e-mail (legítimo interesse com justificativa) continua bloqueado.
  await a.getByLabel("Nome do contato").fill("Rita Recadastrada");
  await a.getByLabel("E-mail").fill(`RITA-${run}@loja.test`);
  await a.getByLabel("Origem do contato").fill("site da empresa");
  await a.getByLabel("Base legal (LGPD)").selectOption("legitimate_interest");
  await a.getByLabel("Prospecção comercial").check();
  await a.getByLabel("Justificativa da base legal").fill("Compradora de materiais de construção, segmento atendido");
  await a.getByRole("button", { name: "Adicionar contato" }).click();
  await expect(a.getByText("Contato cadastrado.")).toBeVisible();
  await expect(a.getByRole("listitem").filter({ hasText: "Rita Recadastrada" }))
    .toContainText("Comunicação bloqueada: e-mail ou domínio na lista de supressão");

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

  // Novo login de administrador passa pelo desafio TOTP
  await a.getByLabel("E-mail").fill(`ana-${run}@alfa.test`);
  await a.getByLabel("Senha").fill(password);
  await a.getByRole("button", { name: "Entrar" }).click();
  await expect(a).toHaveURL(/\/app\/seguranca/);
  await submitTotp(a, secretA);
  await a.goto(`${tenantUrl}/industrias`);
  await expect(a.getByRole("button", { name: "Cadastrar indústria" })).toBeVisible();
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
  await createTenant(admin, "Gama Representações", `gama-${run}`);
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
  await createTenant(page, "Delta Representações", `delta-${run}`);

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
  await page.getByLabel("UF inteira").check();
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Cobertura adicionada.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "RN", exact: true })).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tintas Delta" });
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByLabel("UF inteira").check();
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Esta cobertura já está cadastrada.")).toBeVisible();

  // Sem escolher a abrangência, o servidor recusa (não vira cobertura estadual por omissão).
  await page.reload();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tintas Delta" });
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Escolha UF inteira ou um município")).toBeVisible();

  // Lista de municípios indisponível: cobertura municipal é recusada.
  await page.route("**/rest/v1/ref_municipalities*", (r) =>
    r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "indisponível" }) }));
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tintas Delta" });
  await page.getByLabel("UF", { exact: true }).selectOption("CE");
  await page.getByLabel("Um município").check();
  await expect(page.getByText("Não foi possível carregar os municípios.")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("A lista de municípios não carregou.", { exact: false })).toBeVisible();
  await expect(page.getByRole("cell", { name: "CE", exact: true })).toHaveCount(0);
  await page.unroute("**/rest/v1/ref_municipalities*");

  // Cobertura por município (referência do IBGE), com troca rápida de UF.
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tintas Delta" });
  await page.getByLabel("UF", { exact: true }).selectOption("CE");
  await page.getByLabel("Um município").check();
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByLabel("Município", { exact: true }).selectOption({ label: "Mossoró" });
  await page.getByRole("button", { name: "Adicionar cobertura" }).click();
  await expect(page.getByText("Cobertura adicionada.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Mossoró" })).toBeVisible();
});

test("compatibilidade: calcula score explicável e aprovação gera lead", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Fábio Admin", `fabio-${run}@epsilon.test`, `Senha-forte-${run}`);
  await createTenant(page, "Epsilon Representações", `epsilon-${run}`);

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
  await page.getByLabel("UF inteira").check();
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

test("catálogos: sem indústria cadastrada, cria a indústria no próprio envio", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Hilda Admin", `hilda-${run}@teta.test`, `Senha-forte-${run}`);
  await createTenant(page, "Teta Representações", `teta-${run}`);
  await page.getByRole("link", { name: "Catálogos" }).click();
  await expect(page.getByText("Cadastre uma indústria antes")).toHaveCount(0);
  // Sem indústrias, o formulário já abre em "nova indústria".
  await expect(page.getByLabel("Indústria", { exact: true })).toHaveValue("nova");
  await page.getByLabel("Título").fill("Linha Verão");
  const pdf = { name: "verao.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") };
  await page.getByLabel("Arquivo PDF").setInputFiles(pdf);
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Informe o nome da indústria")).toBeVisible();

  await page.getByLabel("Nome da indústria").fill("Têxtil Teta");
  await page.getByLabel("Arquivo PDF").setInputFiles(pdf);
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Indústria cadastrada e catálogo enviado como rascunho.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Linha Verão" })).toContainText("Têxtil Teta");

  // Nome repetido não duplica a indústria: pede para escolher na lista.
  await page.getByLabel("Indústria", { exact: true }).selectOption("nova");
  await page.getByLabel("Nome da indústria").fill("têxtil teta");
  await page.getByLabel("Título").fill("Linha Inverno");
  await page.getByLabel("Arquivo PDF").setInputFiles(pdf);
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Já existe uma indústria com esse nome ou CNPJ")).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Têxtil Teta" });
  await page.getByLabel("Arquivo PDF").setInputFiles(pdf);
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Catálogo enviado como rascunho.")).toBeVisible();

  await page.getByRole("link", { name: "Indústrias" }).click();
  await expect(page.getByRole("cell", { name: "Têxtil Teta" })).toHaveCount(1);
});

test("catálogos: envia PDF privado, rejeita arquivo que não é PDF", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Gil Admin", `gil-${run}@zeta.test`, `Senha-forte-${run}`);
  await createTenant(page, "Zeta Representações", `zeta-${run}`);
  await page.getByRole("link", { name: "Indústrias" }).click();
  await page.getByLabel("Nome").fill("Metais Zeta");
  await page.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(page.getByRole("cell", { name: "Metais Zeta" })).toBeVisible();

  await page.getByRole("link", { name: "Catálogos" }).click();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Metais Zeta" });
  await page.getByLabel("Título").fill("Linha 2027");
  await page.getByLabel("Arquivo PDF").setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("não sou pdf") });
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("O arquivo precisa ser um PDF")).toBeVisible();

  await page.getByLabel("Arquivo PDF").setInputFiles({
    name: "linha.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Catálogo enviado como rascunho.")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Linha 2027" });
  await expect(item).toContainText("v1 · Rascunho");
  const href = await item.getByRole("link", { name: "Abrir PDF" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Produtos: preço autorizado com vigência, vínculo ao catálogo e SKU único por indústria
  await page.getByRole("link", { name: "Produtos" }).click();
  await expect(page.getByRole("heading", { name: "Novo produto" })).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Metais Zeta" });
  await page.getByLabel("SKU").fill("PRF-10");
  await page.getByLabel("Nome do produto").fill("Perfil de aço 10 mm");
  await page.getByLabel("Preço autorizado (R$)").fill("1.234,5");
  await page.getByLabel("Preço válido até").fill("2027-06-30");
  await page.getByLabel("Catálogo de origem").selectOption({ label: "Linha 2027 v1 (Metais Zeta)" });
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  // Preço sem procedência é recusado (o agente nunca usa preço sem origem documentada).
  await expect(page.getByText("Informe a origem do preço", { exact: false })).toBeVisible();
  await expect(page.getByText("Informe a referência do documento")).toBeVisible();
  await page.getByLabel("Origem do preço").fill("tabela de preços da indústria");
  await page.getByLabel("Referência do documento").fill("Tabela 11/2026");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Produto cadastrado.")).toBeVisible();
  const prod = page.getByRole("row").filter({ hasText: "PRF-10" });
  await expect(prod).toContainText("R$ 1.234,50");
  await expect(prod).toContainText("Pode ir em comunicações");
  await expect(prod).toContainText("Linha 2027 v1");
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Metais Zeta" });
  await page.getByLabel("SKU").fill("PRF-10");
  await page.getByLabel("Nome do produto").fill("Duplicado");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Já existe um produto com este SKU nesta indústria.")).toBeVisible();
  await page.getByLabel("SKU").fill("PRF-20");
  await page.getByLabel("Nome do produto").fill("Perfil sem preço");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Produto cadastrado.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "PRF-20" })).toContainText("Fora de comunicações: sem preço autorizado");
});

test("prospecção manual: fonte obrigatória, CNPJ reaproveitado e lead levado ao funil", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndConfirm(page, "Hugo Admin", `hugo-${run}@eta.test`, `Senha-forte-${run}`);
  await createTenant(page, "Eta Representações", `eta-${run}`);
  for (const name of ["Telhas Eta", "Tubos Eta"]) {
    await page.getByRole("link", { name: "Indústrias" }).click();
    await page.getByLabel("Nome").fill(name);
    await page.getByRole("button", { name: "Cadastrar indústria" }).click();
    await expect(page.getByRole("cell", { name })).toBeVisible();
  }

  await page.getByRole("link", { name: "Leads" }).click();
  await expect(page.getByRole("heading", { name: "Novo prospect" })).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Telhas Eta" });
  await page.getByLabel("Razão social").fill("Construtora Mossoró");
  await page.getByLabel("CNPJ").fill("11.222.333/0001-81");
  await page.getByRole("button", { name: "Registrar prospect" }).click();
  await expect(page.getByText(/Informe a fonte/)).toBeVisible();

  await page.getByLabel("Fonte do dado").fill("site da empresa");
  await page.getByLabel("UF", { exact: true }).selectOption("RN");
  await page.getByLabel("Município").selectOption({ label: "Mossoró" });
  await page.getByRole("button", { name: "Registrar prospect" }).click();
  await expect(page.getByText("Prospect e lead registrados.")).toBeVisible();

  // Mesmo CNPJ para outra indústria reaproveita a empresa; mesma indústria é recusada
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tubos Eta" });
  await page.getByLabel("Razão social").fill("Construtora Mossoró Ltda");
  await page.getByLabel("CNPJ").fill("11222333000181");
  await page.getByLabel("Fonte do dado").fill("feira do setor");
  await page.getByRole("button", { name: "Registrar prospect" }).click();
  await expect(page.getByText("Lead registrado para uma empresa já cadastrada (mesmo CNPJ).")).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Tubos Eta" });
  await page.getByLabel("Razão social").fill("Construtora Mossoró");
  await page.getByLabel("CNPJ").fill("11222333000181");
  await page.getByLabel("Fonte do dado").fill("feira do setor");
  await page.getByRole("button", { name: "Registrar prospect" }).click();
  await expect(page.getByText("Já existe um lead desta empresa para esta indústria.")).toBeVisible();

  const telhas = page.getByRole("listitem").filter({ hasText: "Telhas Eta" });
  await expect(telhas).toContainText("Fonte: site da empresa");
  await telhas.getByRole("button", { name: "Levar ao funil" }).click();
  await expect(telhas).toContainText("No funil");
  await expect(telhas).toContainText("Qualificado");

  await page.getByRole("link", { name: "Funil" }).click();
  await expect(page.getByRole("region", { name: /Novo/ }).getByText("Construtora Mossoró · Telhas Eta")).toBeVisible();
});
