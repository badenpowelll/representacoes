"use client";
import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from "@/lib/validation/schemas";
import { deleteDeal, moveDeal, updateDeal } from "../actions";
import { DealPartyFields, selectClass } from "../forms";

export type BoardDeal = {
  id: string;
  title: string;
  stage: DealStage;
  amount: number | null;
  lost_reason: string | null;
  company_id: string;
  company_name: string | null;
  industry_id: string | null;
  industry_name: string | null;
};

type Props = {
  tenantId: string;
  deals: BoardDeal[];
  companies: { id: string; legal_name: string }[];
  industries: { id: string; name: string }[];
  writable: boolean;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Valor como o usuário digita (12.500,00), para o formulário de edição. */
const amountInput = (v: number | null) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DealBoard({ tenantId, deals, companies, industries, writable }: Props) {
  const [optimistic, applyMove] = useOptimistic(deals, (list, m: { id: string; stage: DealStage }) =>
    list.map((d) => (d.id === m.id ? { ...d, stage: m.stage } : d)),
  );
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);
  const [editing, setEditing] = useState<{ deal: BoardDeal; stage?: DealStage } | null>(null);
  const [removing, setRemoving] = useState<BoardDeal | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function drop(stage: DealStage) {
    const deal = optimistic.find((d) => d.id === dragId);
    setDragId(null);
    setOverStage(null);
    if (!deal || deal.stage === stage) return;
    // Perda exige motivo: abre a edição já na etapa "Perdido".
    if (stage === "lost") return setEditing({ deal, stage: "lost" });
    const form = new FormData();
    form.set("tenant_id", tenantId);
    form.set("deal_id", deal.id);
    form.set("stage", stage);
    startTransition(async () => {
      applyMove({ id: deal.id, stage });
      const r = await moveDeal(initialState, form);
      setNotice(r.ok ? null : { ok: false, text: r.message ?? "Não foi possível mover o negócio." });
    });
  }

  return (
    <>
      {notice && (
        <div className="mb-3">
          <Alert kind={notice.ok ? "success" : "error"}>{notice.text}</Alert>
        </div>
      )}
      {writable && (
        <p className="mb-3 text-sm text-neutral-500">
          Arraste um card para outra etapa, ou use <strong>Editar</strong> para mudar título, empresa, indústria, valor e etapa.
        </p>
      )}
      <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
        {DEAL_STAGES.map((stage) => {
          const items = optimistic.filter((d) => d.stage === stage);
          const isOver = overStage === stage && dragId != null;
          return (
            <section
              key={stage}
              aria-labelledby={`col-${stage}`}
              onDragOver={
                writable
                  ? (e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overStage !== stage) setOverStage(stage);
                    }
                  : undefined
              }
              onDragLeave={writable ? (e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOverStage(null) : undefined}
              onDrop={
                writable
                  ? (e) => {
                      e.preventDefault();
                      drop(stage);
                    }
                  : undefined
              }
              className={`flex flex-col rounded-[14px] border p-3 transition-colors ${
                isOver ? "border-argos-orange bg-argos-tint-orange/60" : "border-transparent bg-surface-muted"
              }`}
            >
              <h2 id={`col-${stage}`} className="mb-3 text-sm font-semibold text-argos-navy">
                {DEAL_STAGE_LABELS[stage]} <span className="font-normal text-neutral-500">({items.length})</span>
              </h2>
              <ul className="flex min-h-16 flex-col gap-2">
                {items.map((d) => (
                  <li
                    key={d.id}
                    draggable={writable}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", d.id);
                      setDragId(d.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={`rounded-[10px] border border-neutral-200 bg-white p-3 text-sm shadow-[var(--ads-shadow-card)] ${
                      writable ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragId === d.id ? "opacity-50" : ""}`}
                  >
                    <p className="font-semibold text-argos-navy">{d.title}</p>
                    <p className="text-neutral-600">{d.company_name}</p>
                    {d.industry_name && (
                      <p className="mt-1">
                        <span className="rounded-full bg-argos-tint-navy px-2 py-0.5 text-xs text-argos-navy">{d.industry_name}</span>
                      </p>
                    )}
                    {d.amount != null && <p className="mt-1 font-medium">{brl(Number(d.amount))}</p>}
                    {d.lost_reason && <p className="mt-1 text-argos-rust">Motivo: {d.lost_reason}</p>}
                    {writable && (
                      <div className="mt-3 flex gap-2 border-t border-neutral-200 pt-2">
                        <button
                          type="button"
                          onClick={() => setEditing({ deal: d })}
                          aria-label={`Editar ${d.title}`}
                          className="rounded-md px-2 py-1 font-medium text-argos-navy hover:bg-argos-tint-navy"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(d)}
                          aria-label={`Excluir ${d.title}`}
                          className="rounded-md px-2 py-1 font-medium text-argos-rust hover:bg-[#fdeee9]"
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {editing && (
        <Modal title="Editar negócio" onClose={() => setEditing(null)}>
          <EditDealForm
            tenantId={tenantId}
            deal={editing.deal}
            initialStage={editing.stage}
            companies={companies}
            industries={industries}
            onDone={(msg) => {
              setEditing(null);
              setNotice({ ok: true, text: msg });
            }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {removing && (
        <Modal title="Excluir negócio" onClose={() => setRemoving(null)}>
          <DeleteDealForm
            tenantId={tenantId}
            deal={removing}
            onDone={(msg) => {
              setRemoving(null);
              setNotice({ ok: true, text: msg });
            }}
            onCancel={() => setRemoving(null)}
          />
        </Modal>
      )}
    </>
  );
}

/** Janela modal nativa (<dialog>): foco preso, Esc fecha, acessível por teclado. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-titulo"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-[14px] border border-neutral-200 bg-white p-0 text-argos-navy shadow-[var(--ads-shadow-card)] backdrop:bg-argos-navy/40"
    >
      <div className="p-5">
        <h2 id="modal-titulo" className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

/** Chama `fn` uma única vez por resposta de sucesso da action. */
function useOnSuccess(state: ActionState, fn: () => void) {
  const fnRef = useRef(fn);
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (state.ok && state.nonce !== seen.current) {
      seen.current = state.nonce;
      fnRef.current();
    }
  }, [state]);
}

function SecondaryButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="inline-flex min-h-[42px] items-center justify-center rounded-[10px] border border-neutral-300 px-5 py-2 font-medium text-argos-navy hover:bg-neutral-100"
      {...props}
    />
  );
}

function EditDealForm({
  tenantId,
  deal,
  initialStage,
  companies,
  industries,
  onDone,
  onCancel,
}: {
  tenantId: string;
  deal: BoardDeal;
  initialStage?: DealStage;
  companies: { id: string; legal_name: string }[];
  industries: { id: string; name: string }[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(updateDeal, initialState);
  const values = state.values ?? {
    title: deal.title,
    company_id: deal.company_id,
    industry_id: deal.industry_id ?? "",
    amount: amountInput(deal.amount),
    stage: initialStage ?? deal.stage,
    lost_reason: deal.lost_reason ?? "",
  };
  const [stage, setStage] = useState<DealStage>((values.stage as DealStage) ?? deal.stage);
  // A indústria do card pode não estar na lista (ex.: limite); mantém a opção atual.
  const industryOptions =
    deal.industry_id && !industries.some((i) => i.id === deal.industry_id)
      ? [...industries, { id: deal.industry_id, name: deal.industry_name ?? "Indústria atual" }]
      : industries;

  useOnSuccess(state, () => onDone(state.message ?? "Negócio atualizado."));

  return (
    <form key={state.nonce} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="deal_id" value={deal.id} />
      {state.message && !state.ok && (
        <div className="sm:col-span-2">
          <Alert kind="error">{state.message}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field id="edit-title" label="Título" name="title" defaultValue={values.title} required error={state.fieldErrors?.title} />
      </div>
      <DealPartyFields idPrefix="edit-" companies={companies} industries={industryOptions} values={values} fieldErrors={state.fieldErrors} />
      <Field id="edit-amount" label="Valor (R$)" name="amount" defaultValue={values.amount} inputMode="decimal"
        error={state.fieldErrors?.amount} />
      <div className="flex flex-col gap-1">
        <label htmlFor="edit-stage" className="text-sm font-medium text-argos-navy">
          Etapa
        </label>
        <select id="edit-stage" name="stage" value={stage} onChange={(e) => setStage(e.target.value as DealStage)} className={selectClass}>
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {DEAL_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.stage && <p className="text-sm text-red-600">{state.fieldErrors.stage}</p>}
      </div>
      {stage === "lost" && (
        <div className="sm:col-span-2">
          <Field id="edit-lost-reason" label="Motivo da perda" name="lost_reason" defaultValue={values.lost_reason ?? ""} required
            autoFocus={initialStage === "lost"} error={state.fieldErrors?.lost_reason} />
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <SecondaryButton onClick={onCancel}>Cancelar</SecondaryButton>
        <SubmitButton pendingText="Salvando...">Salvar alterações</SubmitButton>
      </div>
    </form>
  );
}

function DeleteDealForm({
  tenantId,
  deal,
  onDone,
  onCancel,
}: {
  tenantId: string;
  deal: BoardDeal;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(deleteDeal, initialState);
  useOnSuccess(state, () => onDone(state.message ?? "Negócio excluído."));
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="deal_id" value={deal.id} />
      {state.message && !state.ok && <Alert kind="error">{state.message}</Alert>}
      <p>
        Tem certeza de que deseja excluir o negócio <strong>{deal.title}</strong>
        {deal.company_name ? <> de {deal.company_name}</> : null}? O histórico de etapas dele também será apagado. Esta ação não pode
        ser desfeita.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton onClick={onCancel} autoFocus>
          Cancelar
        </SecondaryButton>
        <DangerSubmit />
      </div>
    </form>
  );
}

function DangerSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex min-h-[42px] items-center justify-center rounded-[10px] bg-argos-rust px-5 py-2 font-semibold text-white hover:bg-[#8f1e00] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Excluindo..." : "Excluir negócio"}
    </button>
  );
}
