import { FIELDS, type ImportKind } from "./fields";

/** Modelo padrão: cabeçalhos reconhecidos automaticamente e uma linha de exemplo. */
export function templateRows(kind: ImportKind): string[][] {
  const fields = FIELDS[kind];
  return [fields.map((f) => f.template), fields.map((f) => f.example ?? "")];
}

export const TEMPLATE_NAMES: Record<ImportKind, string> = {
  companies: "modelo-clientes-rep360",
  products: "modelo-tabela-de-precos-rep360",
};

export function templateInstructions(kind: ImportKind): string[] {
  const common = [
    "Apague a linha de exemplo antes de importar.",
    "A primeira linha precisa ter os nomes das colunas. A ordem das colunas não importa e colunas extras podem ficar.",
    "Se a planilha da indústria tiver outros nomes de coluna, não precisa usar este modelo: na importação você escolhe qual coluna é cada campo.",
  ];
  if (kind === "companies") {
    return [
      ...common,
      "Cada linha precisa de CNPJ ou razão social. Com o CNPJ, o Rep360 completa razão social, nome fantasia, CNAE, UF, município, telefones e e-mail pela Receita Federal.",
      'Tipo: "cliente" ou "prospect". Em branco vale o tipo escolhido na importação.',
      "Empresas já cadastradas (mesmo CNPJ) não são duplicadas: o Rep360 só completa o que estiver vazio.",
      "Contato (pessoa): nome, cargo, e-mail e telefone. A base legal e a finalidade (LGPD) são escolhidas na importação e valem para todas as linhas.",
    ];
  }
  return [
    ...common,
    "Cada linha precisa de SKU (código) e nome do produto. Produtos já cadastrados (mesmo SKU na mesma indústria) são atualizados, não duplicados.",
    "Preço: só o preço autorizado pela indústria, com até 2 casas decimais (ex.: 29,90). A origem e o documento do preço são informados na importação.",
    "Vigência: data até quando o preço vale (dd/mm/aaaa). Sem vigência, o preço fica cadastrado mas não é usado em envios.",
  ];
}
