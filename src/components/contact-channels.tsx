"use client";
import { useId, useState } from "react";
import {
  CHANNEL_KIND_LABELS,
  CHANNEL_KINDS,
  CHANNEL_LABEL_SUGGESTIONS,
  CONTACT_SOURCE_LABELS,
  type ChannelKind,
  type ContactInfoSource,
} from "@/lib/cnpj/contact-info";

export type ChannelRow = { kind: ChannelKind; label: string; value: string; source?: ContactInfoSource };

const cls = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";
const placeholders: Record<ChannelKind, string> = {
  phone: "(51) 3478-2085",
  whatsapp: "(51) 99999-0000",
  email: "vendas@empresa.com.br",
  address: "Rua, número, bairro, cidade/UF, CEP",
  other: "Instagram, LinkedIn, ramal...",
};

/**
 * Lista editável de canais de contato (telefone, WhatsApp, e-mail, endereço,
 * outro), cada um com rótulo livre (Comercial, Licitações, Financeiro...).
 * Envia a lista como JSON no campo `contact_channels`. A origem (Receita ou
 * manual) é recalculada no servidor.
 *
 * `seed` substitui a lista enquanto o usuário não a tiver alterado (usado pela
 * consulta de CNPJ). Muda `seq` para aplicar de novo.
 */
export function ContactChannelsEditor({
  defaultValue,
  error,
  seed,
}: {
  defaultValue?: ChannelRow[];
  error?: string;
  seed?: { rows: ChannelRow[]; seq: number };
}) {
  const [rows, setRows] = useState<ChannelRow[]>(defaultValue?.length ? defaultValue : []);
  const [appliedSeq, setAppliedSeq] = useState<number | null>(null);
  if (seed && seed.seq !== appliedSeq) {
    setAppliedSeq(seed.seq);
    // Mantém o que o usuário digitou e troca só o que veio da Receita (sem repetir).
    const manual = rows.filter((r) => r.source !== "receita" && r.value.trim() !== "");
    const key = (r: ChannelRow) => `${r.kind}:${r.value.replace(/\D/g, "") || r.value.toLowerCase()}`;
    const seen = new Set(manual.map(key));
    setRows([...manual, ...seed.rows.filter((r) => !seen.has(key(r)))]);
  }
  const listId = useId();
  const update = (i: number, patch: Partial<ChannelRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, source: undefined } : r)));
  };
  const payload = JSON.stringify(rows.map(({ kind, label, value }) => ({ kind, label, value })));

  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className="text-sm font-medium">Canais de contato</legend>
      <p className="text-xs text-neutral-500">
        Telefones, WhatsApp, e-mails e endereços por área (Comercial, Licitações, Financeiro...). Pessoas específicas vão em Contatos, com base legal.
      </p>
      <input type="hidden" name="contact_channels" value={payload} />
      <datalist id={listId}>
        {CHANNEL_LABEL_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {rows.length === 0 && <p className="text-sm text-neutral-500">Nenhum canal. Use o botão abaixo para adicionar.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[9rem_10rem_1fr_auto] sm:items-center">
            <select aria-label={`Tipo do canal ${i + 1}`} className={cls} value={r.kind}
              onChange={(e) => update(i, { kind: e.target.value as ChannelKind })}>
              {CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CHANNEL_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input aria-label={`Rótulo do canal ${i + 1}`} className={cls} list={listId} placeholder="Comercial" maxLength={60}
              value={r.label} onChange={(e) => update(i, { label: e.target.value })} />
            <input aria-label={`${CHANNEL_KIND_LABELS[r.kind]} ${i + 1}`} className={`${cls} min-w-0`} maxLength={300}
              type={r.kind === "email" ? "email" : r.kind === "phone" || r.kind === "whatsapp" ? "tel" : "text"}
              placeholder={placeholders[r.kind]} value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
            <div className="flex items-center gap-2">
              {r.source && <span className="text-xs text-neutral-500">{CONTACT_SOURCE_LABELS[r.source]}</span>}
              <button type="button" className="rounded-md border px-2 py-1 text-sm" aria-label={`Remover canal ${i + 1}`}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="rounded-md border px-3 py-1 text-sm"
          onClick={() => setRows((rs) => [...rs, { kind: "phone", label: "", value: "" }])}>
          Adicionar canal
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </fieldset>
  );
}

/** Linhas iniciais a partir da Receita: telefones e e-mail. */
export function channelsFromReceita(d: { phones: string[]; email: string | null }): ChannelRow[] {
  const fmt = (p: string) => (p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`);
  return [
    ...d.phones.map((p) => ({ kind: "phone" as const, label: "Receita", value: fmt(p), source: "receita" as const })),
    ...(d.email ? [{ kind: "email" as const, label: "Receita", value: d.email, source: "receita" as const }] : []),
  ];
}

/** Lê a lista enviada antes (após erro de validação, o formulário é remontado). */
export function channelsFromJson(raw: string | undefined): ChannelRow[] | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as ChannelRow[]) : undefined;
  } catch {
    return undefined;
  }
}
