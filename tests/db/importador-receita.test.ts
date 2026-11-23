import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestDatabase } from "./harness";

// Arquivos sintéticos no formato da Receita (latin1, ";" e aspas), CNPJs fictícios.
const ROOT = join(__dirname, "..", "..");
let pool: Pool;
let drop: () => Promise<void>;
let dir: string;
let dbUrl: string;

const q = (fields: string[]) => fields.map((f) => `"${f.replace(/"/g, '""')}"`).join(";");
const est = (base: string, uf: string, mun: string, cnae: string, status = "02", email = "") => {
  const f = Array.from({ length: 30 }, () => "");
  Object.assign(f, { 0: base, 1: "0001", 2: "01", 3: "1", 5: status, 10: "20200101", 11: cnae, 19: uf, 20: mun, 21: "84", 22: "32000000", 27: email });
  return q(f);
};
function zipFile(name: string, lines: string[]) {
  const csv = join(dir, name.replace(".zip", ".CSV"));
  writeFileSync(csv, Buffer.from(lines.join("\n") + "\n", "latin1"));
  execFileSync("zip", ["-jq", join(dir, name), csv]);
  rmSync(csv);
}
const runImport = (extra: string[] = []) =>
  execFileSync(process.execPath, [join(ROOT, "scripts", "importar-receita-cnpj.mjs"), "--dir", dir, "--mes", "2026-10", "--arquivos", "0", ...extra], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });

beforeAll(async () => {
  ({ pool, drop } = await createTestDatabase());
  dbUrl = (pool as unknown as { options: { connectionString: string } }).options.connectionString;
  dir = mkdtempSync(join(tmpdir(), "receita-fixture-"));
  zipFile("Cnaes.zip", [q(["8610101", "Atividades de atendimento hospitalar (oficial)"]), q(["1091102", "Padaria"])]);
  zipFile("Municipios.zip", [q(["1761", "NATAL"]), q(["9999", "SAO JOSE DE MIPIBU"]), q(["1389", "FORTALEZA"])]);
  zipFile("Estabelecimentos0.zip", [
    est("90000001", "RN", "1761", "8610101", "02", "contato@h1.test"),
    est("90000002", "RN", "9999", "8610101"),
    est("90000003", "RN", "1761", "8610101", "08"), // baixada
    est("90000004", "CE", "1389", "8610101"), // fora da UF
    est("90000005", "RN", "1761", "1091102"), // fora do CNAE
  ]);
  zipFile("Empresas0.zip", [
    q(["90000001", "HOSPITAL UM LTDA", "2062", "49", "1000,00", "03", ""]),
    q(["90000002", "CLÍNICA DOIS LTDA", "2062", "49", "1000,00", "01", ""]),
    q(["90000005", "PADARIA LTDA", "2062", "49", "1000,00", "01", ""]),
  ]);
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await drop?.();
});

describe("importar-receita-cnpj", () => {
  it("grava só ativos no recorte, com razão social, município IBGE e descrição do CNAE", async () => {
    runImport(["--ufs", "RN", "--cnaes", "8610101"]);
    const { rows } = await pool.query(
      "select cnpj, legal_name, municipality_id, municipality_name, phones, email, company_size, dataset_ref from ref.cnpj_establishments order by cnpj",
    );
    expect(rows).toEqual([
      { cnpj: "90000001000101", legal_name: "HOSPITAL UM LTDA", municipality_id: 2408102, municipality_name: "NATAL", phones: ["8432000000"], email: "contato@h1.test", company_size: "03", dataset_ref: "2026-10" },
      { cnpj: "90000002000101", legal_name: "CLÍNICA DOIS LTDA", municipality_id: 2412203, municipality_name: "SAO JOSE DE MIPIBU", phones: ["8432000000"], email: null, company_size: "01", dataset_ref: "2026-10" },
    ]);
    const cnae = await pool.query("select description from ref.cnaes where code = '8610101'");
    expect(cnae.rows[0].description).toBe("Atividades de atendimento hospitalar (oficial)");
    const imp = await pool.query("select status, rows_upserted, rows_removed from ref.cnpj_imports");
    expect(imp.rows).toEqual([{ status: "done", rows_upserted: 2, rows_removed: 0 }]);
  });

  it("nova carga remove do recorte quem deixou de estar ativo", async () => {
    zipFile("Estabelecimentos0.zip", [est("90000001", "RN", "1761", "8610101", "02", "contato@h1.test")]);
    runImport(["--ufs", "RN", "--cnaes", "8610101"]);
    const { rows } = await pool.query("select cnpj from ref.cnpj_establishments");
    expect(rows).toEqual([{ cnpj: "90000001000101" }]);
  });

  it("sem --ufs/--cnaes usa territórios e CNAEs-alvo cadastrados; sem nenhum, não faz nada", async () => {
    expect(runImport()).toMatch(/Nada a importar/);
  });
});
