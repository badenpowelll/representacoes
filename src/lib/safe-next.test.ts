import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("aceita caminhos internos", () => expect(safeNext("/app/x")).toBe("/app/x"));
  it("rejeita URLs externas e protocol-relative", () => {
    expect(safeNext("https://evil.test")).toBe("/app");
    expect(safeNext("//evil.test")).toBe("/app");
    expect(safeNext("/\\evil.test")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });
});
