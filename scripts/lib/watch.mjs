// Resumo da mudança de texto de uma página vigiada: linhas que entraram e saíram.
const norm = (t) =>
  (t ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 3);

export function pageTextSummary(before, after, max = 8) {
  const a = new Set(norm(before));
  const b = new Set(norm(after));
  const added = [...b].filter((l) => !a.has(l));
  const removed = [...a].filter((l) => !b.has(l));
  const fmt = (label, list) =>
    list.length ? `${label}: ${list.slice(0, max).map((l) => l.slice(0, 120)).join(" | ")}${list.length > max ? ` (+${list.length - max})` : ""}.` : "";
  return [fmt("Entrou", added), fmt("Saiu", removed)].filter(Boolean).join(" ") || null;
}
