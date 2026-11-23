import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente com a chave de serviço. SÓ para rotinas do servidor sem sessão de
 * usuário (webhooks do Gmail/Telegram e rotina diária), chamando as funções
 * svc_* (que fazem as próprias checagens) ou lendo um dado pontual já
 * restrito ao tenant da conversa. Nunca usar em páginas ou ações de usuário.
 */
export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
