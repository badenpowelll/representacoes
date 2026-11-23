"use client";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui";
import { initialState } from "@/lib/action-state";
import { formatCnpj } from "@/lib/validation/cnpj";
import { formatCnae } from "@/lib/prospeccao/presets";
import { formatPhone, isMobile, renderTemplate, unresolvedVariables, type Channel, type TemplateVars } from "@/lib/prospeccao/messages";
import { addToPortfolio, prepareOutreach } from "./actions";

export type ProspectRow = {
  cnpj: string;
  legal_name: string;
  trade_name: string | null;
  is_headquarters: boolean;
  opened_on: string | null;
  main_cnae: string;
  main_cnae_description: string | null;
  company_size: string | null;
  state_code: string;
  municipality_name: string | null;
  district: string | null;
  phones: string[];
  email: string | null;
  company_id: string | null;
  /** Modo de uma indústria: lead desta empresa com a indústria escolhida. */
  lead_id?: string | null;
  /** Modo "todas as indústrias": indústrias compatíveis e vínculos existentes. */
  industries?: { id: string; name: string; lead_id: string | null }[];
  industry_count?: number;
  linked_count?: number;
  email_suppressed: boolean;
  phone_suppressed: boolean;
};

type Templates = Record<Channel, { subject: string | null; body: string }>;
type Draft = { row: ProspectRow; channel: Channel; to: string; originalTo: string; subject: string; body: string };

const SIZE: Record<string, string> = { "01": "ME", "03": "EPP", "05": "Demais" };
const box = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

/** "Balmak, Biobase e Fibra" */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}

const inPortfolio = (r: ProspectRow) => (r.industries ? (r.linked_count ?? 0) > 0 : Boolean(r.lead_id));
const fullyLinked = (r: ProspectRow) => (r.industries ? (r.linked_count ?? 0) >= (r.industry_count ?? 0) : Boolean(r.lead_id));

