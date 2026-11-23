import Image from "next/image";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";

const FEATURES = [
  { title: "Catálogos e produtos", text: "Envio privado de catálogos, versões, preços autorizados e vigência por indústria." },
  { title: "Prospecção e CRM", text: "Leads com fonte e data registradas, CNPJ, contatos e base legal da LGPD." },
  { title: "Funil comercial", text: "Do novo contato ao ganho, com tarefas, histórico e motivos de perda." },
];

export default function Home() {
  const configured = isSupabaseConfigured();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-center gap-3">
            <Image src="/brand/argos-simbolo.png" alt="" width={48} height={26} priority className="h-[26px] w-12 object-contain" />
            <span className="text-lg font-bold tracking-tight text-argos-navy">
              Rep<span className="text-argos-orange">360</span>
            </span>
          </span>
          <Link href="/entrar" className="text-sm font-semibold text-argos-navy hover:underline">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-16 sm:px-6">
        <section className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-full bg-argos-tint-orange px-3 py-1 text-xs font-semibold text-[#8a3200]">
            Inteligência comercial para representações
          </p>
          <h1 className="text-4xl leading-none font-bold tracking-tight uppercase sm:text-5xl">Onde dados se tornam decisão.</h1>
          <p className="mt-6 text-lg leading-[1.4] text-neutral-600">
            Catálogos, prospecção, CRM e funil de vendas para empresas de representação comercial, com isolamento total
            entre representações.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/entrar"
              className="inline-flex min-h-[44px] items-center rounded-[10px] bg-argos-orange px-6 font-semibold text-argos-navy hover:bg-[#e65400]"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="inline-flex min-h-[44px] items-center rounded-[10px] border border-neutral-400 bg-white px-6 font-semibold text-argos-navy hover:bg-neutral-100"
            >
              Criar conta
            </Link>
          </div>
        </section>

        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-lg border p-5">
              <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full bg-argos-orange" />
              <h2 className="font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-neutral-600">{f.text}</p>
            </li>
          ))}
        </ul>

        <section aria-labelledby="status" className="rounded-lg border p-4">
          <h2 id="status" className="mb-2 text-sm font-semibold">
            Status do ambiente
          </h2>
          <p role="status" className="text-sm text-neutral-600">
            {configured
              ? "Supabase configurado."
              : "Supabase não configurado. Copie .env.example para .env.local e preencha as variáveis (veja o README)."}
          </p>
        </section>
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-6 text-sm text-neutral-500 sm:px-6">
          <span>Rep360 · uma solução Argos Soluções</span>
          <Image src="/brand/argos-logo.png" alt="Argos Soluções" width={96} height={87} className="h-auto w-24" />
        </div>
      </footer>
    </div>
  );
}
