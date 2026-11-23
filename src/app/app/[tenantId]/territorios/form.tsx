"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { initialState } from "@/lib/action-state";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { REGIOES, type Regiao, resumoSelecao } from "@/lib/territorios/selecao";
import { addTerritories } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";
const chip = "rounded-full border px-3 py-1 text-sm aria-pressed:border-blue-700 aria-pressed:bg-blue-700 aria-pressed:text-white";
const linkBtn = "text-sm text-blue-700 underline dark:text-blue-400";

type Estado = { code: string; name: string; region: string };
type Municipio = { ibge_code: number; name: string };
type Lista = { status: "loading" | "ready" | "failed"; items: Municipio[] };

/** Tira acentos e caixa para a busca de municípios. */
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Escolha de território em cascata: Região (filtro) → Estados (vários) →
 * Municípios (todos ou um a um), com dados do IBGE da view ref_municipalities.
 */
export function TerritoryForm({
  tenantId,
  industries,
  states,
  reps,
}: {
  tenantId: string;
  industries: { id: string; name: string }[];
  states: Estado[];
  reps: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(addTerritories, initialState);
  const v = state.values ?? {};
  // Só restaura a seleção depois de erro; após sucesso o formulário recomeça vazio.
  const restored = useMemo(() => {
    try {
      return (JSON.parse(v.selection || "[]") as { uf: string; municipios: "all" | number[] }[]) ?? [];
    } catch {
      return [];
    }
  }, [v.selection]);

  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="tenant_id" value={tenantId} />
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="industry_id" className="text-sm font-medium">
            Indústria
          </label>
          <select id="industry_id" name="industry_id" className={sel} defaultValue={v.industry_id ?? (industries.length === 1 ? industries[0].id : "")}
            aria-invalid={state.fieldErrors?.industry_id ? true : undefined}>
            <option value="">Selecione</option>
            {industries.length > 1 && <option value="all">Todas as indústrias ({industries.length})</option>}
            {industries.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          {state.fieldErrors?.industry_id && <p className="text-sm text-red-600">{state.fieldErrors.industry_id}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="membership_id" className="text-sm font-medium">
            Responsável
          </label>
          <select id="membership_id" name="membership_id" className={sel} defaultValue={v.membership_id ?? ""}>
            <option value="">Toda a equipe</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="exclusive" defaultChecked={v.exclusive === "on"} /> Exclusividade
        </label>
      </div>
      <SeletorTerritorio states={states} initial={restored} error={state.fieldErrors?.selection} />
      <div>
        <SubmitButton pendingText="Salvando...">Salvar territórios</SubmitButton>
      </div>
    </form>
  );
}

function SeletorTerritorio({
  states,
  initial,
  error,
}: {
  states: Estado[];
  initial: { uf: string; municipios: "all" | number[] }[];
  error?: string;
}) {
  const [regioes, setRegioes] = useState<Regiao[]>([]);
  const [ufs, setUfs] = useState<string[]>(() => initial.map((s) => s.uf));
  const [modo, setModo] = useState<Record<string, "all" | "some">>(() =>
    Object.fromEntries(initial.map((s) => [s.uf, s.municipios === "all" ? "all" : "some"])),
  );
  const [escolhidos, setEscolhidos] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(initial.filter((s) => s.municipios !== "all").map((s) => [s.uf, s.municipios as number[]])),
  );
  const [listas, setListas] = useState<Record<string, Lista>>({});

  // Carrega os municípios de cada UF marcada (uma vez por UF; "tentar de novo" refaz).
  useEffect(() => {
    const faltam = ufs.filter((uf) => !listas[uf]);
    if (!faltam.length) return;
    setListas((l) => ({ ...l, ...Object.fromEntries(faltam.map((uf) => [uf, { status: "loading", items: [] }])) }));
    const supabase = createSupabaseBrowserClient();
    for (const uf of faltam) {
      supabase
        .from("ref_municipalities")
        .select("ibge_code, name")
        .eq("state_code", uf)
        .order("name")
        .then(
          ({ data, error }) =>
            setListas((l) => ({
              ...l,
              [uf]: error || !data?.length ? { status: "failed", items: [] } : { status: "ready", items: data as Municipio[] },
            })),
          () => setListas((l) => ({ ...l, [uf]: { status: "failed", items: [] } })),
        );
    }
  }, [ufs, listas]);

  const porRegiao = useMemo(() => {
    const visiveis = regioes.length ? REGIOES.filter((r) => regioes.includes(r)) : REGIOES;
    return visiveis.map((r) => ({ regiao: r, estados: states.filter((s) => s.region === r) }));
  }, [regioes, states]);

  const toggleUf = (uf: string, on: boolean) => {
    setUfs((cur) => (on ? (cur.includes(uf) ? cur : [...cur, uf]) : cur.filter((u) => u !== uf)));
    if (on) setModo((m) => ({ ...m, [uf]: m[uf] ?? "all" }));
  };
  const marcarRegiao = (estados: Estado[], on: boolean) => estados.forEach((s) => toggleUf(s.code, on));

  const ordem = states.map((s) => s.code);
  const selecao = ufs
    .slice()
    .sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))
    .map((uf) => ({ uf, municipios: modo[uf] === "some" ? (escolhidos[uf] ?? []) : ("all" as const) }));

  return (
    <div className="flex flex-col gap-6">
      <input type="hidden" name="selection" value={JSON.stringify(selecao)} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">1. Região</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por região">
          {REGIOES.map((r) => (
            <button key={r} type="button" className={chip} aria-pressed={regioes.includes(r)}
              onClick={() => setRegioes((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}>
              {r}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">Filtra os estados abaixo. Sem região marcada, aparecem todos.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">2. Estados</legend>
        {porRegiao.map(({ regiao, estados }) => {
          const todos = estados.every((s) => ufs.includes(s.code));
          return (
            <div key={regiao} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{regiao}</span>
                <button type="button" className={linkBtn} onClick={() => marcarRegiao(estados, !todos)}>
                  {todos ? `Desmarcar ${regiao}` : `Marcar todo o ${regiao}`}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {estados.map((s) => (
                  <label key={s.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ufs.includes(s.code)} onChange={(e) => toggleUf(s.code, e.target.checked)} />
                    <span>
                      <strong>{s.code}</strong> · {s.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">3. Municípios</legend>
        {!selecao.length && <p className="text-sm text-neutral-500">Marque ao menos um estado.</p>}
        {selecao.map(({ uf }) => (
          <MunicipiosDaUf key={uf} uf={uf} nome={states.find((s) => s.code === uf)?.name ?? uf} lista={listas[uf]}
            modo={modo[uf] ?? "all"} setModo={(m) => setModo((cur) => ({ ...cur, [uf]: m }))}
            escolhidos={escolhidos[uf] ?? []} setEscolhidos={(ids) => setEscolhidos((cur) => ({ ...cur, [uf]: ids }))}
            onRetry={() =>
              setListas((l) => {
                const rest = { ...l };
                delete rest[uf];
                return rest;
              })
            }
            onRemove={() => toggleUf(uf, false)} />
        ))}
      </fieldset>

      {selecao.length > 0 && (
        <p className="text-sm" aria-live="polite">
          <span className="font-medium">Seleção:</span> {resumoSelecao(selecao)}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function MunicipiosDaUf({
  uf,
  nome,
  lista,
  modo,
  setModo,
  escolhidos,
  setEscolhidos,
  onRetry,
  onRemove,
}: {
  uf: string;
  nome: string;
  lista?: Lista;
  modo: "all" | "some";
  setModo: (m: "all" | "some") => void;
  escolhidos: number[];
  setEscolhidos: (ids: number[]) => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const [busca, setBusca] = useState("");
  const status = lista?.status ?? "loading";
  const items = useMemo(() => lista?.items ?? [], [lista]);
  const filtrados = useMemo(() => {
    const q = norm(busca.trim());
    return q ? items.filter((m) => norm(m.name).includes(q)) : items;
  }, [busca, items]);
  const marcados = new Set(escolhidos);
  const total = status === "ready" ? ` (${items.length})` : "";

  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800" aria-label={`Municípios de ${uf}`} role="group">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {uf} · {nome}
        </span>
        <button type="button" className="text-sm text-red-700 underline" onClick={onRemove}>
          Tirar {uf}
        </button>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name={`modo-${uf}`} checked={modo === "all"} onChange={() => setModo("all")} />
          Todos os municípios de {uf}
          {total}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={`modo-${uf}`} checked={modo === "some"} onChange={() => setModo("some")} />
          Escolher municípios de {uf}
        </label>
      </div>
      {modo === "some" && (
        <div className="mt-3 flex flex-col gap-2">
          {status === "loading" && (
            <p className="text-sm text-neutral-500" aria-busy="true">
              Carregando municípios...
            </p>
          )}
          {status === "failed" && (
            <p className="text-sm text-red-600" role="alert">
              Não foi possível carregar os municípios.{" "}
              <button type="button" className="underline" onClick={onRetry}>
                Tentar de novo
              </button>
            </p>
          )}
          {status === "ready" && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="sr-only" htmlFor={`busca-${uf}`}>
                  Buscar município em {uf}
                </label>
                <input id={`busca-${uf}`} type="search" placeholder="Buscar município" value={busca} onChange={(e) => setBusca(e.target.value)}
                  className={`${sel} min-w-0 flex-1`} />
                <button type="button" className={linkBtn}
                  onClick={() => setEscolhidos([...new Set([...escolhidos, ...filtrados.map((m) => m.ibge_code)])])}>
                  {busca ? "Marcar os encontrados" : "Marcar todos"}
                </button>
                <button type="button" className={linkBtn} onClick={() => setEscolhidos([])}>
                  Limpar
                </button>
              </div>
              <p className="text-xs text-neutral-500" aria-live="polite">
                {escolhidos.length} de {items.length} municípios marcados
              </p>
              <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded border border-neutral-200 p-2 sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-800">
                {filtrados.map((m) => (
                  <label key={m.ibge_code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={marcados.has(m.ibge_code)}
                      onChange={(e) =>
                        setEscolhidos(e.target.checked ? [...escolhidos, m.ibge_code] : escolhidos.filter((id) => id !== m.ibge_code))
                      } />
                    {m.name}
                  </label>
                ))}
                {!filtrados.length && <p className="text-sm text-neutral-500">Nenhum município encontrado.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
