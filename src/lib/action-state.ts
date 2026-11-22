export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Valores enviados, para repreencher o formulário após erro (React reseta o form). */
  values?: Record<string, string>;
  /** Muda a cada resposta; usado como `key` do formulário. */
  nonce?: number;
};

/** Anexa os valores enviados a uma resposta de erro. */
export function withValues(state: ActionState, form: FormData): ActionState {
  if (state.ok) return { ...state, nonce: Date.now() };
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !/password/i.test(k)) values[k] = v;
  return { ...state, values, nonce: Date.now() };
}

export const initialState: ActionState = {};

/** Converte erros do zod em mensagens por campo. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "form");
    out[key] ??= i.message;
  }
  return out;
}

/** Mensagem amigável para erros do Postgres/PostgREST, sem vazar detalhes internos. */
export function dbErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "Erro inesperado.";
  switch (error.code) {
    case "23505":
      return "Já existe um registro com esses dados.";
    case "42501":
      return "Você não tem permissão para esta ação.";
    case "23514":
      return "Os dados não atendem às regras de validação.";
    case "22023":
      return error.message ?? "Dados inválidos.";
    default:
      return "Não foi possível concluir a operação. Tente novamente.";
  }
}
