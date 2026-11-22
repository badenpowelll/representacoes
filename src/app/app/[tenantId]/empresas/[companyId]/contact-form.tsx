"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { LEGAL_BASES, LEGAL_BASIS_LABELS } from "@/lib/validation/schemas";
import { createContact } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function ContactForm({ tenantId, companyId }: { tenantId: string; companyId: string }) {
  const [state, action] = useActionState(createContact, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="company_id" value={companyId} />
      <div className="sm:col-span-2">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
      <Field label="Nome do contato" name="name" defaultValue={v.name} required error={e.name} />
      <Field label="Cargo" name="role_title" defaultValue={v.role_title} error={e.role_title} />
      <Field label="E-mail" name="email" type="email" defaultValue={v.email} error={e.email} />
      <Field label="Telefone" name="phone" inputMode="tel" defaultValue={v.phone} error={e.phone} />
      <div className="flex flex-col gap-1">
        <label htmlFor="legal_basis" className="text-sm font-medium">
          Base legal (LGPD)
        </label>
        <select id="legal_basis" name="legal_basis" className={sel} defaultValue={v.legal_basis ?? "legitimate_interest"}>
          {LEGAL_BASES.map((b) => (
            <option key={b} value={b}>
              {LEGAL_BASIS_LABELS[b]}
            </option>
          ))}
        </select>
        {e.legal_basis && <p className="text-sm text-red-600">{e.legal_basis}</p>}
      </div>
      <Field label="Origem do contato" name="source" defaultValue={v.source} required error={e.source}
        hint="Ex.: cartão de visita na feira X, site da empresa" />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="consent" defaultChecked={v.consent === "on"} /> O contato deu consentimento (registra data e hora)
        </label>
        {e.consent && <p className="text-sm text-red-600">{e.consent}</p>}
      </div>
      <div className="sm:col-span-2">
        <SubmitButton>Adicionar contato</SubmitButton>
      </div>
    </form>
  );
}
