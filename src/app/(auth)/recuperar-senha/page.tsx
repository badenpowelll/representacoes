import { ResetRequestForm } from "../forms";

export const metadata = { title: "Recuperar senha · Rep360" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      <ResetRequestForm />
    </>
  );
}
