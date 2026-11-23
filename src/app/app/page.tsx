import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS, isTenantRole } from "@/lib/auth/permissions";
import { Alert } from "@/components/ui";
import { signOut } from "../(auth)/actions";

export const metadata = { title: "Representações · Rep360" };

export default async function Page({ searchParams }: { searchParams: Promise<{ acesso?: string }> }) {
  const { acesso } = await searchParams;
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("memberships")
    .select("role, tenants(id, name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (!error && data?.length === 0) redirect("/app/nova-representacao");
  type Row = { role: string; tenants: { id: string; name: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Suas representações</h1>
        <form action={signOut}>
          <button className="text-sm underline">Sair</button>
        </form>
      </div>
      {acesso === "negado" && <Alert kind="error">Você não tem acesso àquela representação.</Alert>}
      {error && <Alert kind="error">Não foi possível carregar suas representações.</Alert>}
      <ul className="flex flex-col gap-2">
        {rows.map((m) =>
          m.tenants ? (
            <li key={m.tenants.id}>
              <Link href={`/app/${m.tenants.id}`} className="block rounded-lg border p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <span className="font-medium">{m.tenants.name}</span>
                <span className="ml-2 text-sm text-neutral-500">{isTenantRole(m.role) ? ROLE_LABELS[m.role] : m.role}</span>
              </Link>
            </li>
          ) : null,
        )}
      </ul>
      <Link href="/app/nova-representacao" className="text-sm underline">
        Criar nova representação
      </Link>
    </main>
  );
}
