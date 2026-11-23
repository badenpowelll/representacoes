import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { totp } from "../tests/support/totp";
import { assertLocalUrl } from "../tests/support/local-url";

/*
 * Envio de catálogo em lote (modo assistido): clientes da prospecção (registros
 * SINTÉTICOS) → catálogo publicado → fila de WhatsApp com link do PDF.
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
     ('97000000000101', 'HOSPITAL LOTE NATAL LTDA', 'HOSPITAL LOTE', true, '2008-05-10', '8610101', 'RN', 2408102, 'TIROL', '{8432001111,84999991111}', 'contato@hospital-lote.test', '05', '2026-10'),
     ('97000000000202', 'CLINICA LOTE MOSSORO LTDA', null, true, '2015-02-01', '8630503', 'RN', 2408003, 'CENTRO', '{84988881111}', 'clinica@lote.test', '01', '2026-10'),
     ('97000000000303', 'HOSPITAL LOTE FORTALEZA LTDA', null, true, '2001-01-01', '8610101', 'CE', 2304400, null, '{8530001111}', null, '05', '2026-10')
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

async function onboard(page: Page, tag = "lote") {
  const email = `${tag}-${run}@alfa.test`;
  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill("Lia Lote");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(`Senha-forte-${run}`);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText("link de confirmação");
  await page.goto(await confirmationLink(email));
  await page.getByLabel("Nome da representação").fill("Lote Teste");
  await page.getByLabel("Identificador").fill(`${tag}-${run}`);
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

test("catálogo publicado enviado a vários clientes pelo WhatsApp, um clique por cliente", async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1360, height: 900 } });
  const waUrls: string[] = [];
  await context.route("https://wa.me/**", (route) => {
    waUrls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>wa.me (simulado)</p>" });
  });
  const page = await context.newPage();
  await onboard(page);

  // Clientes: duas empresas reais (sintéticas) do RN adicionadas pela prospecção.
  await page.getByRole("link", { name: "Prospecção", exact: true }).click();
  await page.getByLabel("Nome da indústria representada").fill("Hospitalar Lote");
  await page.getByRole("button", { name: "Criar e ver empresas" }).click();
  await page.getByRole("checkbox", { name: "Marcar HOSPITAL LOTE NATAL LTDA" }).check();
  await page.getByRole("checkbox", { name: "Marcar CLINICA LOTE MOSSORO LTDA" }).check();
  await page.getByRole("button", { name: /Adicionar 2 à carteira/ }).click();
  await expect(page.getByText("2 adicionada(s) à carteira")).toBeVisible();

  // Catálogo: envia o PDF e publica.
  await page.getByRole("link", { name: "Catálogos" }).click();
  await expect(page.getByRole("heading", { name: "Catálogos", level: 1 })).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Hospitalar Lote" });
  await page.getByLabel("Título").fill("Linha Hospitalar 2027");
  await page.getByLabel("Arquivo PDF").setInputFiles({ name: "linha.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Catálogo enviado como rascunho.")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Linha Hospitalar 2027" });
  await item.getByRole("button", { name: "Publicar" }).click();
  await item.getByRole("link", { name: "Enviar para clientes" }).click();

  // Fila de WhatsApp para os clientes da indústria.
  await expect(page.getByRole("heading", { name: "Enviar catálogo para vários clientes" })).toBeVisible();
  await page.getByRole("link", { name: "WhatsApp", exact: true }).click();
  await expect(page.getByText("Clientes (2)")).toBeVisible();
  await expect(page.getByLabel("Mensagem")).toHaveValue(/Lia Lote, da Lote Teste\. Segue o catálogo Linha Hospitalar 2027/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/envio-lote-montar.png`, fullPage: true });
  await page.getByRole("button", { name: "Montar fila de envio" }).click();
  await expect(page.getByText(/0\s*enviado\(s\) · 2\s*na fila/)).toBeVisible();

  const first = page.getByRole("region", { name: /Mensagem para/ });
  await expect(first.getByLabel("Mensagem")).toHaveValue(/Olá, (CLINICA LOTE MOSSORO LTDA|HOSPITAL LOTE)!/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/envio-lote-fila.png`, fullPage: true });
  const popup = context.waitForEvent("page");
  await first.getByRole("button", { name: "Abrir no WhatsApp" }).click();
  const wa = await popup;
  await expect.poll(() => waUrls.length).toBe(1);
  const text = decodeURIComponent(waUrls[0]);
  expect(text).toMatch(/wa\.me\/5584\d{8,9}\?/);
  expect(text).toContain("/storage/v1/object/sign/catalogs/");
  expect(text).toContain("responder SAIR");
  await wa.close();
  await expect(page.getByText("Registrado no histórico do cliente.")).toBeVisible();

  // O link do catálogo baixa o PDF de verdade.
  const pdfUrl = text.match(/https?:\/\/\S+\/storage\/v1\/object\/sign\/catalogs\/\S+/)![0];
  const res = await page.request.get(pdfUrl);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // O segundo cliente já fica aberto; pular registra e encerra a fila.
  await page.getByRole("region", { name: /Mensagem para/ }).getByRole("button", { name: "Pular" }).click();
  await expect(page.getByText(/1\s*enviado\(s\) · 0\s*na fila · 1\s*pulado/)).toBeVisible();
  await page.getByRole("link", { name: "← Envios" }).click();
  await expect(page.getByText("1 enviado(s) · 0 na fila · 0 bloqueado(s)")).toBeVisible();
  await context.close();
});

test("texto padrão e assinatura da representação; lote por e-mail enviado pelo sistema (modo de teste), uma vez por cliente", async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  await onboard(page, "direto");
  const tenantId = page.url().match(/\/app\/([0-9a-f-]{36})/)![1];

  // Texto padrão de catálogo por e-mail e assinatura próprios desta representação.
  await page.getByRole("link", { name: "Mensagens", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mensagens", level: 1 })).toBeVisible();
  await expect(page.getByText("teste (os e-mails são registrados, mas não saem)")).toBeVisible();
  await page.getByRole("textbox", { name: "Assinatura" }).fill("Lia Lote\nDireto Representações\n(84) 3200-0000");
  await page.getByRole("button", { name: "Salvar assinatura" }).click();
  await expect(page.getByText("Assinatura salva.")).toBeVisible();
  const tpl = page.getByRole("form", { name: /Envio de catálogo · E-mail/ });
  await tpl.getByLabel("Assunto").fill("Novidades {{catalogo}} para {{empresa}}");
  await tpl.getByLabel("Texto").fill("Prezados da {{empresa}}, aqui é {{remetente}}. Segue nosso catálogo {{catalogo}}: {{link_catalogo}}");
  await tpl.getByRole("button", { name: "Salvar texto" }).click();
  await expect(page.getByText("Texto padrão salvo.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mensagens.png`, fullPage: true });

  await page.getByRole("link", { name: "Prospecção", exact: true }).click();
  await page.getByLabel("Nome da indústria representada").fill("Hospitalar Direto");
  await page.getByRole("button", { name: "Criar e ver empresas" }).click();
  await page.getByRole("checkbox", { name: "Marcar HOSPITAL LOTE NATAL LTDA" }).check();
  await page.getByRole("checkbox", { name: "Marcar CLINICA LOTE MOSSORO LTDA" }).check();
  await page.getByRole("button", { name: /Adicionar 2 à carteira/ }).click();
  await expect(page.getByText("2 adicionada(s) à carteira")).toBeVisible();

  await page.getByRole("link", { name: "Catálogos" }).click();
  await expect(page.getByRole("heading", { name: "Catálogos", level: 1 })).toBeVisible();
  await page.getByLabel("Indústria", { exact: true }).selectOption({ label: "Hospitalar Direto" });
  await page.getByLabel("Título").fill("Linha Direta 2027");
  await page.getByLabel("Arquivo PDF").setInputFiles({ name: "linha.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });
  await page.getByRole("button", { name: "Enviar catálogo" }).click();
  await expect(page.getByText("Catálogo enviado como rascunho.")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Linha Direta 2027" });
  await item.getByRole("button", { name: "Publicar" }).click();
  await item.getByRole("link", { name: "Enviar para clientes" }).click();

  // O texto padrão da representação já vem preenchido.
  await expect(page.getByRole("heading", { name: "Enviar catálogo para vários clientes" })).toBeVisible();
  await expect(page.getByLabel("Mensagem")).toHaveValue(/^Prezados da /);
  await page.getByRole("button", { name: "Montar fila de envio" }).click();
  await expect(page.getByText(/0\s*enviado\(s\) · 2\s*na fila/)).toBeVisible();
  await expect(page.getByRole("region", { name: /Mensagem para/ }).getByLabel("Mensagem")).toHaveValue(/Prezados da (CLINICA LOTE MOSSORO LTDA|HOSPITAL LOTE)/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/envio-direto-fila.png`, fullPage: true });

  await page.getByRole("button", { name: "Enviar todos pelo sistema (2)" }).click();
  await expect(page.getByText("2 enviado(s).")).toBeVisible();

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const { rows } = await db.query(
      "select to_address, subject, body, status from public.email_messages where tenant_id = $1 order by to_address", [tenantId]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe("sandbox");
      expect(r.subject).toMatch(/^Novidades Linha Direta 2027 para /);
      expect(r.body).toContain("/storage/v1/object/sign/catalogs/");
      expect(r.body).toContain("Direto Representações");
      // Assinatura antes da linha de oposição.
      expect(r.body.indexOf("Direto Representações")).toBeLessThan(r.body.indexOf("SAIR"));
    }
    const sent = await db.query(
      "select count(*)::int as n from public.campaign_recipients where tenant_id = $1 and status = 'sent'", [tenantId]);
    expect(sent.rows[0].n).toBe(2);
    const acts = await db.query(
      "select count(*)::int as n from public.activities where tenant_id = $1 and metadata ->> 'mode' = 'sandbox'", [tenantId]);
    expect(acts.rows[0].n).toBe(2);
  } finally {
    await db.end();
  }
  await page.reload();
  await expect(page.getByText(/2\s*enviado\(s\) · 0\s*na fila/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Enviar todos pelo sistema/ })).toHaveCount(0);
  await context.close();
});
