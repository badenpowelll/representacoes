"use client";
import { useActionState, useState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { NEW_INDUSTRY } from "@/lib/catalogs/industry";
import { uploadCatalog } from "./actions";

export function CatalogUploadForm({ tenantId, industries }: { tenantId: string; industries: { id: string; name: string }[] }) {
  const [state, action] = useActionState(uploadCatalog, initialState);
  const v = state.values ?? {};
  // Sem indústrias cadastradas, o formulário já abre no modo "nova indústria".
  const fallback = industries.length ? "" : NEW_INDUSTRY;
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-2">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
      <IndustryPicker industries={industries} initial={v.industry_id ?? fallback} values={v} errors={state.fieldErrors ?? {}} />
      <Field label="Título" name="title" defaultValue={v.title} error={state.fieldErrors?.title} />
      <Field label="Categoria" name="category" defaultValue={v.category} error={state.fieldErrors?.category} />
      <Field label="Arquivo PDF" name="file" type="file" accept="application/pdf" hint="Até 50 MB. O arquivo fica privado." error={state.fieldErrors?.file} />
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Enviando...">Enviar catálogo</SubmitButton>
      </div>
    </form>
  );
}

function IndustryPicker({
  industries,
  initial,
  values,
  errors,
}: {
  industries: { id: string; name: string }[];
  initial: string;
  values: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [selected, setSelected] = useState(initial);
  const creating = selected === NEW_INDUSTRY;
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="cat-industry" className="text-sm font-medium">
          Indústria
        </label>
        <select
          id="cat-industry"
          name="industry_id"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-invalid={errors.industry_id ? true : undefined}
          className="rounded-md border px-3 py-2"
        >
          {industries.length > 0 && <option value="">Selecione</option>}
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
          <option value={NEW_INDUSTRY}>+ Cadastrar nova indústria</option>
        </select>
        {errors.industry_id && <p className="text-sm text-red-600">{errors.industry_id}</p>}
      </div>
      {creating && (
        <fieldset className="grid gap-4 rounded-md border border-dashed p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Nova indústria</legend>
          <p className="text-xs text-neutral-500 sm:col-span-2">
            A indústria é cadastrada junto com o catálogo. Depois você completa segmento, site e demais dados em Indústrias.
          </p>
          <Field label="Nome da indústria" name="new_industry_name" defaultValue={values.new_industry_name} required error={errors.new_industry_name} />
          <Field label="CNPJ (opcional)" name="new_industry_cnpj" defaultValue={values.new_industry_cnpj} inputMode="numeric" error={errors.new_industry_cnpj} />
        </fieldset>
      )}
    </>
  );
}
