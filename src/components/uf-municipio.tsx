"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

type Municipio = { ibge_code: number; name: string };
type Status = "idle" | "loading" | "ready" | "failed";

/**
 * UF + município. Os municípios da UF escolhida vêm da view pública
 * ref_municipalities (somente leitura, referência global do IBGE). O banco
 * ainda valida que o município pertence à UF.
 *
 * Com `explicitScope`, o usuário escolhe "UF inteira" ou "Um município"; não
 * há padrão. O select de município nunca fica `disabled` (campo desabilitado
 * não é enviado e uma escolha municipal viraria estadual por omissão). Em vez
 * disso, o formulário envia `municipio_status` (loading/failed/ready) e o
 * servidor recusa cobertura municipal que não esteja "ready".
 */
export function UfMunicipioFields({
  states,
  defaultUf,
  defaultMunicipio,
  defaultScope,
  ufError,
  municipioError,
  scopeError,
  explicitScope = false,
  municipioEmptyLabel = "Todos os municípios",
}: {
  states: { code: string; name?: string }[];
  defaultUf?: string;
  defaultMunicipio?: string;
  defaultScope?: string;
  ufError?: string;
  municipioError?: string;
  scopeError?: string;
  explicitScope?: boolean;
  municipioEmptyLabel?: string;
}) {
  const [uf, setUf] = useState(defaultUf ?? "");
  const [scope, setScope] = useState(defaultScope ?? "");
  const [list, setList] = useState<{ uf: string; items: Municipio[]; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uf) return;
    let cancelled = false;
    createSupabaseBrowserClient()
      .from("ref_municipalities")
      .select("ibge_code, name")
      .eq("state_code", uf)
      .order("name")
      .then(
        ({ data, error }) => {
          if (cancelled) return;
          setList({ uf, items: error ? [] : ((data as Municipio[] | null) ?? []), failed: Boolean(error) || !data?.length });
        },
        () => {
          if (!cancelled) setList({ uf, items: [], failed: true });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [uf, attempt]);

  // Só vale a lista carregada para a UF atual (troca rápida de UF descarta a anterior).
  const current = list?.uf === uf ? list : null;
  const status: Status = !uf ? "idle" : !current ? "loading" : current.failed ? "failed" : "ready";
  const items = current && !current.failed ? current.items : [];
  const showMunicipio = !explicitScope || scope === "municipality";
  const municipalRequired = explicitScope && scope === "municipality";

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="state_code" className="text-sm font-medium">
          UF
        </label>
        <select id="state_code" name="state_code" className={sel} value={uf} onChange={(e) => setUf(e.target.value)}
          aria-invalid={ufError ? true : undefined}>
          <option value="">Selecione</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name ? `${s.code} · ${s.name}` : s.code}
            </option>
          ))}
        </select>
        {ufError && <p className="text-sm text-red-600">{ufError}</p>}
      </div>
      {explicitScope && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Abrangência</legend>
          <div className="flex gap-4 py-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="coverage" value="state" checked={scope === "state"} onChange={() => setScope("state")} />
              UF inteira
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="coverage" value="municipality" checked={scope === "municipality"}
                onChange={() => setScope("municipality")} />
              Um município
            </label>
          </div>
          {scopeError && <p className="text-sm text-red-600">{scopeError}</p>}
        </fieldset>
      )}
      {explicitScope && <input type="hidden" name="municipio_status" value={status} />}
      {showMunicipio && (
        <div className="flex flex-col gap-1">
          <label htmlFor="municipality_id" className="text-sm font-medium">
            Município
          </label>
          <select id="municipality_id" name="municipality_id" className={sel}
            defaultValue={defaultUf === uf ? (defaultMunicipio ?? "") : ""} key={`${uf}-${status}`}
            aria-disabled={status !== "ready" || undefined} aria-busy={status === "loading" || undefined}
            aria-invalid={municipioError ? true : undefined} required={municipalRequired}>
            <option value="">
              {!uf
                ? "Escolha a UF"
                : status === "loading"
                  ? "Carregando..."
                  : status === "failed"
                    ? "Indisponível"
                    : municipalRequired
                      ? "Selecione o município"
                      : municipioEmptyLabel}
            </option>
            {items.map((m) => (
              <option key={m.ibge_code} value={m.ibge_code}>
                {m.name}
              </option>
            ))}
          </select>
          {status === "failed" && (
            <p className="text-sm text-red-600" role="alert">
              Não foi possível carregar os municípios.{" "}
              <button type="button" className="underline" onClick={() => { setList(null); setAttempt((n) => n + 1); }}>
                Tentar de novo
              </button>
            </p>
          )}
          {municipioError && <p className="text-sm text-red-600">{municipioError}</p>}
        </div>
      )}
    </>
  );
}
