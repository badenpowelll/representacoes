import { SignUpForm } from "../forms";

export const metadata = { title: "Criar conta · Rep360" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Criar conta</h1>
      <SignUpForm next={next} />
    </>
  );
}
