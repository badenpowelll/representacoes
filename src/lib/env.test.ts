import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseServerEnv } from "./env";

describe("env", () => {
  it("aceita configuração pública válida", () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }),
    ).toEqual({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" });
  });

  it("rejeita URL inválida e chave ausente", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "nao-e-url" })).toThrow();
  });

  it("APP_ENV padrão é development e valores desconhecidos são rejeitados", () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
    expect(parseServerEnv(base).APP_ENV).toBe("development");
    expect(() => parseServerEnv({ ...base, APP_ENV: "prod" })).toThrow();
  });
});
