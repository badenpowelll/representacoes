"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { saveContext } from "./actions";

type Ctx = Record<"segments" | "cnaes" | "ideal_customer" | "differentiators" | "restrictions" | "communication_tone" | "goals", string>;

const FIELDS: { name: keyof Ctx; label: string; hint?: string; rows?: number }[] = [
  { name: "segments", label: "Segmentos-alvo", hint: "Separe por vírgula. Ex.: construção, varejo de materiais", rows: 2 },
  { name: "cnaes", label: "CNAEs-alvo", hint: "Códigos de 7 dígitos separados por vírgula. Ex.: 4744001, 4742300", rows: 2 },
  { name: "ideal_customer", label: "Perfil de cliente ideal (ICP)" },
  { name: "differentiators", label: "Diferenciais" },
  { name: "restrictions", label: "Restrições", hint: "O que nunca oferecer, regiões ou clientes a evitar." },
  { name: "communication_tone", label: "Tom de comunicação", rows: 2 },
  { name: "goals", label: "Metas" },
];

export function ContextForm({ tenantId, current, readOnly }: { tenantId: string; current: Ctx; readOnly: boolean }) {
  const [state, action] = useActionState(saveContext, initialState);
  const values = state.values ?? current;
  return (
    <form key={state.nonce} action={action} className="flex max-w-3xl flex-col gap-4" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      {FIELDS.map((f) => (
        <div key={f.name} className="flex flex-col gap-1">
          <label htmlFor={f.name} className="text-sm font-medium">
            {f.label}
          </label>
          <textarea
            id={f.name}
            name={f.name}
            rows={f.rows ?? 3}
            readOnly={readOnly}
            defaultValue={values[f.name] ?? ""}
            aria-invalid={state.fieldErrors?.[f.name] ? true : undefined}
            aria-describedby={f.hint ? `${f.name}-dica` : undefined}
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          />
          {f.hint && (
            <p id={`${f.name}-dica`} className="text-xs text-neutral-500">
              {f.hint}
            </p>
          )}
          {state.fieldErrors?.[f.name] && <p className="text-sm text-red-600">{state.fieldErrors[f.name]}</p>}
        </div>
      ))}
      {!readOnly && (
        <div>
          <SubmitButton>Salvar contexto</SubmitButton>
        </div>
      )}
    </form>
  );
}
