import Link from "next/link";
import { requireTenantPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { Alert } from "@/components/ui";
import { Importer } from "../../importar/importer";
import { ImportHistory } from "../../importar/history";

export const metadata = { title: "Importar clientes · Rep360" };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireTenantPage(tenantId);
  const base = `/app/${tenantId}/empresas`;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href={base} className="text-sm underline">← Clientes e prospects</Link>
        <h1 className="text-2xl font-semibold">Importar planilha de clientes</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Envie a planilha que a indústria mandou (ou o modelo padrão). Você escolhe o que é cada coluna, confere a prévia e o
          Rep360 completa os dados pelo CNPJ, sem duplicar empresas já cadastradas.
        </p>
      </div>
      {can(ctx.role, "crm.write") ? (
        <Importer tenantId={tenantId} kind="companies" backHref={base} />
      ) : (
        <Alert kind="info">Seu papel permite só consultar. Peça a um administrador, gerente, representante ou assistente para importar.</Alert>
      )}
      <ImportHistory tenantId={tenantId} kind="companies" />
    </div>
  );
}
