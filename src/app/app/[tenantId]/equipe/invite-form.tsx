"use client";
import { useActionState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ROLE_LABELS, type TenantRole } from "@/lib/auth/permissions";
import { inviteMember, type InviteState } from "./actions";

export function InviteForm({ tenantId, roles }: { tenantId: string; roles: TenantRole[] }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMember, {});
  return (
    <div className="flex flex-col gap-4">
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      {state.link && (
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-link" className="text-sm font-medium">
            Link do convite (válido por 7 dias)
          </label>
          <input id="invite-link" readOnly value={state.link} className="rounded-md border px-3 py-2 font-mono text-xs" onFocus={(e) => e.target.select()} />
        </div>
      )}
      <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-3" noValidate>
        <input type="hidden" name="tenant_id" value={tenantId} />
        <Field label="E-mail do convidado" name="email" type="email" defaultValue={state.values?.email} required error={state.fieldErrors?.email} />
        <div className="flex flex-col gap-1">
          <label htmlFor="role" className="text-sm font-medium">
            Papel
          </label>
          <select id="role" name="role" defaultValue={state.values?.role ?? "representative"} className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700">
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {state.fieldErrors?.role && <p className="text-sm text-red-600">{state.fieldErrors.role}</p>}
        </div>
        <div className="self-end">
          <SubmitButton>Gerar convite</SubmitButton>
        </div>
      </form>
    </div>
  );
}
