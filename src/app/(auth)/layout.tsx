import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Painel institucional (somente texto sobre navy: a versão branca do logo ainda não foi fornecida) */}
      <aside
        aria-label="Sobre o Rep360"
        className="relative hidden overflow-hidden bg-argos-navy px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -bottom-40 h-[28rem] w-[28rem] rounded-full border-[48px] border-white/5" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/5" />
        <p className="relative text-lg font-bold tracking-tight">
          Rep<span className="text-argos-orange">360</span>
        </p>
        <div className="relative max-w-md">
          <p className="text-4xl leading-none font-bold tracking-tight uppercase text-white">
            Onde dados se tornam decisão.
          </p>
          <p className="mt-6 text-base leading-[1.4] text-white/80">
            Catálogos, prospecção, CRM e funil de vendas em um só lugar, com cada representação isolada e protegida.
          </p>
          <span className="mt-8 block h-1 w-16 rounded-full bg-argos-orange" />
        </div>
        <p className="relative text-sm text-white/60">Uma solução Argos Soluções</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="flex w-full max-w-md flex-col gap-6">
          <Link href="/" className="flex items-center gap-3 self-start" aria-label="Rep360, página inicial">
            <Image src="/brand/argos-simbolo.png" alt="" width={56} height={30} priority className="h-[30px] w-14 object-contain" />
            <span className="flex flex-col leading-none">
              <span className="text-xl font-bold tracking-tight text-argos-navy">
                Rep<span className="text-argos-orange">360</span>
              </span>
              <span className="mt-1 text-xs text-neutral-500">por Argos Soluções</span>
            </span>
          </Link>
          <div className="flex flex-col gap-6 rounded-[14px] border bg-white p-6 shadow-[0_1px_2px_rgba(0,15,55,0.04),0_8px_28px_rgba(0,15,55,0.06)] sm:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
