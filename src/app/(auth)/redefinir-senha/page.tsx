import { NewPasswordForm } from "../forms";

export const metadata = { title: "Nova senha · Rep360" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Definir nova senha</h1>
      <NewPasswordForm />
    </>
  );
}
