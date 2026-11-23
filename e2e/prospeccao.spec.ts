import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { totp } from "../tests/support/totp";
import { assertLocalUrl } from "../tests/support/local-url";

/*
 * Prospecção automática: indústria com perfil pronto → tabela de empresas da base
 * pública (aqui, registros SINTÉTICOS gravados direto no Postgres local, no papel
 * do importador) → adicionar à carteira → WhatsApp e e-mail com texto editável.
 */
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const run = Date.now().toString(36);
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

test.beforeAll(async () => {
  const u = new URL(DB_URL);
  assertLocalUrl(`http://${u.hostname}:${u.port}`, "E2E_DB_URL", ["54322"]);
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(
    `insert into ref.cnpj_establishments (cnpj, legal_name, trade_name, is_headquarters, opened_on, main_cnae, state_code,
       municipality_id, district, phones, email, company_size, dataset_ref) values
     ('98000000000101', 'HOSPITAL EXEMPLO NATAL LTDA', 'HOSPITAL EXEMPLO', true, '2008-05-10', '8610101', 'RN', 2408102, 'TIROL', '{8432000000,84999990000}', 'contato@hospital-exemplo.test', '05', '2026-10'),
     ('98000000000202', 'CLINICA EXEMPLO MOSSORO LTDA', null, true, '2015-02-01', '8630503', 'RN', 2408003, 'CENTRO', '{84988880000}', 'clinica@exemplo.test', '01', '2026-10'),
     ('98000000000303', 'HOSPITAL EXEMPLO FORTALEZA LTDA', null, true, '2001-01-01', '8610101', 'CE', 2304400, null, '{8530000000}', null, '05', '2026-10')
     on conflict (cnpj) do nothing`,
  );
  await db.query(
    "insert into ref.cnpj_imports (dataset_ref, states, cnaes, rows_upserted, status, finished_at) values ('2026-10', '{RN,CE}', '{8610101,8630503}', 3, 'done', now())",
  );
  await db.end();
});

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

async function onboard(page: Page) {
  const email = `pros-${run}@alfa.test`;
  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill("Paula Prospecção");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(`Senha-forte-${run}`);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText("link de confirmação");
  await page.goto(await confirmationLink(email));
  await page.getByLabel("Nome da representação").fill("Quindin Teste");
  await page.getByLabel("Identificador").fill(`quindin-${run}`);
  await page.getByRole("button", { name: "Criar representação" }).click();
  await expect(page).toHaveURL(/\/app\/seguranca\?novo=1/);
  // MFA de administrador (obrigatório por padrão); se o ambiente desligou, segue.
  const configure = page.getByRole("button", { name: "Configurar aplicativo autenticador" });
  if (await configure.isVisible().catch(() => false)) {
    await configure.click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
      await page.getByRole("button", { name: "Verificar" }).click();
      const ok = await page.waitForURL((u) => !u.pathname.startsWith("/app/seguranca"), { timeout: 10_000 }).then(() => true, () => false);
      if (ok) break;
      await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    }
  }
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
}

