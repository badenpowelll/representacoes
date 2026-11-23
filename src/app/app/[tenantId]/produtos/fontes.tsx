"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { createProductSource } from "./fontes-actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function ProductSourceForm({ tenantId, industries }: { tenantId: string; industries: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createProductSource, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-3" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-3">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
      <div className="flex flex-col gap-1">
        <label htmlFor="fonte_industry_id" className="text-sm font-medium">
          Indústria do site
        </label>
        <select id="fonte_industry_id" name="industry_id" className={sel} defaultValue={v.industry_id ?? ""}>
          <option value="">Selecione</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {e.industry_id && <p className="text-sm text-red-600">{e.industry_id}</p>}
      </div>
      <div className="sm:col-span-2">
        <Field label="Página de produtos no site da indústria" name="url" type="url" inputMode="url" defaultValue={v.url} required
          placeholder="https://www.industria.com.br/produtos" error={e.url}
          hint="A página com a lista de produtos (pode ser uma categoria). O robô respeita o robots.txt do site." />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="fonte_mode" className="text-sm font-medium">
          Tipo de página
        </label>
        <select id="fonte_mode" name="mode" className={sel} defaultValue={v.mode ?? "list"} aria-describedby="fonte_mode-dica">
          <option value="list">Lista de produtos (cadastra e atualiza)</option>
          <option value="watch">Vigiar página (só avisa quando mudar)</option>
        </select>
        <p id="fonte_mode-dica" className="text-xs text-neutral-500">Use &quot;vigiar&quot; em sites sem uma página por produto.</p>
        {e.mode && <p className="text-sm text-red-600">{e.mode}</p>}
      </div>
      <Field label="Nome da linha (opcional)" name="label" defaultValue={v.label} error={e.label} placeholder="Ex.: Linha profissional" />
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-sm text-neutral-600">Avançado</summary>
        <div className="mt-2">
          <Field label="Padrão do link de produto (expressão regular)" name="link_pattern" defaultValue={v.link_pattern} error={e.link_pattern}
            hint="Só se a detecção automática errar. Ex.: /produto/" />
        </div>
      </details>
      <div className="self-end">
        <SubmitButton>Cadastrar site</SubmitButton>
      </div>
    </form>
  );
}
