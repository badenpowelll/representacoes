"use client";
import { useActionState, useState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { CONTACT_PURPOSES, CONTACT_PURPOSE_LABELS, LEGAL_BASES, LEGAL_BASIS_LABELS } from "@/lib/validation/schemas";
import { createContact, deleteContact, optOutContact } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

const NOTE_HINT: Record<string, string> = {
  legitimate_interest: "Por que este contato tem interesse legítimo na oferta (mín. 20 caracteres). Ser empresa (B2B) não basta.",
  contract: "Número ou referência do contrato.",
  legal_obligation: "Qual obrigação legal se aplica.",
  consent: "Opcional.",
};

export function ContactForm({ tenantId, companyId }: { tenantId: string; companyId: string }) {
  const [state, action] = useActionState(createContact, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [basis, setBasis] = useState(v.legal_basis ?? "");
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="company_id" value={companyId} />
      <div className="sm:col-span-2">{state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}</div>
      <Field label="Nome do contato" name="name" defaultValue={v.name} required error={e.name} />
      <Field label="Cargo" name="role_title" defaultValue={v.role_title} error={e.role_title} />
      <Field label="E-mail" name="email" type="email" defaultValue={v.email} error={e.email} />
      <Field label="Telefone" name="phone" inputMode="tel" defaultValue={v.phone} error={e.phone} />
      <Field label="Origem do contato" name="source" defaultValue={v.source} required error={e.source}
        hint="Ex.: cartão de visita na feira X, site da empresa" />
      <div className="flex flex-col gap-1">
        <label htmlFor="legal_basis" className="text-sm font-medium">
          Base legal (LGPD)
        </label>
        <select id="legal_basis" name="legal_basis" className={sel} value={basis} onChange={(ev) => setBasis(ev.target.value)}
          aria-invalid={e.legal_basis ? true : undefined}>
          <option value="">Selecione</option>
          {LEGAL_BASES.map((b) => (
            <option key={b} value={b}>
              {LEGAL_BASIS_LABELS[b]}
            </option>
          ))}
        </select>
        {e.legal_basis && <p className="text-sm text-red-600">{e.legal_basis}</p>}
      </div>
      <fieldset className="flex flex-col gap-1 sm:col-span-2">
        <legend className="text-sm font-medium">Finalidades autorizadas</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-1 py-1 text-sm">
          {CONTACT_PURPOSES.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="checkbox" name={`purpose_${p}`} defaultChecked={v[`purpose_${p}`] === "on"} /> {CONTACT_PURPOSE_LABELS[p]}
            </label>
          ))}
        </div>
        {e.purposes && <p className="text-sm text-red-600">{e.purposes}</p>}
      </fieldset>
      {basis && (
        <div className="sm:col-span-2">
          <Field label="Justificativa da base legal" name="legal_basis_note" defaultValue={v.legal_basis_note}
            error={e.legal_basis_note} hint={NOTE_HINT[basis]} />
        </div>
      )}
      {basis === "consent" && (
        <>
          <div className="sm:col-span-2">
            <Field label="Evidência do consentimento" name="consent_evidence" defaultValue={v.consent_evidence}
              error={e.consent_evidence} hint="Como e onde foi obtido (ex.: formulário assinado na feira X, e-mail de 10/11)." />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="consent" defaultChecked={v.consent === "on"} /> O contato deu consentimento (registra data e hora)
            </label>
            {e.consent && <p className="text-sm text-red-600">{e.consent}</p>}
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <SubmitButton>Adicionar contato</SubmitButton>
      </div>
    </form>
  );
}

export function ContactRightsButtons({
  tenantId,
  companyId,
  contactId,
  contactName,
  optedOut,
}: {
  tenantId: string;
  companyId: string;
  contactId: string;
  contactName: string;
  optedOut: boolean;
}) {
  const [optState, optAction] = useActionState(optOutContact, initialState);
  const [delState, delAction] = useActionState(deleteContact, initialState);
  const result = [optState, delState].filter((s) => s.message).sort((a, b) => (b.nonce ?? 0) - (a.nonce ?? 0))[0];
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="contact_id" value={contactId} />
    </>
  );
  return (
    <div className="mt-2 flex flex-col gap-2">
      {result && <Alert kind={result.ok ? "success" : "error"}>{result.message}</Alert>}
      <div className="flex gap-4">
        {!optedOut && (
          <form action={optAction}>
            {hidden}
            <button className="underline">Registrar oposição (não contatar)</button>
          </form>
        )}
        <form action={delAction}>
          {hidden}
          <button className="text-red-700 underline" aria-label={`Excluir dados de ${contactName}`}>
            Excluir dados
          </button>
        </form>
      </div>
    </div>
  );
}
