import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildMime, toBase64Url } from "./mime";
import { decryptToken, encryptToken } from "./crypto";
import { authUrl, googleEndpoints, newPkce, sendingMode } from "./google";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("MIME", () => {
  it("codifica assunto e corpo em UTF-8 e recusa injeção de cabeçalho", () => {
    const raw = buildMime({ from: "rep@empresa.com.br", fromName: "Ana Representações", to: "compras@cliente.com.br", subject: "Catálogo 2027", body: "Olá!\nSegue." });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?.+\?= <rep@empresa\.com\.br>$/m);
    const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Olá!\r\nSegue.");
    expect(() => buildMime({ from: "a@b.co", to: "x@y.co\r\nBcc: z@w.co", subject: "s", body: "b" })).toThrow();
    expect(() => buildMime({ from: "a@b.co", to: "x@y.co", subject: "s\nBcc: z@w.co", body: "b" })).toThrow();
    expect(toBase64Url("??>>")).not.toMatch(/[+/=]/);
  });
});

describe("token cifrado", () => {
  it("cifra e decifra; outra chave ou texto alterado falham", () => {
    const c = encryptToken("1//refresh-token", KEY);
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("refresh");
    expect(decryptToken(c, KEY)).toBe("1//refresh-token");
    expect(() => decryptToken(c, Buffer.alloc(32, 8).toString("base64"))).toThrow();
    const parts = c.split(".");
    parts[3] = Buffer.from("x").toString("base64");
    expect(() => decryptToken(parts.join("."), KEY)).toThrow();
    expect(() => encryptToken("x", "curta")).toThrow();
  });
});

describe("Google OAuth", () => {
  it("usa PKCE S256, escopos mínimos e state", () => {
    const p = newPkce();
    const u = new URL(authUrl({ clientId: "cid", redirectUri: "https://app/cb", state: p.state, challenge: p.challenge }, googleEndpoints({})));
    expect(u.origin).toBe("https://accounts.google.com");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.send");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe(p.state);
  });
  it("servidor simulado só em desenvolvimento e localhost", () => {
    expect(googleEndpoints({ GOOGLE_API_BASE_URL: "http://127.0.0.1:4020/", APP_ENV: "development" }).token).toBe("http://127.0.0.1:4020/token");
    expect(googleEndpoints({ GOOGLE_API_BASE_URL: "http://127.0.0.1:4020/", APP_ENV: "production" }).token).toBe("https://oauth2.googleapis.com/token");
    expect(googleEndpoints({ GOOGLE_API_BASE_URL: "https://evil.example/", APP_ENV: "development" }).token).toBe("https://oauth2.googleapis.com/token");
  });
  it("envio real só com EMAIL_SENDING=gmail e credenciais", () => {
    expect(sendingMode({})).toBe("sandbox");
    expect(sendingMode({ EMAIL_SENDING: "gmail" })).toBe("sandbox");
    expect(sendingMode({ EMAIL_SENDING: "gmail", GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b" })).toBe("gmail");
  });
});
