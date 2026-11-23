"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { CONTACT_PURPOSE_LABELS, CONTACT_PURPOSES, type ContactPurpose } from "@/lib/validation/schemas";
import { decodeText, parseCsv, toCsv } from "@/lib/importacao/csv";
import { EXTRA, FIELDS, IGNORE, REQUIRED_HINT, suggestMapping, type ImportKind } from "@/lib/importacao/fields";
import { hasError, normalizeCompanyRow, normalizeProductRow, type Issue, type RawRow } from "@/lib/importacao/normalize";
import { BATCH_SIZE, MAX_FILE_BYTES, MAX_ROWS } from "@/lib/importacao/options";
import { applyMapping, dataRows, detectHeaderRow, headersOf, toCell, type SheetGrid } from "@/lib/importacao/sheet";
import { TEMPLATE_NAMES, templateInstructions, templateRows } from "@/lib/importacao/templates";
import { checkExisting, finishImport, importBatch, startImport, type RowResult } from "./actions";

const sel = "rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";
const input = sel;
const todayBr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

type Props = {
  tenantId: string;
  kind: ImportKind;
  backHref: string;
  industries?: { id: string; name: string }[];
  versions?: { id: string; label: string; industryId: string }[];
};

type Loaded = { fileName: string; sha256: string | null; sheets: SheetGrid[] };
type Step = "file" | "map" | "review" | "running" | "done";
type ReviewRow = { raw: RawRow; issues: Issue[]; key: string | null; label: string; existing: boolean };

async function sha256(buf: ArrayBuffer): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function readFile(file: File): Promise<Loaded> {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  if (/\.(csv|txt)$/i.test(file.name)) {
    const rows = parseCsv(decodeText(new Uint8Array(buf))).map((r) => r.map(toCell));
    return { fileName: file.name, sha256: hash, sheets: [{ name: "CSV", rows }] };
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return {
    fileName: file.name,
    sha256: hash,
    sheets: sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(toCell)) })).filter((s) => s.rows.length > 0),
  };
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TemplateButtons({ kind }: { kind: ImportKind }) {
  const [busy, setBusy] = useState(false);
  async function xlsx() {
    setBusy(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const rows = templateRows(kind);
      const header = rows[0].map((v) => ({ value: v, fontWeight: "bold" as const, backgroundColor: "#E8EEF7" }));
      const example = rows[1].map((v) => ({ value: v, type: String }));
      const blob = await writeXlsxFile(
        [
          { data: [header, example], sheet: kind === "companies" ? "Clientes" : "Produtos", columns: rows[0].map(() => ({ width: 22 })), stickyRowsCount: 1 },
          { data: [[{ value: "Como preencher", fontWeight: "bold" as const }], ...templateInstructions(kind).map((t) => [{ value: t }])], sheet: "Instruções", columns: [{ width: 120 }] },
        ],
      ).toBlob();
      download(`${TEMPLATE_NAMES[kind]}.xlsx`, blob);
    } finally {
      setBusy(false);
    }
  }
  function csv() {
    download(`${TEMPLATE_NAMES[kind]}.csv`, new Blob([toCsv(templateRows(kind))], { type: "text/csv;charset=utf-8" }));
  }
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <button type="button" onClick={xlsx} disabled={busy} className="rounded-md border px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">
        Baixar modelo (.xlsx)
      </button>
      <button type="button" onClick={csv} className="rounded-md border px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">
        Baixar modelo (.csv)
      </button>
    </div>
  );
}

