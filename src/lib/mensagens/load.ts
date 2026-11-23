import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeTemplates, type TenantTemplates } from "./templates";

export async function loadTenantTemplates(supabase: SupabaseClient, tenantId: string): Promise<TenantTemplates> {
  const [{ data: rows }, { data: ctx }] = await Promise.all([
    supabase.from("message_defaults").select("purpose, channel, subject, body").eq("tenant_id", tenantId),
    supabase.from("commercial_contexts").select("email_signature").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  return mergeTemplates(rows ?? [], (ctx?.email_signature as string | null) ?? null);
}