test("prospecção: material hospitalar → tabela → carteira → WhatsApp e e-mail editáveis", async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1360, height: 900 } });
  // O WhatsApp real não é aberto: o link é interceptado e conferido.
  const waUrls: string[] = [];
  await context.route("https://wa.me/**", (route) => {
    waUrls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>wa.me (simulado)</p>" });
  });
  const page = await context.newPage();
  await onboard(page);

  await page.getByRole("link", { name: "Prospecção", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Comece pela indústria que você representa" })).toBeVisible();
  await page.getByLabel("Nome da indústria representada").fill("Hospitalar Exemplo");
  await page.getByRole("button", { name: "Criar e ver empresas" }).click();

  // Só RN (território padrão) e só CNAEs do perfil: o hospital do CE não aparece.
  await expect(page.getByText(/\d+ empresa\(s\) encontradas/)).toBeVisible();
  await expect(page.getByRole("row", { name: /EXEMPLO/ })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: /HOSPITAL EXEMPLO/ }).first()).toBeVisible();
  await expect(page.getByText("HOSPITAL EXEMPLO FORTALEZA LTDA")).toHaveCount(0);
  await expect(page.getByText("publicação 2026-10")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prospeccao-tabela.png`, fullPage: true });

  // WhatsApp: telefone celular sugerido, texto pronto e editável; link wa.me.
  const hospital = page.getByRole("row", { name: /HOSPITAL EXEMPLO NATAL LTDA/ });
  await hospital.getByRole("button", { name: "WhatsApp" }).click();
  const composer = page.getByRole("region", { name: /WhatsApp para HOSPITAL EXEMPLO/ });
  await expect(composer.getByLabel("Telefone com DDD")).toHaveValue("(84) 99999-0000");
  await expect(composer.getByLabel("Mensagem")).toHaveValue(/Paula Prospecção, da Quindin Teste, representante da Hospitalar Exemplo em RN/);
  await composer.getByLabel("Mensagem").fill("Olá, equipe do Hospital Exemplo! Posso enviar nosso catálogo de material hospitalar?");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prospeccao-whatsapp.png` });
  const popup = context.waitForEvent("page");
  await composer.getByRole("button", { name: "Abrir no WhatsApp" }).click();
  const wa = await popup;
  await expect.poll(() => waUrls.length).toBe(1);
  expect(waUrls[0]).toContain("wa.me/5584999990000");
  expect(decodeURIComponent(waUrls[0])).toContain("Hospital Exemplo! Posso enviar");
  expect(decodeURIComponent(waUrls[0])).toContain("responder SAIR");
  await wa.close();
  await expect(composer.getByText("O contato ficou registrado no histórico")).toBeVisible();
  await composer.getByRole("button", { name: "Fechar" }).click();
  await expect(hospital.getByText("Na carteira")).toBeVisible();

  // Lote: marca a clínica e adiciona à carteira.
  const clinic = page.getByRole("row", { name: /CLINICA EXEMPLO MOSSORO/ });
  await clinic.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Adicionar 1 à carteira" }).click();
  await expect(page.getByText("1 adicionada(s) à carteira")).toBeVisible();
  await expect(clinic.getByText("Na carteira")).toBeVisible();

  // E-mail com destinatário corrigido: fica salvo no contato, com registro da correção.
  await clinic.getByRole("button", { name: "E-mail" }).click();
  const mail = page.getByRole("region", { name: /E-mail para CLINICA EXEMPLO/ });
  await expect(mail.getByLabel("Assunto")).toHaveValue("Hospitalar Exemplo para CLINICA EXEMPLO MOSSORO LTDA");
  await mail.getByLabel("Para (e-mail)").fill("compras@clinica-exemplo.test");
  await mail.getByRole("button", { name: "Abrir no meu e-mail" }).click();
  await expect(mail.getByText("O contato ficou registrado no histórico")).toBeVisible();
  await mail.getByRole("button", { name: "Fechar" }).click();
  await clinic.getByRole("link", { name: "Editar dados" }).click();
  await expect(page.getByText("compras@clinica-exemplo.test")).toBeVisible();
  await expect(page.getByText(/corrigido manualmente/)).toBeVisible();

  // Modelo de WhatsApp editado pela tela.
  await page.goBack();
  await page.getByLabel("Mensagem", { exact: true }).last().fill("Olá {{empresa}}! Aqui é {{remetente}}. Posso mandar o catálogo?");
  await page.getByRole("button", { name: "Salvar modelo" }).last().click();
  await expect(page.getByText("Modelo de WhatsApp salvo.")).toBeVisible();

  // Mix: uma segunda indústria (laboratório) também vende para a clínica.
  const tenantId = new URL(page.url()).pathname.split("/")[2];
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const { rows } = await db.query(
    "insert into public.industries (tenant_id, name, target_cnaes) values ($1, 'Laboratorio Exemplo', '{8630503}') returning id",
    [tenantId],
  );
  await db.query("insert into public.territories (tenant_id, industry_id, state_code) values ($1, $2, 'RN')", [tenantId, rows[0].id]);
  await db.end();
  await page.goto(`/app/${tenantId}/prospeccao`);
  await expect(page.getByRole("heading", { name: "Um cliente, várias indústrias" })).toBeVisible();
  const clinicMix = page.getByRole("row", { name: /CLINICA EXEMPLO MOSSORO/ });
  await expect(clinicMix.getByText("✓ Hospitalar Exemplo")).toBeVisible();
  await expect(clinicMix.getByText("Laboratorio Exemplo", { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prospeccao-mix.png`, fullPage: true });

  // Ficha do cliente: vincular a indústria que faltava.
  await clinicMix.getByRole("link", { name: "Editar dados" }).click();
  const mix = page.getByRole("region", { name: "Indústrias para este cliente" });
  await expect(mix.getByText("1 compatível(is) ainda não oferecida(s)", { exact: false })).toBeVisible();
  await mix.getByRole("button", { name: "Vincular Laboratorio Exemplo" }).click();
  await expect(mix.getByText("2 vinculada(s)", { exact: false })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ficha-mix.png`, fullPage: true });

  // Compatibilidade: calcula todas e agrupa por cliente.
  await page.goto(`/app/${tenantId}/compatibilidade?industria=clientes`);
  await page.getByRole("button", { name: "Ver empresas compatíveis" }).click();
  const porCliente = page.getByRole("region", { name: "Indústrias que podem vender para cada cliente" });
  await expect(porCliente.getByRole("listitem").filter({ hasText: "CLINICA EXEMPLO MOSSORO" }).first()).toContainText("2 indústria(s)");
  await context.close();
});
