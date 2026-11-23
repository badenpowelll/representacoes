// Leitura mínima de robots.txt (RFC 9309): grupo do nosso user-agent ou "*",
// regras Allow/Disallow com curingas "*" e "$", vence a regra mais longa e,
// no empate, Allow.

export const USER_AGENT = "Rep360-ProdutosBot/1.0";
const TOKEN = "rep360-produtosbot";

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (field === "disallow" && value === "") {
        lastWasAgent = false;
        continue;
      }
      current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function ruleRegex(path) {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** true se o robots.txt permite que nosso robô abra a URL. */
export function isAllowed(robotsText, url) {
  const groups = parseRobots(robotsText);
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && TOKEN.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  const u = new URL(url);
  const target = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    if (!r.path || !ruleRegex(r.path).test(target)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
