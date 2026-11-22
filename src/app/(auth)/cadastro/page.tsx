import { SignUpForm } from "../forms";

export const metadata = { title: "Criar conta · Rep360" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Criar conta</h1>
      <SignUpForm />
    </>
  );
}
