import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";

export default function Home() {
  const configured = isSupabaseConfigured();
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold">Rep360</h1>
      <p className="text-lg">
        Inteligência comercial para empresas de representação: catálogos, prospecção, CRM e funil de vendas, com
        isolamento total entre representações.
      </p>
      <div className="flex gap-4">
        <Link href="/entrar" className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white">
          Entrar
        </Link>
        <Link href="/cadastro" className="rounded-md border px-4 py-2 font-medium">
          Criar conta
        </Link>
      </div>
      <section aria-labelledby="status" className="rounded-lg border p-4">
        <h2 id="status" className="mb-2 font-medium">
          Status do ambiente
        </h2>
        <p role="status">
          {configured
            ? "Supabase configurado."
            : "Supabase não configurado. Copie .env.example para .env.local e preencha as variáveis (veja o README)."}
        </p>
      </section>
    </main>
  );
}
