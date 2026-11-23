/** Apenas caminhos internos, para evitar open redirect. */
export function safeNext(value: unknown, fallback = "/app"): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : fallback;
}
