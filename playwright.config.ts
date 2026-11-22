import { defineConfig } from "@playwright/test";
import { assertLocalUrl } from "./tests/support/local-url";

// O e2e cria contas: só roda contra app, Supabase e Mailpit locais.
const baseURL = assertLocalUrl(process.env.E2E_BASE_URL ?? "http://localhost:3000", "E2E_BASE_URL", ["3000"]);
assertLocalUrl(process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324", "E2E_MAILPIT_URL", ["54324"]);
assertLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321", "NEXT_PUBLIC_SUPABASE_URL", ["54321"]);

/**
 * E2E contra o app local (`pnpm build && pnpm start`) e a stack Supabase local
 * (`npx supabase start`). Os e-mails de confirmação são lidos no Mailpit local.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    locale: "pt-BR",
    trace: "off",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm start -p 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 60_000 },
});
