import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell, type NavGroup } from "@/components/app-shell";

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
  const groups: NavGroup[] = [
    {
      label: "Visão geral",
      items: [
        { href: base, label: "Painel", icon: "dashboard" },
        { href: `${base}/contexto`, label: "Contexto", icon: "context" },
      ],
    },
    {
      label: "Representação",
      items: [
        { href: `${base}/industrias`, label: "Indústrias", icon: "factory" },
        { href: `${base}/territorios`, label: "Territórios", icon: "map" },
        { href: `${base}/catalogos`, label: "Catálogos", icon: "book" },
        { href: `${base}/produtos`, label: "Produtos", icon: "box" },
      ],
    },
    {
      label: "Comercial",
      items: [
        { href: `${base}/empresas`, label: "Empresas", icon: "building" },
        { href: `${base}/leads`, label: "Leads", icon: "target" },
        { href: `${base}/compatibilidade`, label: "Compatibilidade", icon: "spark" },
        { href: `${base}/funil`, label: "Funil", icon: "kanban" },
      ],
    },
    { label: "Organização", items: [{ href: `${base}/equipe`, label: "Equipe", icon: "users" }] },
  ];
  const banner = ctx.mfaPending ? (
    <div role="status" className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <p className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6 lg:px-8">
        Você está com acesso somente de leitura. Administradores precisam da verificação em duas etapas.{" "}
        <Link href={`/app/seguranca?next=${encodeURIComponent(base)}`} className="font-medium underline">
          Ativar ou confirmar agora
        </Link>
      </p>
    </div>
  ) : null;
  return (
    <AppShell
      groups={groups}
      homeHref={base}
      tenantName={tenant?.name ?? "Representação"}
      roleLabel={ROLE_LABELS[ctx.membershipRole]}
      banner={banner}
    >
      {children}
    </AppShell>
  );
}
