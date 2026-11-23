import { requireUser } from "@/lib/auth/session";
import { CreateTenantForm } from "./form";

export const metadata = { title: "Nova representação · Rep360" };

export default async function Page() {
  await requireUser();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Nova representação</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Você será o administrador. Depois poderá convidar gerentes, representantes e assistentes.
      </p>
      <CreateTenantForm />
    </main>
  );
}
