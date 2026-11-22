import { requireTenantPage } from "@/lib/auth/session";
import { ROLE_LABELS, assignableRoles, can, isTenantRole } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui";
import { InviteForm } from "./invite-form";
import { revokeInvitation } from "./actions";

export const metadata = { title: "Equipe · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const manage = can(ctx.role, "invitations.manage");
  const [members, invites] = await Promise.all([
    supabase.from("memberships").select("id, role, status, profiles:user_id(full_name, email)").eq("tenant_id", tenantId).order("created_at"),
    manage
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at, accepted_at, revoked_at")
          .eq("tenant_id", tenantId)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  type Member = { id: string; role: string; status: string; profiles: { full_name: string | null; email: string | null } | null };
  const list = (members.data ?? []) as unknown as Member[];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Equipe</h1>
      {members.error && <Alert kind="error">Não foi possível carregar a equipe.</Alert>}
      <ul className="divide-y rounded-lg border">
        {list.map((m) => (
          <li key={m.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
            <span>
              <span className="font-medium">{m.profiles?.full_name ?? m.profiles?.email ?? "Usuário"}</span>{" "}
              <span className="text-neutral-500">{m.profiles?.email}</span>
            </span>
            <span>
              {isTenantRole(m.role) ? ROLE_LABELS[m.role] : m.role}
              {m.status !== "active" && " (revogado)"}
            </span>
          </li>
        ))}
      </ul>
      {manage && (
        <>
          <section aria-labelledby="convidar" className="rounded-lg border p-4">
            <h2 id="convidar" className="mb-4 font-medium">
              Convidar colaborador
            </h2>
            <InviteForm tenantId={tenantId} roles={assignableRoles(ctx.role)} />
          </section>
          <section aria-labelledby="pendentes">
            <h2 id="pendentes" className="mb-2 font-medium">
              Convites pendentes
            </h2>
            {invites.data?.length ? (
              <ul className="divide-y rounded-lg border">
                {invites.data.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span>
                      {i.email} · {isTenantRole(i.role) ? ROLE_LABELS[i.role] : i.role} · expira em{" "}
                      {new Date(i.expires_at).toLocaleDateString("pt-BR")}
                    </span>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="invitation_id" value={i.id} />
                      <button className="text-red-700 underline">Revogar</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">Nenhum convite pendente.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
