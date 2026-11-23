"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export type NavItem = { href: string; label: string; icon: IconName };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * Casca da área autenticada no padrão visual Argos: menu lateral branco com o símbolo
 * da marca (fundo claro, versão a cores), item ativo marcado em laranja e barra superior
 * com a representação e o papel. Em telas pequenas o menu vira uma gaveta.
 */
export function AppShell({
  groups,
  homeHref,
  tenantName,
  roleLabel,
  banner,
  children,
}: {
  groups: NavGroup[];
  homeHref: string;
  tenantName: string;
  roleLabel: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === homeHref ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const current = groups.flatMap((g) => g.items).find((i) => isActive(i.href));

  const nav = (
    <nav aria-label="Principal" className="flex flex-col gap-6 px-3 py-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-argos-tint-navy/70 font-semibold text-argos-navy"
                        : "text-neutral-700 hover:bg-neutral-100 hover:text-argos-navy"
                    }`}
                  >
                    {active && <span aria-hidden="true" className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-argos-orange" />}
                    <Icon name={item.icon} className={active ? "text-argos-navy" : "text-neutral-500 group-hover:text-argos-navy"} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/app" className="flex items-center gap-3 rounded-[10px] px-2 py-1" aria-label="Rep360, trocar de representação">
      <Image src="/brand/argos-simbolo.png" alt="" width={48} height={26} priority className="h-[26px] w-12 object-contain" />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight text-argos-navy">
          Rep<span className="text-argos-orange">360</span>
        </span>
        <span className="mt-1 text-[11px] text-neutral-500">por Argos Soluções</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Menu lateral (desktop) */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-white lg:flex">
        <div className="flex h-16 items-center border-b px-4">{brand}</div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t px-5 py-4 text-xs text-neutral-500">
          <p className="font-medium text-argos-navy">Onde dados se tornam decisão.</p>
        </div>
      </aside>

      {/* Gaveta (mobile) */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-[rgba(0,15,55,0.55)]"
            onClick={() => setOpen(false)}
          />
          <aside id="menu-movel" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b px-4">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="rounded-md p-2 text-argos-navy hover:bg-neutral-100">
                <Icon name="close" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              className="-ml-1 rounded-md p-2 text-argos-navy hover:bg-neutral-100 lg:hidden"
              aria-label="Abrir menu"
              aria-expanded={open}
              aria-controls="menu-movel"
              onClick={() => setOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-neutral-500">{current?.label ?? "Rep360"}</p>
              <p className="truncate text-sm font-semibold text-argos-navy">{tenantName}</p>
            </div>
            <span className="hidden rounded-full bg-argos-tint-orange px-3 py-1 text-xs font-semibold text-[#8a3200] sm:inline">{roleLabel}</span>
            <Link href="/app" className="hidden rounded-[10px] border border-neutral-300 px-3 py-1.5 text-sm font-medium text-argos-navy hover:bg-neutral-100 sm:inline-flex">
              Trocar representação
            </Link>
          </div>
        </header>
        {banner}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export type IconName =
  | "dashboard"
  | "context"
  | "factory"
  | "map"
  | "book"
  | "box"
  | "building"
  | "target"
  | "spark"
  | "kanban"
  | "users"
  | "menu"
  | "close";

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  context: (
    <>
      <path d="M4 6h16M4 12h10M4 18h7" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  factory: (
    <>
      <path d="M3 21V10l6 4V10l6 4V6l6 3v12z" />
      <path d="M7 17h2M12 17h2M17 17h1" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19V5M9 7h6" />
    </>
  ),
  box: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="11" height="18" rx="1" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11M8 7h3M8 11h3M8 15h3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M5.5 7h1.5M11 7h2M17 7h1.5M11 11h2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
