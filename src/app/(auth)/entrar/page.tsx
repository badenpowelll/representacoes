import { SignInForm } from "../forms";

export const metadata = { title: "Entrar · Rep360" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const { next, erro } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Entrar</h1>
      {erro && (
        <p role="alert" className="text-sm text-red-600">
          O link expirou ou é inválido. Entre novamente.
        </p>
      )}
      <SignInForm next={next} />
    </>
  );
}
