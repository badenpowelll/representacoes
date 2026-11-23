"use client";
import { useActionState } from "react";
import { updateContactInfo } from "@/app/app/[tenantId]/actions";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { initialState } from "@/lib/action-state";
import { ContactChannelsEditor, channelsFromJson, type ChannelRow } from "./contact-channels";

/** Edição de site e canais de contato. Os dados da Receita não são alterados. */
export function ContactInfoForm({
  tenantId,
  entity,
  id,
  website,
  channels,
}: {
  tenantId: string;
  entity: "industry" | "company";
  id: string;
  website: string | null;
  channels: ChannelRow[];
}) {
  const [state, action] = useActionState(updateContactInfo, initialState);
  const v = state.values;
  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      {state.message && (
        <div className="sm:col-span-2">
          <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>
        </div>
      )}
      <Field label="Site" name="website" defaultValue={v?.website ?? website ?? ""} placeholder="https://" error={state.fieldErrors?.website} />
      <ContactChannelsEditor defaultValue={channelsFromJson(v?.contact_channels) ?? channels} error={state.fieldErrors?.contact_channels} />
      <div>
        <SubmitButton>Salvar canais</SubmitButton>
      </div>
    </form>
  );
}
