"use client";
import { useRef, useState, useTransition } from "react";
import { lookupCnpj } from "@/app/app/[tenantId]/cnpj-actions";
import { formatAddress, formatPhone, isInactiveStatus, type CnpjRegistryData } from "@/lib/cnpj/registry";
import { isValidCnpj, normalizeCnpj } from "@/lib/validation/cnpj";

export type CnpjData = CnpjRegistryData & { fetchedAt: string };
/** Campo do formulário (atributo name) -> valor vindo da Receita. */
export type CnpjFillMap = Record<string, (d: CnpjData) => string | null | undefined>;

const inputClass =
  "min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:outline-2 focus:outline-blue-600 dark:border-neutral-700";

/**
 * Campo CNPJ que, ao receber um CNPJ válido, consulta a Receita Federal
 * (BrasilAPI, no servidor) e preenche os demais campos do formulário.
 * Só sobrescreve campos vazios ou que ele mesmo preencheu antes: o que o
 * usuário digitou é preservado.
 */
export function CnpjField({
  tenantId,
  defaultValue,
  error,
  hint,
  fill,
  onData,
}: {
  tenantId: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  fill: CnpjFillMap;
  onData?: (d: CnpjData, form: HTMLFormElement) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const lastQueried = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ data?: CnpjData; message?: string } | null>(null);

  function apply(d: CnpjData) {
    const form = ref.current?.form;
    if (!form) return;
    for (const [name, pick] of Object.entries(fill)) {
      const value = pick(d);
      const el = form.elements.namedItem(name);
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || value == null || value === "") continue;
      if (el.value === "" || el.dataset.autofilled === el.value) {
        el.value = value;
        el.dataset.autofilled = value;
      }
    }
    onData?.(d, form);
  }

  function query(refresh = false) {
    const cnpj = normalizeCnpj(ref.current?.value ?? "");
    if (!isValidCnpj(cnpj)) {
      if (cnpj.length >= 14) setResult({ message: "Os dígitos verificadores não conferem; confira o número." });
      return;
    }
    if (!refresh && lastQueried.current === cnpj) return;
    lastQueried.current = cnpj;
    startTransition(async () => {
      try {
        const r = await lookupCnpj(tenantId, cnpj, { refresh });
        if (normalizeCnpj(ref.current?.value ?? "") !== cnpj) return; // usuário mudou o CNPJ no meio
        if (r.ok) {
          apply(r.data);
          setResult({ data: r.data });
        } else {
          setResult({ message: r.message });
        }
      } catch {
        setResult({ message: "Não foi possível consultar o CNPJ agora. Preencha manualmente." });
      }
    });
  }

  const d = result?.data;
  const describedBy = ["cnpj-status", error ? "cnpj-erro" : null, hint ? "cnpj-dica" : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <label htmlFor="cnpj" className="text-sm font-medium">
        CNPJ
      </label>
      <div className="flex gap-2">
        <input
          ref={ref}
          id="cnpj"
          name="cnpj"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
          onBlur={() => query()}
          onChange={(e) => {
            if (normalizeCnpj(e.target.value).length === 14) query();
          }}
        />
        <button type="button" className="shrink-0 rounded-md border px-3 text-sm disabled:opacity-60" disabled={pending}
          onClick={() => query(true)}>
          {pending ? "Consultando..." : "Buscar na Receita"}
        </button>
      </div>
      {hint && (
        <p id="cnpj-dica" className="text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id="cnpj-erro" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div id="cnpj-status" aria-live="polite" className="text-sm">
        {pending && <p className="text-neutral-500">Consultando a Receita Federal...</p>}
        {!pending && result?.message && <p className="text-amber-700 dark:text-amber-300">{result.message}</p>}
        {!pending && d && <CnpjSummary data={d} />}
      </div>
    </div>
  );
}

/**
 * Preenchimento de UF/município a partir da consulta. Só aplica se a UF
 * estiver vazia ou tiver sido preenchida pela consulta anterior.
 */
export function useLocationPrefill() {
  const [prefill, setPrefill] = useState<{ uf: string; municipio: string | null; seq: number } | undefined>();
  const onData = (d: CnpjData, form: HTMLFormElement) => {
    if (!d.stateCode) return;
    const current = (form.elements.namedItem("state_code") as HTMLSelectElement | null)?.value ?? "";
    if (current !== "" && current !== prefill?.uf) return;
    setPrefill({ uf: d.stateCode, municipio: d.municipalityId == null ? null : String(d.municipalityId), seq: (prefill?.seq ?? 0) + 1 });
  };
  return { prefill, onData };
}

export function CnpjSummary({ data: d }: { data: CnpjData }) {
  const inactive = isInactiveStatus(d.registrationStatus);
  return (
    <div className="mt-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="font-medium">
        {d.legalName}
        {d.tradeName ? <span className="font-normal text-neutral-500"> · {d.tradeName}</span> : null}
      </p>
      {inactive ? (
        <p role="alert" className="text-red-700 dark:text-red-300">
          Situação cadastral: {d.registrationStatus}
          {d.statusDate ? ` desde ${d.statusDate}` : ""}. Confira antes de cadastrar ou prospectar.
        </p>
      ) : (
        d.registrationStatus && <p className="text-green-700 dark:text-green-300">Situação cadastral: {d.registrationStatus}</p>
      )}
      <p className="text-neutral-600 dark:text-neutral-400">{formatAddress(d.address) || "Endereço não informado"}</p>
      <p className="text-neutral-600 dark:text-neutral-400">
        {[d.phones.map(formatPhone).join(", "), d.email].filter(Boolean).join(" · ") || "Sem telefone ou e-mail na Receita"}
        {d.partners.length ? ` · ${d.partners.length} sócio(s) no quadro societário` : ""}
      </p>
      <p className="text-xs text-neutral-500">
        Fonte: Receita Federal (dados abertos) via BrasilAPI, consultado em {new Date(d.fetchedAt).toLocaleString("pt-BR")}. Os dados
        completos, com sócios e CNAEs secundários, ficam salvos na ficha da empresa.
      </p>
    </div>
  );
}
