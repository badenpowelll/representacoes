"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { lookupCnpj } from "@/app/app/[tenantId]/cnpj-actions";

/** Busca (ou atualiza) os dados da Receita para o CNPJ da empresa. */
export function RefreshCnpjButton({ tenantId, cnpj, label }: { tenantId: string; cnpj: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="self-start rounded-md border px-3 py-1 text-sm disabled:opacity-60" disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const r = await lookupCnpj(tenantId, cnpj, { refresh: true });
            if (r.ok) router.refresh();
            else setMessage(r.message);
          })
        }>
        {pending ? "Consultando..." : label}
      </button>
      <p aria-live="polite" className="text-sm text-amber-700 dark:text-amber-300">
        {message}
      </p>
    </div>
  );
}