export function ProspectTable({
  tenantId,
  industryId,
  rows,
  templates,
  baseVars,
  canWrite,
}: {
  tenantId: string;
  /** null = todas as indústrias (mix). */
  industryId: string | null;
  rows: ProspectRow[];
  templates: Templates;
  baseVars: Pick<TemplateVars, "representacao" | "remetente"> & { industria?: string };
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addState, addAction] = useActionState(addToPortfolio, initialState);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectable = rows.filter((r) => !fullyLinked(r));
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.cnpj));
  const toggle = (cnpj: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(cnpj)) n.delete(cnpj);
      else n.add(cnpj);
      return n;
    });

  const open = (row: ProspectRow, channel: Channel) => {
    const vars: Partial<TemplateVars> = {
      ...baseVars,
      industria: row.industries ? joinNames(row.industries.map((i) => i.name)) : baseVars.industria,
      empresa: row.trade_name || row.legal_name,
      nome_fantasia: row.trade_name ?? "",
      cidade: row.municipality_name ?? "",
      uf: row.state_code,
    };
    const t = templates[channel];
    const to = channel === "email" ? (row.email ?? "") : (row.phones.find(isMobile) ?? row.phones[0] ?? "");
    setResult(null);
    setDraft({
      row,
      channel,
      to: channel === "whatsapp" && to ? formatPhone(to) : to,
      originalTo: to,
      subject: renderTemplate(t.subject ?? "", vars),
      body: renderTemplate(t.body, vars),
    });
  };

  const send = () => {
    if (!draft) return;
    startTransition(async () => {
      const r = await prepareOutreach({
        tenantId,
        industryId: industryId ?? undefined,
        cnpj: draft.row.cnpj,
        channel: draft.channel,
        to: draft.to,
        originalTo: draft.originalTo || undefined,
        subject: draft.channel === "email" ? draft.subject : undefined,
        body: draft.body,
      });
      setResult(r);
      if (r.ok) {
        if (draft.channel === "email") window.location.href = r.url;
        else window.open(r.url, "_blank", "noopener,noreferrer");
      }
    });
  };

  const pendingVars = draft ? unresolvedVariables(`${draft.subject} ${draft.body}`) : [];

  return (
    <div className="flex flex-col gap-4">
      <form action={addAction} className="flex flex-col gap-3">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="industry_id" value={industryId ?? "todas"} />
        {[...selected].map((c) => (
          <input key={c} type="hidden" name="cnpj" value={c} />
        ))}
        {addState.message && <Alert kind={addState.ok ? "success" : "error"}>{addState.message}</Alert>}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={selected.size === 0}
              className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50">
              Adicionar {selected.size || ""} à carteira
            </button>
            <span className="text-sm text-neutral-500">
              {industryId
                ? "Cria empresa, lead e contato institucional, com fonte e base legal registradas."
                : "Cria a empresa e um lead para cada indústria compatível, com fonte e base legal registradas."}
            </span>
          </div>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Empresas-alvo da indústria</caption>
          <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
            <tr>
              {canWrite && (
                <th scope="col" className="px-3 py-2">
                  <input type="checkbox" aria-label="Marcar todas desta página" checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.cnpj)))} />
                </th>
              )}
              <th scope="col" className="px-3 py-2">Empresa</th>
              {!industryId && <th scope="col" className="px-3 py-2">Indústrias que podem vender</th>}
              <th scope="col" className="px-3 py-2">Atividade (CNAE)</th>
              <th scope="col" className="px-3 py-2">Cidade</th>
              <th scope="col" className="px-3 py-2">Telefone</th>
              <th scope="col" className="px-3 py-2">E-mail</th>
              <th scope="col" className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cnpj} className="border-t align-top">
                {canWrite && (
                  <td className="px-3 py-2">
                    {!fullyLinked(r) && (
                      <input type="checkbox" aria-label={`Marcar ${r.legal_name}`} checked={selected.has(r.cnpj)} onChange={() => toggle(r.cnpj)} />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <p className="font-medium">{r.trade_name || r.legal_name}</p>
                  {r.trade_name && <p className="text-xs text-neutral-500">{r.legal_name}</p>}
                  <p className="text-xs text-neutral-500">
                    {formatCnpj(r.cnpj)} · {r.is_headquarters ? "Matriz" : "Filial"}
                    {r.company_size && SIZE[r.company_size] ? ` · ${SIZE[r.company_size]}` : ""}
                    {r.opened_on ? ` · desde ${r.opened_on.slice(0, 4)}` : ""}
                  </p>
                  {inPortfolio(r) && (
                    <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-900 dark:bg-green-950 dark:text-green-100">
                      Na carteira
                    </span>
                  )}
                </td>
                {!industryId && (
                  <td className="px-3 py-2">
                    <ul className="flex flex-wrap gap-1">
                      {r.industries?.map((i) => (
                        <li key={i.id}
                          className={`rounded px-2 py-0.5 text-xs ${i.lead_id ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100" : "bg-neutral-100 dark:bg-neutral-800"}`}
                          title={i.lead_id ? "Já vinculada a este cliente" : "Compatível, ainda não vinculada"}>
                          {i.lead_id ? "✓ " : ""}{i.name}
                        </li>
                      ))}
                    </ul>
                  </td>
                )}
                <td className="px-3 py-2" title={r.main_cnae_description ?? undefined}>
                  <p>{formatCnae(r.main_cnae)}</p>
                  <p className="max-w-56 text-xs text-neutral-500">{r.main_cnae_description}</p>
                </td>
                <td className="px-3 py-2">
                  {r.municipality_name}/{r.state_code}
                  {r.district && <p className="text-xs text-neutral-500">{r.district}</p>}
                </td>
                <td className="px-3 py-2">
                  {r.phone_suppressed ? (
                    <span className="text-xs text-red-700 dark:text-red-300">Bloqueado (oposição)</span>
                  ) : r.phones.length ? (
                    r.phones.map((p) => (
                      <p key={p} className="whitespace-nowrap">
                        {formatPhone(p)} {isMobile(p) && <span className="text-xs text-neutral-500">celular</span>}
                      </p>
                    ))
                  ) : (
                    <span className="text-neutral-400">não informado</span>
                  )}
                </td>
                <td className="px-3 py-2 break-all">
                  {r.email_suppressed ? (
                    <span className="text-xs text-red-700 dark:text-red-300">Bloqueado (oposição)</span>
                  ) : (
                    (r.email ?? <span className="text-neutral-400">não informado</span>)
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    {canWrite && !r.email_suppressed && (
                      <button type="button" className="underline" onClick={() => open(r, "email")}>E-mail</button>
                    )}
                    {canWrite && !r.phone_suppressed && (
                      <button type="button" className="underline" onClick={() => open(r, "whatsapp")}>WhatsApp</button>
                    )}
                    {r.company_id && (
                      <Link href={`/app/${tenantId}/empresas/${r.company_id}`} className="underline">Editar dados</Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <section aria-labelledby="composer-title" className="fixed inset-x-0 bottom-0 z-20 max-h-[85vh] overflow-y-auto border-t bg-white p-4 shadow-2xl dark:bg-neutral-950 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[32rem] sm:rounded-lg sm:border">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 id="composer-title" className="font-semibold">
                {draft.channel === "email" ? "E-mail" : "WhatsApp"} para {draft.row.trade_name || draft.row.legal_name}
              </h2>
              <p className="text-xs text-neutral-500">Revise e edite antes de enviar. O envio sai do seu e-mail ou do seu WhatsApp.</p>
            </div>
            <button type="button" className="text-sm underline" onClick={() => setDraft(null)}>Fechar</button>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{draft.channel === "email" ? "Para (e-mail)" : "Telefone com DDD"}</span>
              <input className={box} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                inputMode={draft.channel === "email" ? "email" : "tel"} />
              {draft.to !== (draft.channel === "whatsapp" && draft.originalTo ? formatPhone(draft.originalTo) : draft.originalTo) && (
                <span className="text-xs text-neutral-500">Alterado: será salvo no contato da empresa, com registro da correção.</span>
              )}
            </label>
            {draft.channel === "email" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Assunto</span>
                <input className={box} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Mensagem</span>
              <textarea className={box} rows={draft.channel === "email" ? 10 : 5} value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </label>
            {pendingVars.length > 0 && (
              <Alert kind="info">Complete no texto: {pendingVars.map((v) => `{{${v}}}`).join(", ")}</Alert>
            )}
            {result && (
              <Alert kind={result.ok ? "success" : "error"}>
                {result.message}{" "}
                {result.ok && result.url && (
                  <a href={result.url} target={draft.channel === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer" className="font-medium underline">
                    Abrir de novo
                  </a>
                )}
              </Alert>
            )}
            <div>
              <button type="button" onClick={send} disabled={pending || pendingVars.length > 0}
                className="rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800 disabled:opacity-50">
                {pending ? "Verificando..." : draft.channel === "email" ? "Abrir no e-mail" : "Abrir no WhatsApp"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
