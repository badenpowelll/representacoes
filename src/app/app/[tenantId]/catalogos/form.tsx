"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { uploadCatalog } from "./actions";

export function CatalogUploadForm({ tenantId, industries }: { tenantId: string; industries: { id: string; name: string }[] }) {
  const [state, action] = useActionState(uploadCatalog, initialState);
  const v = state.values ?? {};
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-2">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cat-industry" className="text-sm font-medium">
          Indústria
        </label>
        <select id="cat-industry" name="industry_id" defaultValue={v.industry_id ?? ""} className="rounded-md border px-3 py-2">
          <option value="">Selecione</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.industry_id && <p className="text-sm text-red-600">{state.fieldErrors.industry_id}</p>}
      </div>
      <Field label="Título" name="title" defaultValue={v.title} error={state.fieldErrors?.title} />
      <Field label="Categoria" name="category" defaultValue={v.category} error={state.fieldErrors?.category} />
      <Field label="Arquivo PDF" name="file" type="file" accept="application/pdf" hint="Até 50 MB. O arquivo fica privado." error={state.fieldErrors?.file} />
      <div>
        <SubmitButton pendingText="Enviando...">Enviar catálogo</SubmitButton>
      </div>
    </form>
  );
}
