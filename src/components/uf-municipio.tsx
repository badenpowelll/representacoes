"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

type Municipio = { ibge_code: number; name: string };

/**
 * UF + município (opcional). Os municípios da UF escolhida vêm da view
 * pública ref_municipalities (somente leitura, referência global do IBGE).
 * O banco ainda valida que o município pertence à UF.
 */
export function UfMunicipioFields({
  states,
  defaultUf,
  defaultMunicipio,
  ufError,
  municipioError,
  municipioEmptyLabel = "Todos os municípios",
}: {
  states: { code: string; name?: string }[];
  defaultUf?: string;
  defaultMunicipio?: string;
  ufError?: string;
  municipioError?: string;
  municipioEmptyLabel?: string;
}) {
  const [uf, setUf] = useState(defaultUf ?? "");
  const [list, setList] = useState<{ uf: string; items: Municipio[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uf) return;
    let cancelled = false;
    createSupabaseBrowserClient()
      .from("ref_municipalities")
      .select("ibge_code, name")
      .eq("state_code", uf)
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return;
        setFailed(Boolean(error));
        setList({ uf, items: (data as Municipio[] | null) ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [uf]);

  const loading = Boolean(uf) && list?.uf !== uf && !failed;
  const items = list?.uf === uf ? list.items : [];

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
      <div className="flex flex-col gap-1">
        <label htmlFor="municipality_id" className="text-sm font-medium">
          Município
        </label>
        <select id="municipality_id" name="municipality_id" className={sel} disabled={!uf || loading}
          defaultValue={defaultUf === uf ? (defaultMunicipio ?? "") : ""} key={`${uf}-${items.length}`}
          aria-busy={loading || undefined}>
          <option value="">{!uf ? "Escolha a UF" : loading ? "Carregando..." : municipioEmptyLabel}</option>
          {items.map((m) => (
            <option key={m.ibge_code} value={m.ibge_code}>
              {m.name}
            </option>
          ))}
        </select>
        {failed && <p className="text-sm text-red-600">Não foi possível carregar os municípios.</p>}
        {municipioError && <p className="text-sm text-red-600">{municipioError}</p>}
      </div>
    </>
  );
}
