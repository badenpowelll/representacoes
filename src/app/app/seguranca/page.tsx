import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/safe-next";
import { Alert } from "@/components/ui";
import { ChallengeTotp, EnrollTotp } from "./forms";

export const metadata = { title: "Verificação em duas etapas · Rep360" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; novo?: string }> }) {
  const { next: rawNext, novo } = await searchParams;
  const next = safeNext(rawNext);
  const { supabase } = await requireUser();
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verified = factors?.totp.find((f) => f.status === "verified");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Verificação em duas etapas</h1>
      {novo && <Alert kind="success">Representação criada. Como administrador, ative a verificação em duas etapas para gerenciar dados e equipe.</Alert>}
      {aal?.currentLevel === "aal2" ? (
        <>
          <Alert kind="success">Verificação em duas etapas ativa nesta sessão.</Alert>
          <Link href={next} className="underline">Continuar</Link>
        </>
      ) : verified ? (
        <>
          <p>Digite o código atual do seu aplicativo autenticador para liberar as ações de administrador.</p>
          <ChallengeTotp factorId={verified.id} next={next} />
        </>
      ) : (
        <>
          <p>
            Administradores precisam de um segundo fator. Até concluir, sua conta tem acesso somente de leitura.
          </p>
          <EnrollTotp next={next} />
        </>
      )}
      <p className="text-sm text-neutral-500">
        Perdeu o acesso ao autenticador? Fale com o suporte da plataforma; a remoção do fator exige verificação de identidade.
      </p>
      {aal?.currentLevel !== "aal2" && (
        <Link href={next} className="text-sm underline">Agora não (somente leitura)</Link>
      )}
    </main>
  );
}
