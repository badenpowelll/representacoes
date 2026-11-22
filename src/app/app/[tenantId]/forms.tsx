"use client";
import { useActionState, useState } from "react";
import { initialState } from "@/lib/action-state";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { UfMunicipioFields } from "@/components/uf-municipio";
import { DEAL_STAGES, DEAL_STAGE_LABELS, UF_CODES, type DealStage } from "@/lib/validation/schemas";
import { createCompany, createDeal, createIndustry, moveDeal } from "./actions";

const selectClass = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

function Feedback({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message) return null;
  return <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>;
}

export function IndustryForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState(createIndustry, initialState);
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <Field label="Nome" name="name"
        defaultValue={state.values?.name} required error={state.fieldErrors?.name} />
      <Field label="CNPJ" name="cnpj"
        defaultValue={state.values?.cnpj} inputMode="numeric" error={state.fieldErrors?.cnpj} />
      <Field label="Segmento" name="segment"
        defaultValue={state.values?.segment} error={state.fieldErrors?.segment} />
      <Field label="Site" name="website"
        defaultValue={state.values?.website} type="url" placeholder="https://" error={state.fieldErrors?.website} />
      <div>
        <SubmitButton>Cadastrar indústria</SubmitButton>
      </div>
    </form>
  );
}

export function CompanyForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState(createCompany, initialState);
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <Field label="Razão social" name="legal_name"
        defaultValue={state.values?.legal_name} required error={state.fieldErrors?.legal_name} />
      <Field label="CNPJ" name="cnpj"
        defaultValue={state.values?.cnpj} inputMode="numeric" error={state.fieldErrors?.cnpj} />
      <Field label="CNAE principal" name="cnae"
        defaultValue={state.values?.cnae} inputMode="numeric" hint="7 dígitos, sem pontuação" error={state.fieldErrors?.cnae} />
      <Field label="Segmento" name="segment"
        defaultValue={state.values?.segment} error={state.fieldErrors?.segment} />
      <UfMunicipioFields states={UF_CODES.map((code) => ({ code }))} defaultUf={state.values?.state_code}
        defaultMunicipio={state.values?.municipality_id} municipioEmptyLabel="Não informado"
        municipioError={state.fieldErrors?.municipality_id} />
      <div className="flex flex-col gap-1">
        <label htmlFor="kind" className="text-sm font-medium">
          Tipo
        </label>
        <select id="kind" name="kind" className={selectClass} defaultValue={state.values?.kind ?? "prospect"}>
          <option value="prospect">Prospect</option>
          <option value="customer">Cliente</option>
        </select>
      </div>
      <Field
        label="Origem do dado"
        name="source"
        defaultValue={state.values?.source}
        required
        hint="Obrigatório (LGPD). Ex.: indicação, feira, cadastro do cliente."
        error={state.fieldErrors?.source}
      />
      <div className="self-end">
        <SubmitButton>Cadastrar empresa</SubmitButton>
      </div>
    </form>
  );
}

export function DealForm({ tenantId, companies }: { tenantId: string; companies: { id: string; legal_name: string }[] }) {
  const [state, action] = useActionState(createDeal, initialState);
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-4" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-4">
        <Feedback state={state} />
      </div>
      <Field label="Título" name="title"
        defaultValue={state.values?.title} required error={state.fieldErrors?.title} />
      <div className="flex flex-col gap-1">
        <label htmlFor="company_id" className="text-sm font-medium">
          Empresa
        </label>
        <select id="company_id" name="company_id" className={selectClass} required defaultValue={state.values?.company_id ?? ""}>
          <option value="" disabled>
            Selecione
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legal_name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.company_id && <p className="text-sm text-red-600">{state.fieldErrors.company_id}</p>}
      </div>
      <Field label="Valor (R$)" name="amount"
        defaultValue={state.values?.amount} inputMode="decimal" error={state.fieldErrors?.amount} />
      <div className="self-end">
        <SubmitButton>Criar negócio</SubmitButton>
      </div>
    </form>
  );
}

export function MoveDealForm({ tenantId, dealId, stage }: { tenantId: string; dealId: string; stage: DealStage }) {
  const [state, action] = useActionState(moveDeal, initialState);
  const [target, setTarget] = useState<DealStage>(stage);
  return (
    <form key={state.nonce} action={action} className="mt-2 flex flex-col gap-2 text-sm">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="deal_id" value={dealId} />
      <label className="sr-only" htmlFor={`stage-${dealId}`}>
        Mover para etapa
      </label>
      <div className="flex gap-2">
        <select
          id={`stage-${dealId}`}
          name="stage"
          value={target}
          onChange={(e) => setTarget(e.target.value as DealStage)}
          className={`${selectClass} flex-1 py-1`}
        >
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {DEAL_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="rounded-md border px-2" disabled={target === stage}>
          Mover
        </button>
      </div>
      {target === "lost" && (
        <input
          name="lost_reason"
          aria-label="Motivo da perda"
          placeholder="Motivo da perda"
          className={`${selectClass} py-1`}
          required
        />
      )}
      {state.fieldErrors?.lost_reason && <p className="text-red-600">{state.fieldErrors.lost_reason}</p>}
      {state.message && !state.ok && <p className="text-red-600">{state.message}</p>}
    </form>
  );
}
