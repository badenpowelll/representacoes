import { defineConfig } from "@playwright/test";

/**
 * E2E contra o app local (`pnpm build && pnpm start`) e a stack Supabase local
 * (`npx supabase start`). Os e-mails de confirmação são lidos no Mailpit local.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "pt-BR",
    trace: "off",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm start -p 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 60_000 },
});
