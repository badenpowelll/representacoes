import { describe, expect, it } from "vitest";
import { isLocalUrl } from "./local-url";

describe("isLocalUrl", () => {
  it("aceita URLs locais", () => {
    expect(isLocalUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalUrl("http://localhost:3000/x")).toBe(true);
  });
  it("rejeita hosts que só começam com localhost, credenciais, https e portas fora da lista", () => {
    expect(isLocalUrl("http://localhost.example.com")).toBe(false);
    expect(isLocalUrl("http://localhost@host-remoto.com")).toBe(false);
    expect(isLocalUrl("http://user:pass@localhost:54321")).toBe(false);
    expect(isLocalUrl("https://projeto.supabase.co")).toBe(false);
    expect(isLocalUrl("http://127.0.0.1:5432", ["54321"])).toBe(false);
    expect(isLocalUrl("nao-e-url")).toBe(false);
    expect(isLocalUrl(undefined)).toBe(false);
  });
});
