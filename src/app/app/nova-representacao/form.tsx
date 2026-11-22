"use client";
import { useActionState } from "react";
import { initialState } from "@/lib/action-state";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createTenant } from "../actions";

export function CreateTenantForm() {
  const [state, action] = useActionState(createTenant, initialState);
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-4" noValidate>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <Field label="Nome da representação" name="name"
        defaultValue={state.values?.name} required error={state.fieldErrors?.name} />
      <Field
        label="Identificador"
        name="slug"
        defaultValue={state.values?.slug}
        required
        hint="Letras minúsculas, números e hífens. Ex.: quindin-representacoes"
        error={state.fieldErrors?.slug}
      />
      <SubmitButton pendingText="Criando...">Criar representação</SubmitButton>
    </form>
  );
}
