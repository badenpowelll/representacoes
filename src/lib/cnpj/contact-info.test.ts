import { describe, expect, it } from "vitest";
import { contactInfoSchema, withSources } from "./contact-info";

const parse = (website: string, channels: unknown) => contactInfoSchema.safeParse({ website, contact_channels: JSON.stringify(channels) });

describe("contactInfoSchema", () => {
  it("aceita vários canais com rótulo e completa https:// no site", () => {
    const r = parse("proc9.com.br", [
      { kind: "phone", label: "Comercial", value: "(51) 3478-2085" },
      { kind: "whatsapp", label: "Comercial", value: "(51) 3478-2085" },
      { kind: "email", label: "Licitações", value: "LICITA@proc9.com.br" },
      { kind: "email", label: "Financeiro", value: "financeiro@proc9.com.br" },
      { kind: "address", label: "", value: "Rua Claudino Gazzi, 93, Canoas/RS" },
      { kind: "phone", label: "vazio", value: "  " },
    ]);
    expect(r.success).toBe(true);
    expect(r.data?.website).toBe("https://proc9.com.br");
    expect(r.data?.contact_channels).toHaveLength(5);
    expect(r.data?.contact_channels[2].value).toBe("licita@proc9.com.br");
  });

  it("recusa e-mail inválido, telefone sem DDD e tipo desconhecido", () => {
    expect(parse("", [{ kind: "email", label: "", value: "não é email" }]).success).toBe(false);
    expect(parse("", [{ kind: "phone", label: "", value: "3478-2085" }]).success).toBe(false);
    expect(parse("", [{ kind: "fax", label: "", value: "x" }]).success).toBe(false);
    expect(contactInfoSchema.safeParse({ contact_channels: "{quebrado" }).success).toBe(false);
  });
});

describe("withSources", () => {
  const info = contactInfoSchema.parse({
    website: "https://proc9.com.br",
    contact_channels: JSON.stringify([
      { kind: "phone", label: "Receita", value: "(51) 3478-2085" },
      { kind: "email", label: "Comercial", value: "vendas1@proc9.com.br" },
      { kind: "email", label: "Receita", value: "contato@proc9.com.br" },
    ]),
  });

  it("marca como 'receita' só o que é igual ao dado da Receita", () => {
    const r = withSources(info, { phones: ["5134782085"], email: "CONTATO@proc9.com.br" });
    expect(r.contact_channels.map((c) => c.source)).toEqual(["receita", "manual", "receita"]);
    expect(r.website_source).toBe("manual");
  });

  it("sem consulta à Receita, tudo é manual", () => {
    expect(withSources(info, null).contact_channels.every((c) => c.source === "manual")).toBe(true);
  });
});
