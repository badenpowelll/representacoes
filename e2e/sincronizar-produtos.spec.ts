import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { totp } from "../tests/support/totp";
import { assertLocalUrl } from "../tests/support/local-url";

/*
 * Sincronização de produtos pelo site da indústria (ADR 0008), de ponta a ponta:
 * cadastra o site na tela Produtos → roda o robô de verdade (scripts/
 * sincronizar-produtos.mjs) contra um site SINTÉTICO servido localmente →
 * produtos aparecem sem preço, com link, foto e fichas → um produto some do
 * site e fica inativo, e a seção de novidades mostra o que entrou e saiu.
 */
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SITE_PORT = 4020;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const run = Date.now().toString(36);
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const FIX = join(__dirname, "..", "scripts", "lib", "fixtures");

let server: Server;
let listing = readFileSync(join(FIX, "lista-grade-js.html"), "utf8");
let watched = "<main><h1>Álcool saneante</h1><p>Álcool 70° INPM</p><p>Embalagem: 1 Litro</p></main>";
const detail = readFileSync(join(FIX, "detalhe-produto.html"), "utf8");

test.beforeAll(async () => {
  const u = new URL(DB_URL);
  assertLocalUrl(`http://${u.hostname}:${u.port}`, "E2E_DB_URL", ["54322"]);
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", SITE);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/robots.txt") return res.end("User-agent: *\nDisallow: /privado/\n");
    if (url.pathname === "/produtos.php" && url.searchParams.has("produto_id")) return res.end(detail);
    if (url.pathname === "/produtos.php") return res.end(listing);
    if (url.pathname === "/alcool") return res.end(watched);
    res.statusCode = 404;
    res.end("não encontrado");
  });
  await new Promise<void>((r) => server.listen(SITE_PORT, "127.0.0.1", r));
});
test.afterAll(async () => new Promise<void>((r) => server.close(() => r())));

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
  const email = `sync-${run}@alfa.test`;
  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill("Sílvia Sincroniza");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(`Senha-forte-${run}`);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText("link de confirmação");
  await page.goto(await confirmationLink(email));
  await page.getByLabel("Nome da representação").fill("Sync Teste");
  await page.getByLabel("Identificador").fill(`sync-${run}`);
  await page.getByRole("button", { name: "Criar representação" }).click();
  await expect(page).toHaveURL(/\/app\/seguranca\?novo=1/);
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

async function robot(sourceId?: string) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [join(__dirname, "..", "scripts", "sincronizar-produtos.mjs"), ...(sourceId ? ["--fonte", sourceId] : [])],
    { env: { ...process.env, DATABASE_URL: DB_URL }, timeout: 120_000 },
  ).catch((e: { stdout?: string; message: string }) => {
    throw new Error(`robô falhou: ${e.message}\n${e.stdout ?? ""}`);
  });
  return stdout;
}

test("site da indústria: cadastro, coleta, fichas, saída do site e novidades", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  await onboard(page);

  await page.getByRole("link", { name: "Indústrias", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Nutri Exemplo");
  await page.getByRole("button", { name: "Cadastrar indústria" }).click();
  await expect(page.getByText("Nutri Exemplo").first()).toBeVisible();

  await page.getByRole("link", { name: "Produtos", exact: true }).click();
  const sites = page.getByRole("region", { name: "Sites das indústrias" });
  await sites.getByLabel("Indústria do site").selectOption({ label: "Nutri Exemplo" });
  await sites.getByLabel("Página de produtos no site da indústria").fill("javascript:alert(1)");
  await sites.getByRole("button", { name: "Cadastrar site" }).click();
  await expect(sites.getByText("Endereço inválido")).toBeVisible();
  await sites.getByLabel("Página de produtos no site da indústria").fill(`${SITE}/produtos.php`);
  await sites.getByLabel("Nome da linha (opcional)").fill("Linha geral");
  await sites.getByRole("button", { name: "Cadastrar site" }).click();
  await expect(sites.getByText("Aguardando a primeira coleta")).toBeVisible();
  const sourceId = await sourceIdFromDb();

  // 1ª coleta: 3 produtos do site local (o 4º aponta para outro domínio, sem robots acessível).
  const out1 = await robot(sourceId);
  expect(out1).toMatch(/ok: \d+ no site, \d+ novos/);
  await page.reload();
  await expect(sites.getByText(/Coleta concluída em .* produtos no site/)).toBeVisible();
  const row = page.getByRole("row", { name: /SUPLEMENTO EXEMPLO VITAMINA C/ });
  await expect(row.getByText("Sem preço autorizado", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Ver no site da indústria" })).toHaveAttribute("href", `${SITE}/produtos.php?produto_id=101`);
  await expect(row.getByRole("link", { name: "FT" })).toHaveAttribute("href", "https://uploads.example/abc123");
  await expect(row.getByRole("link", { name: "FDS" })).toHaveAttribute("href", "https://uploads.example/def456");
  await expect(row.getByText("Fora de comunicações: sem preço autorizado")).toBeVisible();
  const novidades = page.getByRole("region", { name: /Novidades nos sites das indústrias/ });
  await expect(novidades.getByText(/Entraram \(\d+\)/)).toBeVisible();

  // A luva some do site: na coleta seguinte fica inativa e aparece em "Saíram".
  listing = listing.replace(/<li class="grid-item">(?:(?!<\/li>)[\s\S])*produto_id=102(?:(?!<\/li>)[\s\S])*<\/li>/, "");
  const out2 = await robot(sourceId);
  expect(out2).toContain("1 saíram");
  await page.reload();
  await expect(page.getByRole("row", { name: /LUVA DE PROCEDIMENTO EXEMPLO M/ }).getByText(/Inativo: saiu do site em/)).toBeVisible();
  await expect(novidades.getByText("Saíram do site (1)")).toBeVisible();

  // Site sem lista de produtos: só vigia a página e avisa quando o texto muda.
  await sites.getByLabel("Indústria do site").selectOption({ label: "Nutri Exemplo" });
  await sites.getByLabel("Página de produtos no site da indústria").fill(`${SITE}/alcool`);
  await sites.getByLabel("Tipo de página").selectOption("watch");
  await sites.getByLabel("Nome da linha (opcional)").fill("Álcool saneante");
  await sites.getByRole("button", { name: "Cadastrar site" }).click();
  await expect(sites.getByText("vigiando a página")).toBeVisible();
  const watchId = await sourceIdFromDb(`${SITE}/alcool`);
  expect(await robot(watchId)).toContain("referência guardado");
  watched = watched.replace("</main>", "<p>Álcool 70° Gel</p><p>Embalagem: 5 Litros</p></main>");
  expect(await robot(watchId)).toContain("A página mudou");
  await page.reload();
  await expect(novidades.getByText("Páginas vigiadas que mudaram (1)")).toBeVisible();
  await expect(novidades.getByText(/Entrou: Álcool 70° Gel \| Embalagem: 5 Litros/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/produtos-sites.png`, fullPage: true });
  await context.close();

  async function sourceIdFromDb(url = `${SITE}/produtos.php`) {
    const { Client } = await import("pg");
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      const { rows } = await db.query("select id from public.product_sources where url = $1 order by created_at desc limit 1", [url]);
      return rows[0].id as string;
    } finally {
      await db.end();
    }
  }
});
