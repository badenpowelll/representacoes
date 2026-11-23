"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decryptToken, hasTokenKey } from "@/lib/email/crypto";
import { revokeGoogleToken } from "@/lib/email/google";

const page = (t: string, q: string) => `/app/${t}/mensagens?${q}`;

const templateSchema = z.object({
  purpose: z.enum(["prospeccao", "catalogo"]),
  channel: z.enum(["email", "whatsapp"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(10).max(5000),
});

/** Texto padrão da representação (admin/gerente). */
export async function saveDefaultTemplate(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) redirect(page(ctx.tenantId, "erro=permissao"));
  const p = templateSchema.safeParse({ purpose: form.get("purpose"), channel: form.get("channel"), subject: form.get("subject") ?? undefined, body: form.get("body") });
  if (!p.success || (p.data.channel === "email" && (p.data.subject?.length ?? 0) < 3)) redirect(page(ctx.tenantId, "erro=texto"));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("message_defaults").upsert(
    {
      tenant_id: ctx.tenantId,
      purpose: p.data.purpose,
      channel: p.data.channel,
      subject: p.data.channel === "email" ? p.data.subject : null,
      body: p.data.body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,purpose,channel" },
  );
  revalidatePath(`/app/${ctx.tenantId}`, "layout");
  redirect(page(ctx.tenantId, error ? "erro=salvar" : `salvo=${p.data.purpose}-${p.data.channel}`));
}

export async function resetDefaultTemplate(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) redirect(page(ctx.tenantId, "erro=permissao"));
  const p = templateSchema.pick({ purpose: true, channel: true }).safeParse({ purpose: form.get("purpose"), channel: form.get("channel") });
  if (!p.success) redirect(page(ctx.tenantId, "erro=texto"));
  const supabase = await createSupabaseServerClient();
  await supabase.from("message_defaults").delete().eq("tenant_id", ctx.tenantId).eq("purpose", p.data.purpose).eq("channel", p.data.channel);
  revalidatePath(`/app/${ctx.tenantId}`, "layout");
  redirect(page(ctx.tenantId, "restaurado=1"));
}

export async function saveSignature(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "catalog.write")) redirect(page(ctx.tenantId, "erro=permissao"));
  const sig = z.string().trim().max(1000).safeParse(form.get("email_signature") ?? "");
  if (!sig.success) redirect(page(ctx.tenantId, "erro=assinatura"));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("commercial_contexts")
    .upsert({ tenant_id: ctx.tenantId, email_signature: sig.data || null }, { onConflict: "tenant_id" });
  revalidatePath(`/app/${ctx.tenantId}`, "layout");
  redirect(page(ctx.tenantId, error ? "erro=salvar" : "salvo=assinatura"));
}

/** Desconecta a conta Google do próprio usuário: revoga no Google e apaga o token. */
export async function disconnectGmail(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("email_connection_secret", { p_tenant: ctx.tenantId });
  const c = (data as { ciphertext: string | null }[] | null)?.[0];
  if (c?.ciphertext && hasTokenKey()) {
    try {
      await revokeGoogleToken(decryptToken(c.ciphertext));
    } catch {
      // Mesmo sem conseguir revogar no Google, o token é apagado do banco.
    }
  }
  await supabase.rpc("email_connection_set_status", { p_tenant: ctx.tenantId, p_status: "revoked" });
  revalidatePath(`/app/${ctx.tenantId}/mensagens`);
  redirect(page(ctx.tenantId, "gmail=desconectado"));
}
