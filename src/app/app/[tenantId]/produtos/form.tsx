"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { createProduct } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function ProductForm({
  tenantId,
  industries,
  versions,
}: {
  tenantId: string;
  industries: { id: string; name: string }[];
  versions: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(createProduct, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
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
        {e.industry_id && <p className="text-sm text-red-600">{e.industry_id}</p>}
      </div>
      <Field label="SKU" name="sku" defaultValue={v.sku} required error={e.sku} />
      <Field label="Nome do produto" name="name" defaultValue={v.name} required error={e.name} />
      <Field label="Categoria" name="category" defaultValue={v.category} error={e.category} />
      <Field label="Preço autorizado (R$)" name="authorized_price" inputMode="decimal" defaultValue={v.authorized_price}
        hint="Só preencha com preço autorizado pela indústria" error={e.authorized_price} />
      <Field label="Preço válido até" name="price_valid_until" type="date" defaultValue={v.price_valid_until} error={e.price_valid_until} />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="catalog_version_id" className="text-sm font-medium">
          Catálogo de origem
        </label>
        <select id="catalog_version_id" name="catalog_version_id" className={sel} defaultValue={v.catalog_version_id ?? ""}>
          <option value="">Nenhum</option>
          {versions.map((cv) => (
            <option key={cv.id} value={cv.id}>
              {cv.label}
            </option>
          ))}
        </select>
        {e.catalog_version_id && <p className="text-sm text-red-600">{e.catalog_version_id}</p>}
      </div>
      <div className="self-end">
        <SubmitButton>Cadastrar produto</SubmitButton>
      </div>
    </form>
  );
}
