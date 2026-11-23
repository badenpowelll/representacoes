"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { UfMunicipioFields } from "@/components/uf-municipio";
import { initialState } from "@/lib/action-state";
import { UF_CODES } from "@/lib/validation/schemas";
import { registerProspect } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function ProspectForm({ tenantId, industries, today }: { tenantId: string; industries: { id: string; name: string }[]; today: string }) {
  const [state, action] = useActionState(registerProspect, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-2">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
      <div className="flex flex-col gap-1">
        <label htmlFor="industry_id" className="text-sm font-medium">
          Indústria
        </label>
        <select id="industry_id" name="industry_id" className={sel} defaultValue={v.industry_id ?? ""}>
          <option value="">Selecione</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {e.industry_id && <p className="text-sm text-red-600">{e.industry_id}</p>}
      </div>
      <Field label="Razão social" name="legal_name" defaultValue={v.legal_name} required error={e.legal_name} />
      <Field label="CNPJ" name="cnpj" inputMode="numeric" defaultValue={v.cnpj} error={e.cnpj}
        hint="Se já existir uma empresa com este CNPJ, ela é reaproveitada" />
      <Field label="CNAE principal" name="cnae" inputMode="numeric" defaultValue={v.cnae} error={e.cnae} />
      <Field label="Segmento" name="segment" defaultValue={v.segment} error={e.segment} />
      <UfMunicipioFields states={UF_CODES.map((code) => ({ code }))} defaultUf={v.state_code} defaultMunicipio={v.municipality_id}
        municipioEmptyLabel="Não informado" municipioError={e.municipality_id} />
      <Field label="Fonte do dado" name="source" defaultValue={v.source} required error={e.source}
        hint="Onde a empresa foi encontrada: site, Receita Federal (dados abertos), feira, indicação..." />
      <Field label="Data da fonte" name="source_date" type="date" max={today} defaultValue={v.source_date ?? today}
        required error={e.source_date} />
      <div className="sm:col-span-2">
        <SubmitButton>Registrar prospect</SubmitButton>
      </div>
    </form>
  );
}
