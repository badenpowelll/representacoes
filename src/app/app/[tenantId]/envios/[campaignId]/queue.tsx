"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { sendToRecipient, skipRecipient } from "../actions";

export type QueueRow = {
  id: string;
  companyId: string;
  company: string;
  to: string | null;
  status: "pending" | "sent" | "skipped" | "blocked";
  reason: string | null;
  subject: string;
  body: string;
};

const LABEL: Record<QueueRow["status"], string> = { pending: "Na fila", sent: "Enviado", skipped: "Pulado", blocked: "Bloqueado" };
const input = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function CampaignQueue({ tenantId, channel, rows, canSend }: { tenantId: string; channel: "email" | "whatsapp"; rows: QueueRow[]; canSend: boolean }) {
  const [open, setOpen] = useState<string | null>(rows.find((r) => r.status === "pending")?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const draft = (r: QueueRow) => drafts[r.id] ?? { subject: r.subject, body: r.body };
  const nextAfter = (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    return rows.slice(i + 1).find((r) => r.status === "pending" && !done[r.id])?.id ?? null;
  };

  function send(r: QueueRow) {
    const d = draft(r);
    // Abre a janela já no clique (bloqueadores de pop-up) e define o endereço quando o servidor responder.
    const win = channel === "whatsapp" ? window.open("about:blank", "_blank") : null;
    start(async () => {
      const res = await sendToRecipient({ tenantId, recipientId: r.id, subject: d.subject, body: d.body });
      if (!res.ok) {
        win?.close();
        setErrors((e) => ({ ...e, [r.id]: res.message }));
        return;
      }
      if (win) win.location.href = res.url;
      else window.location.href = res.url;
      setDone((x) => ({ ...x, [r.id]: res.alreadySent ? "Já estava registrado como enviado." : "Registrado no histórico do cliente." }));
      setOpen(nextAfter(r.id));
    });
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {rows.map((r) => {
        const status = done[r.id] ? "sent" : r.status;
        const isOpen = open === r.id && status === "pending";
        const d = draft(r);
        return (
          <li key={r.id} className="flex flex-col gap-3 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link href={`/app/${tenantId}/empresas/${r.companyId}`} className="font-medium underline">{r.company}</Link>
                <span className="ml-2 text-neutral-500">{r.to ?? "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    status === "sent" ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100"
                    : status === "blocked" ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                    : "bg-neutral-100 dark:bg-neutral-800"}`}
                >
                  {LABEL[status]}{status === "blocked" && r.reason ? `: ${r.reason}` : ""}
                </span>
                {status === "pending" && canSend && !isOpen && (
                  <button type="button" className="rounded-md border px-3 py-1" onClick={() => setOpen(r.id)}>Ver mensagem</button>
                )}
              </div>
            </div>
            {done[r.id] && <p role="status" className="text-green-800 dark:text-green-200">{done[r.id]}</p>}
            {errors[r.id] && <p role="alert" className="text-red-700 dark:text-red-300">{errors[r.id]}</p>}
            {isOpen && canSend && (
              <section aria-label={`Mensagem para ${r.company}`} className="flex flex-col gap-2">
                {channel === "email" && (
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">Assunto</span>
                    <input className={input} value={d.subject} onChange={(e) => setDrafts((x) => ({ ...x, [r.id]: { ...d, subject: e.target.value } }))} />
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Mensagem</span>
                  <textarea className={input} rows={channel === "email" ? 9 : 4} value={d.body}
                    onChange={(e) => setDrafts((x) => ({ ...x, [r.id]: { ...d, body: e.target.value } }))} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pending} onClick={() => send(r)} className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60">
                    {channel === "email" ? "Abrir no e-mail" : "Abrir no WhatsApp"}
                  </button>
                  <form action={skipRecipient}>
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="recipient_id" value={r.id} />
                    <button className="rounded-md border px-3 py-2">Pular</button>
                  </form>
                </div>
              </section>
            )}
          </li>
        );
      })}
    </ul>
  );
}
