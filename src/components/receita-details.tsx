import { Alert } from "@/components/ui";
import { formatAddress, formatPhone, isInactiveStatus, type CnpjRegistryData } from "@/lib/cnpj/registry";

/** Todos os dados da Receita Federal salvos para um CNPJ (empresa ou indústria). */
export function ReceitaDetails({ data: receita }: { data: CnpjRegistryData & { fetchedAt: string } }) {
  return (
    <div className="flex flex-col gap-3">
      {isInactiveStatus(receita.registrationStatus) && (
        <Alert kind="error">
          Situação cadastral: {receita.registrationStatus}
          {receita.statusDate ? ` desde ${receita.statusDate}` : ""}
          {receita.statusReason ? ` (${receita.statusReason})` : ""}.
        </Alert>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-neutral-500">Razão social</dt><dd>{receita.legalName}</dd></div>
        <div><dt className="text-neutral-500">Nome fantasia</dt><dd>{receita.tradeName ?? "—"}</dd></div>
        <div><dt className="text-neutral-500">Situação cadastral</dt><dd>{receita.registrationStatus ?? "—"}{receita.statusDate ? ` (${receita.statusDate})` : ""}</dd></div>
        <div><dt className="text-neutral-500">Abertura</dt><dd>{receita.openedOn ?? "—"}</dd></div>
        <div><dt className="text-neutral-500">Natureza jurídica</dt><dd>{receita.legalNature ?? "—"}</dd></div>
        <div><dt className="text-neutral-500">Porte</dt><dd>{receita.companySize ?? "—"}</dd></div>
        <div><dt className="text-neutral-500">Capital social</dt><dd>{receita.shareCapital == null ? "—" : receita.shareCapital.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</dd></div>
        <div><dt className="text-neutral-500">Matriz ou filial</dt><dd>{receita.isHeadquarters == null ? "—" : receita.isHeadquarters ? "Matriz" : "Filial"}</dd></div>
        <div><dt className="text-neutral-500">Simples / MEI</dt><dd>{[receita.simplesOptIn == null ? null : `Simples: ${receita.simplesOptIn ? "sim" : "não"}`, receita.meiOptIn == null ? null : `MEI: ${receita.meiOptIn ? "sim" : "não"}`].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div className="sm:col-span-3"><dt className="text-neutral-500">Endereço</dt><dd>{formatAddress(receita.address) || "—"}</dd></div>
        <div><dt className="text-neutral-500">Telefones</dt><dd>{receita.phones.map(formatPhone).join(", ") || "—"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-neutral-500">E-mail</dt><dd>{receita.email ?? "—"}</dd></div>
        <div className="sm:col-span-3"><dt className="text-neutral-500">CNAE principal</dt><dd>{receita.mainCnae ? `${receita.mainCnae} · ${receita.mainCnaeDescription ?? ""}` : "—"}</dd></div>
      </dl>
      {receita.secondaryCnaes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">CNAEs secundários ({receita.secondaryCnaes.length})</summary>
          <ul className="mt-2 list-disc pl-5">
            {receita.secondaryCnaes.map((c) => (
              <li key={c.code}>{c.code} · {c.description}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="text-sm">
        <h3 className="font-medium">Quadro societário ({receita.partners.length})</h3>
        {receita.partners.length === 0 ? (
          <p className="text-neutral-500">Nenhum sócio informado pela Receita.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {receita.partners.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                <span className="font-medium">{p.name}</span>
                {[p.role, p.since ? `desde ${p.since}` : null, p.ageRange, p.document].filter(Boolean).map((x) => ` · ${x}`).join("")}
                {p.legalRepresentative ? ` · representante legal: ${p.legalRepresentative}` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-neutral-500">
          Dados públicos da Receita Federal, usados só para qualificar a empresa. Sócios não viram contatos de prospecção automaticamente.
        </p>
      </div>
      <p className="text-xs text-neutral-500">
        Fonte: Receita Federal (dados abertos) via BrasilAPI · consultado em {new Date(receita.fetchedAt).toLocaleString("pt-BR")}
      </p>
    </div>
  );
}
