# ADR 0009 — Importar planilhas de clientes e de produtos/preços

**Status:** aceito (23/11/2026, pedido do proprietário: "importar planilha de clientes e preencher de forma automática; ainda não tenho o modelo, vamos adequar quando as indústrias entregarem; da mesma forma o catálogo com valores")

## Contexto
As indústrias mandam listas de clientes e tabelas de preço em planilhas, cada uma num
formato. Ainda não há um modelo fixo. Cadastrar linha a linha é inviável.

## Decisão
- **Importador flexível**, não um formato fixo: o usuário envia `.xlsx` ou `.csv`
  (separador `;`, `,` ou tab; UTF-8 ou Windows-1252), escolhe a aba e a linha do
  cabeçalho (detectada sozinha, pois tabelas de preço costumam ter título antes) e
  associa cada coluna a um campo. O sistema sugere o mapeamento pelo nome da coluna
  (`src/lib/importacao/fields.ts`); quando chegar o modelo de uma indústria basta
  acrescentar os nomes de coluna dela aos apelidos.
- **Modelo padrão para download** (.xlsx com aba de instruções e .csv), gerado no
  navegador. Os cabeçalhos do modelo são reconhecidos automaticamente (teste unitário).
- O arquivo é **lido no navegador** (`read-excel-file`, sem macros nem fórmulas
  executadas); só os valores das colunas mapeadas vão ao servidor, em lotes de 25 linhas
  (sem estourar o tempo de função da Vercel). Limites: 10 MB e 5.000 linhas.
- **Prévia** antes de gravar: a mesma normalização pura (`normalize.ts`) roda no
  navegador e no servidor. O servidor revalida tudo; o conteúdo da planilha é dado não
  confiável. A prévia marca novo/já cadastrado (consulta ao banco), erros e avisos, e
  linhas repetidas na própria planilha.
- **Clientes**: chave CNPJ (sem CNPJ, a mesma razão social). Já cadastrada: por padrão
  **só completa campos vazios**, nunca sobrescreve; prospect vira cliente se a planilha
  disser "cliente". Com CNPJ, completa pela Receita (BrasilAPI, reaproveitando a consulta
  salva de 30 dias, 4 consultas por vez). O que veio da planilha prevalece sobre a Receita.
  Telefones e e-mail da Receita entram como canais com origem "receita".
- **LGPD (clientes)**: origem, data da fonte, base legal (legítimo interesse com
  justificativa ou execução de contrato) e finalidades são escolhidas **para o lote** e
  gravadas nas empresas e nos contatos (pessoas). Consentimento não é aceito por
  importação (exige evidência individual). Contatos não se duplicam por e-mail nem por
  nome na mesma empresa.
- **Produtos e preços**: chave (indústria, SKU). Já cadastrado: atualiza nome, categoria,
  descrição, informações extras e preço (ou "não mexer"). Todo preço importado leva
  **origem e referência do documento** do lote e vigência (da linha ou padrão do lote);
  quem autorizou e quando continuam gravados pelo banco, e a mudança entra em
  `product_price_history`. Preço com mais de 2 casas decimais é recusado (nunca arredonda);
  preço sem vigência entra com aviso e fica fora dos envios (`product_eligibility`).
  Colunas sem campo podem ir para `metadata` (ex.: IPI, caixa, EAN, unidade).
- **Rastreio**: `public.data_imports` guarda o lote (arquivo, sha256, opções, contadores,
  relatório de erros só com linha/coluna/motivo, sem conteúdo de células). RLS por
  tenant; clientes: papéis do CRM; produtos: admin/gerente. Sem exclusão; dados do lote
  imutáveis; contadores só crescem; conclusão vai para `audit_logs`. Empresas, contatos e
  produtos guardam `import_id`.

## Consequências
- Reimportar a mesma planilha é seguro (nada duplica), o que também serve para retomar
  uma importação interrompida.
- A consulta à Receita deixa planilhas grandes lentas (limite da API gratuita); a página
  mostra progresso e deve ficar aberta.
- `.xls` antigo não é lido: o usuário salva como `.xlsx`/`.csv`.
- Pendente: desfazer uma importação (usar `import_id`), modelos salvos por indústria
  (mapeamento lembrado) e importação em segundo plano (fila) para planilhas muito grandes.