export function Importer({ tenantId, kind, backHref, industries = [], versions = [] }: Props) {
  const fields = FIELDS[kind];
  const [step, setStep] = useState<Step>("file");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Opções do lote
  const [source, setSource] = useState("");
  const [sourceDate, setSourceDate] = useState(todayBr());
  const [defaultKind, setDefaultKind] = useState<"customer" | "prospect">("customer");
  const [legalBasis, setLegalBasis] = useState<"legitimate_interest" | "contract">("legitimate_interest");
  const [legalNote, setLegalNote] = useState(
    "Relacionamento comercial B2B com empresas clientes e potenciais clientes das indústrias representadas.",
  );
  const [purposes, setPurposes] = useState<ContactPurpose[]>(["customer_relationship", "catalog_distribution"]);
  const [enrich, setEnrich] = useState(true);
  const [existingMode, setExistingMode] = useState<"fill" | "skip" | "update">(kind === "companies" ? "fill" : "update");
  const [industryId, setIndustryId] = useState(industries.length === 1 ? industries[0].id : "");
  const [versionId, setVersionId] = useState("");
  const [priceReference, setPriceReference] = useState("");
  const [defaultValidUntil, setDefaultValidUntil] = useState("");

  const [review, setReview] = useState<ReviewRow[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<RowResult[]>([]);
  const [aborted, setAborted] = useState<string | null>(null);

  const sheet = loaded?.sheets[sheetIdx] ?? null;
  const headers = useMemo(() => (sheet ? headersOf(sheet.rows, headerRow) : []), [sheet, headerRow]);
  const rows = useMemo(() => (sheet ? dataRows(sheet.rows, headerRow) : []), [sheet, headerRow]);
  const labelOf = (key: string) => {
    if (key === "row") return "Linha";
    const i = mapping.indexOf(key);
    return i >= 0 ? headers[i] : (fields.find((f) => f.key === key)?.label ?? key);
  };

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError("Arquivo maior que 10 MB. Divida a planilha em partes.");
    if (!/\.(xlsx|csv|txt)$/i.test(file.name)) {
      return setError(/\.xls$/i.test(file.name) ? "Formato .xls antigo: abra no Excel e salve como .xlsx ou .csv." : "Envie uma planilha .xlsx ou .csv.");
    }
    setBusy(true);
    try {
      const l = await readFile(file);
      if (l.sheets.length === 0) return setError("A planilha está vazia.");
      setLoaded(l);
      selectSheet(l, 0);
      setSource(kind === "companies" ? `Planilha de clientes "${l.fileName}"` : "Tabela de preços enviada pela indústria");
      setPriceReference(l.fileName.replace(/\.(xlsx|csv|txt)$/i, "").slice(0, 300));
      setStep("map");
    } catch {
      setError("Não foi possível ler o arquivo. Confira se é uma planilha .xlsx ou .csv válida.");
    } finally {
      setBusy(false);
    }
  }

  function selectSheet(l: Loaded, idx: number) {
    setSheetIdx(idx);
    const h = detectHeaderRow(l.sheets[idx].rows);
    setHeaderRow(h);
    setMapping(suggestMapping(kind, headersOf(l.sheets[idx].rows, h)));
  }

  function changeHeaderRow(n: number) {
    if (!sheet) return;
    const h = Math.max(0, Math.min(n, sheet.rows.length - 1));
    setHeaderRow(h);
    setMapping(suggestMapping(kind, headersOf(sheet.rows, h)));
  }

  function setField(col: number, value: string) {
    setMapping((m) => m.map((v, i) => (i === col ? value : v === value && value !== IGNORE && value !== EXTRA ? IGNORE : v)));
  }

  const mapped = new Set(mapping);
  const mappingProblem =
    kind === "companies"
      ? !mapped.has("cnpj") && !mapped.has("legal_name")
        ? "Associe a coluna de CNPJ ou a de razão social."
        : null
      : !mapped.has("sku") || !mapped.has("name")
        ? "Associe as colunas de código (SKU) e de nome do produto."
        : null;
  const hasContacts = ["contact_name", "contact_email", "contact_phone"].some((k) => mapped.has(k));

  function optionsPayload() {
    const base = { file_name: loaded!.fileName, file_sha256: loaded!.sha256, total_rows: rows.length };
    return kind === "companies"
      ? { ...base, source, source_date: sourceDate, default_kind: defaultKind, legal_basis: legalBasis, legal_basis_note: legalNote, purposes, enrich, existing: existingMode }
      : { ...base, industry_id: industryId, catalog_version_id: versionId || null, source, price_reference: priceReference, default_valid_until: defaultValidUntil || null, existing: existingMode };
  }

  async function toReview() {
    setError(null);
    setFieldErrors({});
    if (rows.length === 0) return setError("Nenhuma linha de dados abaixo do cabeçalho.");
    if (rows.length > MAX_ROWS) return setError(`A planilha tem ${rows.length} linhas; o limite é ${MAX_ROWS} por importação. Divida o arquivo.`);
    if (kind === "products" && !industryId) return setFieldErrors({ industry_id: "Selecione a indústria" });
    setBusy(true);
    try {
      const raws = applyMapping(rows, headers, mapping);
      const firstSeen = new Map<string, number>();
      const today = todayBr();
      const out: ReviewRow[] = raws.map((raw) => {
        if (kind === "companies") {
          const { data, issues } = normalizeCompanyRow(raw, { enrich });
          const key = data.cnpj ?? (data.legal_name ? data.legal_name : null);
          return { raw, issues, key, label: data.legal_name ?? data.cnpj ?? "—", existing: false };
        }
        const { data, issues } = normalizeProductRow(raw, { defaultValidUntil: defaultValidUntil || null, today });
        const name = typeof raw.values.name === "string" ? raw.values.name : "—";
        return { raw, issues, key: data?.sku ?? null, label: data ? `${data.sku} · ${data.name}` : name, existing: false };
      });
      for (const r of out) {
        if (!r.key || hasError(r.issues)) continue;
        const prev = firstSeen.get(r.key);
        if (prev != null) {
          r.issues = [...r.issues, { field: kind === "companies" ? (/^\d{14}$/.test(r.key) ? "cnpj" : "legal_name") : "sku", message: `Repetido na planilha (linha ${prev})`, level: "error" }];
        } else firstSeen.set(r.key, r.raw.row);
      }
      const keys = [...firstSeen.keys()];
      const res = await checkExisting(tenantId, kind, keys, kind === "products" ? industryId : undefined);
      if (!res.ok) return setError(res.message);
      const ex = new Set(res.existing);
      for (const r of out) r.existing = r.key != null && ex.has(r.key) && !hasError(r.issues);
      setReview(out);
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setError(null);
    setFieldErrors({});
    setBusy(true);
    const start = await startImport(tenantId, kind, optionsPayload());
    if (!start.ok) {
      setBusy(false);
      setFieldErrors(start.fieldErrors ?? {});
      setError(start.message);
      return;
    }
    const toSend = review.filter((r) => !r.issues.some((i) => i.level === "error" && i.message.startsWith("Repetido na planilha")));
    const skipped = review
      .filter((r) => !toSend.includes(r))
      .flatMap((r) => r.issues.filter((i) => i.level === "error").map((i) => ({ row: r.raw.row, column: labelOf(i.field), message: i.message })));
    setStep("running");
    setProgress({ done: 0, total: toSend.length });
    const acc: RowResult[] = review
      .filter((r) => !toSend.includes(r))
      .map((r) => ({ row: r.raw.row, status: "error" as const, issues: r.issues }));
    let failed: string | null = null;
    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const batch = toSend.slice(i, i + BATCH_SIZE).map((r) => r.raw);
      let res = await importBatch(tenantId, start.importId, batch).catch(() => null);
      if (!res) res = await importBatch(tenantId, start.importId, batch).catch(() => null);
      if (!res || !res.ok) {
        failed = res && !res.ok ? res.message : "Falha de comunicação com o servidor.";
        break;
      }
      acc.push(...res.results);
      setResults([...acc]);
      setProgress({ done: Math.min(i + BATCH_SIZE, toSend.length), total: toSend.length });
    }
    await finishImport(tenantId, start.importId, { failed: failed != null, skipped }).catch(() => null);
    acc.sort((a, b) => a.row - b.row);
    setResults(acc);
    setAborted(failed);
    setStep("done");
    setBusy(false);
  }

  function downloadReport() {
    const byRow = new Map(review.map((r) => [r.raw.row, r.label]));
    const status = { created: "Incluído", updated: "Atualizado", unchanged: "Sem alteração", error: "Não importado" } as const;
    const lines: (string | number)[][] = [["Linha", "Registro", "Situação", "Coluna", "Observação"]];
    for (const r of results) {
      const issues = r.issues.length ? r.issues : [null];
      for (const i of issues) {
        lines.push([r.row, byRow.get(r.row) ?? "", status[r.status], i ? labelOf(i.field) : "", i ? i.message : r.contact === "created" ? "Contato incluído" : ""]);
      }
    }
    download(`relatorio-importacao-${todayBr()}.csv`, new Blob([toCsv(lines)], { type: "text/csv;charset=utf-8" }));
  }

  // ------------------------------------------------------------------- telas
  if (step === "file") {
    return (
      <div className="flex flex-col gap-4">
        {error && <Alert kind="error">{error}</Alert>}
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <span className="font-medium">{busy ? "Lendo a planilha…" : "Escolha a planilha (.xlsx ou .csv)"}</span>
          <span className="text-sm text-neutral-500">Até 10 MB e {MAX_ROWS.toLocaleString("pt-BR")} linhas. O arquivo é lido no seu navegador; só os dados das colunas escolhidas são enviados.</span>
          <input
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            aria-label="Planilha"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{REQUIRED_HINT[kind]} Ainda não tem a planilha da indústria? Use o modelo padrão:</p>
        <TemplateButtons kind={kind} />
      </div>
    );
  }

  if (step === "map" && loaded && sheet) {
    return (
      <div className="flex flex-col gap-6">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <p>
            Arquivo: <strong>{loaded.fileName}</strong> · {rows.length.toLocaleString("pt-BR")} linhas de dados
          </p>
          {loaded.sheets.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="font-medium">Aba</span>
              <select className={sel} value={sheetIdx} onChange={(e) => selectSheet(loaded, Number(e.target.value))}>
                {loaded.sheets.map((s, i) => (
                  <option key={s.name + i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="font-medium">Linha do cabeçalho</span>
            <input type="number" min={1} max={sheet.rows.length} className={`${input} w-24`} value={headerRow + 1} onChange={(e) => changeHeaderRow(Number(e.target.value) - 1)} />
          </label>
          <button type="button" className="underline" onClick={() => { setLoaded(null); setStep("file"); }}>
            Trocar arquivo
          </button>
        </div>

        <section aria-labelledby="mapeamento">
          <h2 id="mapeamento" className="mb-2 font-medium">1. Diga o que é cada coluna</h2>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
            Sugerimos pelo nome da coluna; confira e ajuste. {REQUIRED_HINT[kind]}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">Coluna da planilha</th>
                  <th className="py-2 pr-4">Exemplos</th>
                  <th className="py-2">Campo no Rep360</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={i} className="border-b align-top">
                    <td className="py-2 pr-4 font-medium">{h}</td>
                    <td className="max-w-xs py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                      {rows.slice(0, 3).map((r, j) => (
                        <div key={j} className="truncate">{r.cells[i] == null || r.cells[i] === "" ? "—" : String(r.cells[i])}</div>
                      ))}
                    </td>
                    <td className="py-2">
                      <select aria-label={`Campo para a coluna ${h}`} className={sel} value={mapping[i] ?? IGNORE} onChange={(e) => setField(i, e.target.value)}>
                        <option value={IGNORE}>Ignorar esta coluna</option>
                        {kind === "products" && <option value={EXTRA}>Guardar como informação extra</option>}
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.group ? `${f.group}: ` : ""}{f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappingProblem && <p className="mt-2 text-sm text-red-600">{mappingProblem}</p>}
        </section>

        <section aria-labelledby="opcoes" className="flex flex-col gap-4">
          <h2 id="opcoes" className="font-medium">2. Opções da importação</h2>
          {kind === "companies" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput id="source" label="Origem dos dados (LGPD)" value={source} onChange={setSource} error={fieldErrors.source} hint="De onde veio a planilha. Fica registrada em cada empresa." />
              <TextInput id="source_date" label="Data em que os dados foram obtidos" type="date" value={sourceDate} onChange={setSourceDate} error={fieldErrors.source_date} />
              <SelectInput id="default_kind" label="Tipo quando a planilha não informar" value={defaultKind} onChange={(v) => setDefaultKind(v as "customer" | "prospect")} options={[["customer", "Cliente"], ["prospect", "Prospect"]]} />
              <SelectInput id="existing" label="Empresa que já existe (mesmo CNPJ)" value={existingMode} onChange={(v) => setExistingMode(v as "fill")} options={[["fill", "Completar só os campos vazios"], ["skip", "Não mexer"]]} />
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="mt-1" />
                <span>
                  <strong>Completar pela Receita Federal com o CNPJ</strong> (razão social, nome fantasia, CNAE, UF, município, telefones e e-mail). Consulta gratuita (BrasilAPI); planilhas grandes levam alguns minutos.
                </span>
              </label>
              <fieldset className="flex flex-col gap-3 rounded-md border p-3 sm:col-span-2">
                <legend className="px-1 text-sm font-medium">LGPD: base legal e finalidade {hasContacts ? "(vale para os contatos de pessoas da planilha)" : ""}</legend>
                <SelectInput id="legal_basis" label="Base legal" value={legalBasis} onChange={(v) => setLegalBasis(v as "contract")} options={[["legitimate_interest", "Legítimo interesse (B2B)"], ["contract", "Execução de contrato"]]} error={fieldErrors.legal_basis} />
                <TextInput id="legal_basis_note" label={legalBasis === "contract" ? "Qual contrato" : "Justificativa do legítimo interesse"} value={legalNote} onChange={setLegalNote} error={fieldErrors.legal_basis_note} />
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Finalidades</span>
                  {CONTACT_PURPOSES.map((p) => (
                    <label key={p} className="flex items-center gap-2">
                      <input type="checkbox" checked={purposes.includes(p)} onChange={(e) => setPurposes((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))} />
                      {CONTACT_PURPOSE_LABELS[p]}
                    </label>
                  ))}
                  {fieldErrors.purposes && <p className="text-red-600">{fieldErrors.purposes}</p>}
                </div>
                <p className="text-xs text-neutral-500">Consentimento não é aceito por importação: ele exige evidência individual e é registrado contato a contato.</p>
              </fieldset>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectInput id="industry_id" label="Indústria" value={industryId} onChange={(v) => { setIndustryId(v); setVersionId(""); }} options={[["", "Selecione"], ...industries.map((i) => [i.id, i.name] as [string, string])]} error={fieldErrors.industry_id} />
              <SelectInput id="catalog_version_id" label="Catálogo de origem (opcional)" value={versionId} onChange={setVersionId} options={[["", "Nenhum"], ...versions.filter((v) => v.industryId === industryId).map((v) => [v.id, v.label] as [string, string])]} error={fieldErrors.catalog_version_id} />
              <TextInput id="source" label="Origem do preço" value={source} onChange={setSource} error={fieldErrors.source} hint="Obrigatória: quem autorizou estes preços." />
              <TextInput id="price_reference" label="Referência do documento" value={priceReference} onChange={setPriceReference} error={fieldErrors.price_reference} hint="Ex.: Tabela nov/2026, e-mail de 05/11." />
              <TextInput id="default_valid_until" label="Vigência quando a linha não informar" type="date" value={defaultValidUntil} onChange={setDefaultValidUntil} error={fieldErrors.default_valid_until} hint="Sem vigência, o preço não é usado em envios." />
              <SelectInput id="existing" label="Produto que já existe (mesmo SKU)" value={existingMode} onChange={(v) => setExistingMode(v as "update")} options={[["update", "Atualizar nome, categoria e preço"], ["skip", "Não mexer"]]} />
            </div>
          )}
        </section>
        <div>
          <Button type="button" disabled={busy || mappingProblem != null} onClick={toReview}>
            {busy ? "Conferindo…" : "Conferir antes de importar"}
          </Button>
        </div>
      </div>
    );
  }

  if (step === "review") {
    const errors = review.filter((r) => hasError(r.issues));
    const ok = review.filter((r) => !hasError(r.issues));
    const isNew = ok.filter((r) => !r.existing).length;
    const warnings = ok.filter((r) => r.issues.length > 0).length;
    const shown = (onlyProblems ? review.filter((r) => r.issues.length > 0) : review).slice(0, 300);
    const sending = review.filter((r) => !r.issues.some((i) => i.message.startsWith("Repetido na planilha"))).length;
    return (
      <div className="flex flex-col gap-4">
        {error && <Alert kind="error">{error}</Alert>}
        <ul className="grid gap-2 text-sm sm:grid-cols-4">
          <Stat label="Prontas para importar" value={ok.length} />
          <Stat label="Novas" value={isNew} />
          <Stat label={kind === "companies" ? (existingMode === "fill" ? "Já cadastradas (completar)" : "Já cadastradas (manter)") : existingMode === "update" ? "Já cadastrados (atualizar)" : "Já cadastrados (manter)"} value={ok.length - isNew} />
          <Stat label="Com erro (não entram)" value={errors.length} tone={errors.length ? "error" : undefined} />
        </ul>
        {warnings > 0 && <p className="text-sm text-neutral-600 dark:text-neutral-400">{warnings} linha(s) entram com avisos (veja abaixo).</p>}
        {kind === "companies" && enrich && <p className="text-sm text-neutral-600 dark:text-neutral-400">A consulta à Receita acontece durante a importação; linhas sem razão social dependem dela.</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Mostrar só linhas com erro ou aviso
        </label>
        <ReviewTable rows={shown} labelOf={labelOf} />
        {review.length > 300 && <p className="text-xs text-neutral-500">Mostrando 300 de {review.length} linhas.</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={busy || ok.length === 0} onClick={run}>
            {busy ? "Iniciando…" : `Importar ${ok.length.toLocaleString("pt-BR")} linha(s)`}
          </Button>
          <button type="button" className="rounded-md border px-4 py-2" onClick={() => setStep("map")}>
            Voltar e ajustar
          </button>
        </div>
        <p className="text-xs text-neutral-500">{sending} linha(s) serão conferidas de novo no servidor antes de gravar. As com erro ficam no relatório.</p>
      </div>
    );
  }

  if (step === "running") {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="font-medium">Importando… {progress.done} de {progress.total} linhas</p>
        <div className="h-3 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-blue-700 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-neutral-500">Não feche esta página até terminar.</p>
      </div>
    );
  }

  // done
  const count = (s: RowResult["status"]) => results.filter((r) => r.status === s).length;
  const contacts = results.filter((r) => r.contact === "created").length;
  return (
    <div className="flex flex-col gap-4">
      {aborted ? (
        <Alert kind="error">A importação parou antes do fim: {aborted} O que já foi gravado está no relatório; importe de novo a mesma planilha para continuar (nada será duplicado).</Alert>
      ) : (
        <Alert kind="success">Importação concluída.</Alert>
      )}
      <ul className="grid gap-2 text-sm sm:grid-cols-5">
        <Stat label="Incluídos" value={count("created")} />
        <Stat label="Atualizados" value={count("updated")} />
        <Stat label="Sem alteração" value={count("unchanged")} />
        <Stat label="Não importados" value={count("error")} tone={count("error") ? "error" : undefined} />
        {kind === "companies" && <Stat label="Contatos incluídos" value={contacts} />}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={downloadReport}>Baixar relatório (.csv)</Button>
        <Link href={backHref} className="rounded-md border px-4 py-2">
          {kind === "companies" ? "Ver empresas" : "Ver produtos"}
        </Link>
        <button type="button" className="rounded-md border px-4 py-2" onClick={() => { setStep("file"); setLoaded(null); setResults([]); setReview([]); setAborted(null); }}>
          Importar outra planilha
        </button>
      </div>
      <ResultTable results={results.filter((r) => r.issues.length > 0).slice(0, 300)} labelOf={labelOf} labels={new Map(review.map((r) => [r.raw.row, r.label]))} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "error" }) {
  return (
    <li className={`rounded-md border p-3 ${tone === "error" ? "border-red-300 text-red-700 dark:text-red-300" : ""}`}>
      <div className="text-2xl font-semibold">{value.toLocaleString("pt-BR")}</div>
      <div>{label}</div>
    </li>
  );
}

function IssueList({ issues, labelOf }: { issues: Issue[]; labelOf: (k: string) => string }) {
  if (!issues.length) return <span className="text-neutral-500">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {issues.map((i, j) => (
        <li key={j} className={i.level === "error" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}>
          {i.field !== "row" && <strong>{labelOf(i.field)}: </strong>}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function ReviewTable({ rows, labelOf }: { rows: ReviewRow[]; labelOf: (k: string) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-4">Linha</th>
            <th className="py-2 pr-4">Registro</th>
            <th className="py-2 pr-4">Situação</th>
            <th className="py-2">Observações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.raw.row} className="border-b align-top">
              <td className="py-2 pr-4">{r.raw.row}</td>
              <td className="py-2 pr-4">{r.label}</td>
              <td className="py-2 pr-4">{hasError(r.issues) ? "Erro" : r.existing ? "Já cadastrado" : "Novo"}</td>
              <td className="py-2"><IssueList issues={r.issues} labelOf={labelOf} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultTable({ results, labelOf, labels }: { results: RowResult[]; labelOf: (k: string) => string; labels: Map<number, string> }) {
  if (!results.length) return null;
  const status = { created: "Incluído", updated: "Atualizado", unchanged: "Sem alteração", error: "Não importado" } as const;
  return (
    <div className="overflow-x-auto">
      <h2 className="mb-2 font-medium">Linhas com erro ou aviso</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-4">Linha</th>
            <th className="py-2 pr-4">Registro</th>
            <th className="py-2 pr-4">Situação</th>
            <th className="py-2">Observações</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.row} className="border-b align-top">
              <td className="py-2 pr-4">{r.row}</td>
              <td className="py-2 pr-4">{labels.get(r.row) ?? ""}</td>
              <td className="py-2 pr-4">{status[r.status]}</td>
              <td className="py-2"><IssueList issues={r.issues} labelOf={labelOf} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextInput({ id, label, value, onChange, error, hint, type = "text" }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; type?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} type={type} className={input} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} />
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function SelectInput({ id, label, value, onChange, options, error }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} className={sel} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
