/**
 * Garante que um teste que cria usuários/dados só fale com serviços LOCAIS.
 * Rejeita "http://localhost.exemplo.com", "http://localhost@host-remoto",
 * https para hosts remotos, credenciais na URL e portas fora da lista.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalUrl(value: string | undefined, allowedPorts?: readonly string[]): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (!LOCAL_HOSTS.has(url.hostname)) return false;
  if (allowedPorts && !allowedPorts.includes(url.port)) return false;
  return true;
}

export function assertLocalUrl(value: string | undefined, name: string, allowedPorts?: readonly string[]): string {
  if (!isLocalUrl(value, allowedPorts)) {
    throw new Error(`${name} precisa ser uma URL http local (localhost/127.0.0.1) em porta permitida; recebido: ${value ?? "(vazio)"}`);
  }
  return value!;
}
