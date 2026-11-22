"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { type ActionState, dbErrorMessage, withValues, zodFieldErrors } from "@/lib/action-state";
import { can, TENANT_ROLES, assignableRoles } from "@/lib/auth/permissions";
import { AuthorizationError, requireTenantContext } from "@/lib/auth/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formToObject } from "@/lib/validation/schemas";

const inviteSchema = z.object({
  email: z.email("Informe um e-mail válido").trim().toLowerCase(),
  role: z.enum(TENANT_ROLES, { message: "Selecione um papel" }),
});

export type InviteState = ActionState & { link?: string };

/**
 * Cria o convite e devolve o link UMA vez. Nenhum e-mail é enviado nesta fase:
 * o administrador compartilha o link manualmente.
 */
export async function inviteMember(_: InviteState, form: FormData): Promise<InviteState> {
  try {
    const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
    if (!can(ctx.role, "invitations.manage")) throw new AuthorizationError("Você não tem permissão para convidar.", 403);
    const parsed = inviteSchema.safeParse(formToObject(form));
    if (!parsed.success) return withValues({ fieldErrors: zodFieldErrors(parsed.error.issues) }, form);
    if (!assignableRoles(ctx.role).includes(parsed.data.role)) {
      return withValues({ fieldErrors: { role: "Você não pode atribuir este papel." } }, form);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .rpc("create_invitation", { p_tenant: ctx.tenantId, p_email: parsed.data.email, p_role: parsed.data.role })
      .single<{ invitation_id: string; token: string }>();
    if (error || !data) {
      return withValues(
        { message: error?.code === "23505" ? "Já existe um convite pendente para este e-mail." : dbErrorMessage(error) },
        form,
      );
    }
    const h = await headers();
    const origin = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    revalidatePath(`/app/${ctx.tenantId}/equipe`);
    return { ok: true, nonce: Date.now(), message: "Convite criado. Copie o link abaixo; ele não será exibido novamente.", link: `${origin}/convite/${data.token}` };
  } catch (e) {
    if (e instanceof AuthorizationError) return { message: e.message };
    throw e;
  }
}

export async function revokeInvitation(form: FormData) {
  const ctx = await requireTenantContext(String(form.get("tenant_id") ?? ""));
  if (!can(ctx.role, "invitations.manage")) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("revoke_invitation", { p_invitation: String(form.get("invitation_id") ?? "") });
  revalidatePath(`/app/${ctx.tenantId}/equipe`);
}
