import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Convite · Rep360" };

async function accept(form: FormData) {
  "use server";
  const token = String(form.get("token") ?? "");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error || !data) redirect(`/convite/${encodeURIComponent(token)}?erro=1`);
  redirect(`/app/${data}`);
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { token } = await params;
  const { erro } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/convite/${token}`)}`);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Convite para uma representação</h1>
      {erro ? (
        <p role="alert" className="text-red-700">
          Convite inválido ou expirado. Confira se você entrou com o mesmo e-mail que recebeu o convite.
        </p>
      ) : (
        <p>Você entrou como {user.email}. Aceite para acessar a representação.</p>
      )}
      <form action={accept}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Aceitar convite</SubmitButton>
      </form>
    </main>
  );
}
