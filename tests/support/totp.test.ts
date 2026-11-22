import { describe, expect, it } from "vitest";
import { totp } from "./totp";

// Vetores do RFC 6238 (SHA-1, segredo "12345678901234567890", 8 dígitos).
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
describe("totp", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [2000000000, "69279037"],
  ])("t=%i", (t, expected) => expect(totp(secret, t * 1000, 8)).toBe(expected));
});
