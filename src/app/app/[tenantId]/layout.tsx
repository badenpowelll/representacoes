import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId).single();
  const base = `/app/${tenantId}`;
  const links = [
    { href: base, label: "Painel" },
    { href: `${base}/contexto`, label: "Contexto" },
    { href: `${base}/industrias`, label: "Indústrias" },
    { href: `${base}/territorios`, label: "Territórios" },
    { href: `${base}/empresas`, label: "Empresas" },
    { href: `${base}/funil`, label: "Funil" },
    { href: `${base}/equipe`, label: "Equipe" },
  ];
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/app" className="font-semibold">
            Rep360
          </Link>
          <span className="text-sm text-neutral-500">
            {tenant?.name} · {ROLE_LABELS[ctx.role]}
          </span>
          <nav aria-label="Principal" className="flex flex-wrap gap-4 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="hover:underline">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
