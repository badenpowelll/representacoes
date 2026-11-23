"use client";
import { useActionState, useState } from "react";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { UF_CODES } from "@/lib/validation/schemas";
import { PROSPECT_PRESETS, formatCnae } from "@/lib/prospeccao/presets";
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, type Channel } from "@/lib/prospeccao/messages";
import { saveTargetCnaes, saveTemplate, startIndustry } from "./actions";

const box = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function StartIndustryForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState(startIndustry, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [preset, setPreset] = useState(v.preset ?? PROSPECT_PRESETS[0].key);
  const chosen = PROSPECT_PRESETS.find((p) => p.key === preset);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da indústria representada" name="name" defaultValue={v.name ?? chosen?.label} required error={e.name}
          hint="Ex.: o nome do fabricante de material hospitalar que você representa" />
        <div className="flex flex-col gap-1">
          <label htmlFor="preset" className="text-sm font-medium">Perfil de clientes</label>
          <select id="preset" name="preset" className={box} value={preset} onChange={(ev) => setPreset(ev.target.value)}>
            {PROSPECT_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
            <option value="">Vou escolher os CNAEs depois</option>
          </select>
          {chosen && (
            <p className="text-xs text-neutral-500">
              {chosen.cnaes.length} CNAEs: hospitais, clínicas, laboratórios, odontologia, diagnóstico por imagem e outros. Você pode ajustar depois.
            </p>
          )}
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Estados que você atende</legend>
        <div className="flex flex-wrap gap-2">
          {UF_CODES.map((uf) => (
            <label key={uf} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
              <input type="checkbox" name="ufs" value={uf} defaultChecked={uf === "RN"} />
              {uf}
            </label>
          ))}
        </div>
        {e.ufs && <p className="text-sm text-red-600">{e.ufs}</p>}
        <p className="text-xs text-neutral-500">Para limitar a municípios específicos, ajuste depois em Territórios.</p>
      </fieldset>
      <div>
        <SubmitButton pendingText="Criando...">Criar e ver empresas</SubmitButton>
      </div>
    </form>
  );
}

export function CnaeForm({
  tenantId,
  industryId,
  current,
}: {
  tenantId: string;
  industryId: string;
  current: string[];
}) {
  const [state, action] = useActionState(saveTargetCnaes, initialState);
  const [text, setText] = useState(state.values?.cnaes ?? current.map(formatCnae).join(", "));
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="industry_id" value={industryId} />
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <label htmlFor="cnaes" className="text-sm font-medium">CNAEs-alvo (separados por vírgula)</label>
      <textarea id="cnaes" name="cnaes" rows={3} className={box} value={text} onChange={(ev) => setText(ev.target.value)}
        aria-invalid={state.fieldErrors?.cnaes ? true : undefined} />
      {state.fieldErrors?.cnaes && <p className="text-sm text-red-600">{state.fieldErrors.cnaes}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Salvando...">Salvar perfil</SubmitButton>
        {PROSPECT_PRESETS.map((p) => (
          <button key={p.key} type="button" className="text-sm underline" onClick={() => setText(p.cnaes.map(formatCnae).join(", "))}>
            Usar perfil “{p.label}”
          </button>
        ))}
      </div>
    </form>
  );
}

export function TemplateForm({
  tenantId,
  industryId,
  channel,
  subject,
  body,
  saved,
}: {
  tenantId: string;
  industryId: string;
  channel: Channel;
  subject: string | null;
  body: string;
  saved: boolean;
}) {
  const [state, action] = useActionState(saveTemplate, initialState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [text, setText] = useState(v.body ?? body);
  const label = channel === "email" ? "E-mail" : "WhatsApp";
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="industry_id" value={industryId} />
      <input type="hidden" name="channel" value={channel} />
      <h3 className="font-medium">
        {label} {!saved && <span className="text-xs font-normal text-neutral-500">(modelo padrão, ainda não salvo)</span>}
      </h3>
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      {channel === "email" && <Field label="Assunto" name="subject" defaultValue={v.subject ?? subject ?? ""} error={e.subject} />}
      <div className="flex flex-col gap-1">
        <label htmlFor={`body-${channel}`} className="text-sm font-medium">Mensagem</label>
        <textarea id={`body-${channel}`} name="body" rows={channel === "email" ? 10 : 4} className={box} value={text}
          onChange={(ev) => setText(ev.target.value)} aria-invalid={e.body ? true : undefined} />
        {e.body && <p className="text-sm text-red-600">{e.body}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Salvando...">Salvar modelo</SubmitButton>
        <button type="button" className="text-sm underline" onClick={() => setText(DEFAULT_TEMPLATES[channel].body)}>
          Restaurar padrão
        </button>
      </div>
    </form>
  );
}

export function VariablesHelp() {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">Variáveis que você pode usar no texto</summary>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {TEMPLATE_VARIABLES.map((v) => (
          <li key={v.key}>
            <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{`{{${v.key}}}`}</code> {v.label}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-neutral-500">
        A frase de oposição (“responda SAIR”) é acrescentada automaticamente se não estiver no texto. Não coloque preços ou
        condições que não estejam aprovados pela indústria.
      </p>
    </details>
  );
}
