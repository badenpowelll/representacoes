"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { UfMunicipioFields } from "@/components/uf-municipio";
import { initialState } from "@/lib/action-state";
import { addTerritory } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function TerritoryForm({
  tenantId,
  industries,
  states,
  reps,
}: {
  tenantId: string;
  industries: { id: string; name: string }[];
  states: { code: string; name: string }[];
  reps: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(addTerritory, initialState);
  const v = state.values ?? {};
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-3" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-3">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
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
        {state.fieldErrors?.industry_id && <p className="text-sm text-red-600">{state.fieldErrors.industry_id}</p>}
      </div>
      <UfMunicipioFields states={states} defaultUf={v.state_code} defaultMunicipio={v.municipality_id}
        defaultScope={v.coverage} explicitScope scopeError={state.fieldErrors?.coverage}
        ufError={state.fieldErrors?.state_code} municipioError={state.fieldErrors?.municipality_id} />
      <div className="flex flex-col gap-1">
        <label htmlFor="membership_id" className="text-sm font-medium">
          Responsável
        </label>
        <select id="membership_id" name="membership_id" className={sel} defaultValue={v.membership_id ?? ""}>
          <option value="">Toda a equipe</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="exclusive" defaultChecked={v.exclusive === "on"} /> Exclusividade
      </label>
      <div className="self-end">
        <SubmitButton>Adicionar cobertura</SubmitButton>
      </div>
    </form>
  );
}
