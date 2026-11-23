import { describe, expect, it } from "vitest";
import { addressOf, isOptOut, parseInbound, stripQuoted, telegramNotice } from "./inbound";
import { buildMime } from "./mime";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("leitura de respostas", () => {
  it("extrai o remetente", () => {
    expect(addressOf('"Compras" <Compras@Hospital.test>')).toBe("compras@hospital.test");
    expect(addressOf("compras@hospital.test")).toBe("compras@hospital.test");
    expect(addressOf(null)).toBeNull();
  });

  it("corta o texto citado em português e inglês", () => {
    expect(stripQuoted("Tenho interesse, me liga.\n\nEm seg., 23 de nov. de 2026 às 10:00, Lia <lia@x.test> escreveu:\n> Olá")).toBe("Tenho interesse, me liga.");
    expect(stripQuoted("Yes please\nOn Mon, Nov 23, 2026 Lia wrote:\n> hi")).toBe("Yes please");
    expect(stripQuoted("ok\n> citado")).toBe("ok");
  });

  it("reconhece o pedido para sair só na primeira linha", () => {
    expect(isOptOut("SAIR")).toBe(true);
    expect(isOptOut("sair.\n\nobrigado")).toBe(true);
    expect(isOptOut("Não quero receber")).toBe(true);
    expect(isOptOut("Quero saber mais antes de sair comprando")).toBe(false);
  });

  it("monta a resposta a partir da mensagem do Gmail, ignorando HTML quando há texto puro", () => {
    const m = parseInbound({
      id: "m1",
      threadId: "t1",
      internalDate: "1795000000000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Compras <compras@hospital.test>" },
          { name: "Subject", value: "Re: Catálogo" },
          { name: "Message-ID", value: "<abc@mail.test>" },
          { name: "References", value: "<orig@mail.test>" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Quero a tabela de preços.\n\nEm 23/11 Lia escreveu:\n> texto") } },
          { mimeType: "text/html", body: { data: b64("<p>ignorar</p>") } },
        ],
      },
    });
    expect(m).toMatchObject({ from: "compras@hospital.test", text: "Quero a tabela de preços.", rfcMessageId: "<abc@mail.test>", optOut: false, automatic: false });
    expect(m.references).toContain("<orig@mail.test>");
  });

  it("marca respostas automáticas", () => {
    const m = parseInbound({ id: "m2", threadId: "t", payload: { headers: [{ name: "From", value: "a@b.test" }, { name: "Auto-Submitted", value: "auto-replied" }] } });
    expect(m.automatic).toBe(true);
  });

  it("aviso do Telegram mostra o texto do cliente e como responder", () => {
    const t = telegramNotice({ company: "Hospital X", from: "a@b.test", subject: "Re: Catálogo", text: "Quero", optedOut: false });
    expect(t).toContain("Resposta de Hospital X");
    expect(t).toContain("Responder");
  });
});

describe("resposta na mesma conversa", () => {
  it("põe In-Reply-To e References e recusa quebra de linha", () => {
    const raw = buildMime({ from: "a@x.test", to: "b@y.test", subject: "Re: Oi", body: "ok", inReplyTo: "<abc@y.test>", references: "<orig@x.test> lixo" });
    expect(raw).toContain("In-Reply-To: <abc@y.test>");
    expect(raw).toContain("References: <orig@x.test> <abc@y.test>");
    expect(() => buildMime({ from: "a@x.test", to: "b@y.test", subject: "x", body: "y", inReplyTo: "<a>\r\nBcc: z@z.test" })).toThrow();
  });
});
