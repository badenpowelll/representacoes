# ADR 0008 — Produtos sincronizados pelo site da indústria

**Status:** proposto (23/11/2026, pedido do proprietário: "usar o próprio site da indústria
para cadastrar os produtos ... caso saia algum e entre outro, faça isso de forma automática",
uma vez por dia, para avisar o cliente o mais rápido possível)

## Contexto
As indústrias representadas publicam a linha no próprio site, em formatos diferentes:

| Site | Formato | robots.txt | O que dá para ler |
|---|---|---|---|
| nutriex.com.br/produtos.php | lista montada por JavaScript (plataforma Madnezz), ~135 itens | `Allow: /` | lista + página de cada produto (descrição, FT) |
| nutriexprofissional.com.br/produtos.php | igual, 47 itens | `Disallow: /*?` | só a lista; páginas de produto proibidas → fica o link |
| belfar.com.br/categoria-produto/… | WooCommerce, paginado (12 por página) | permite | lista + produto (SKU, apresentação, princípio ativo, indicações, registro M.S.) |
| proc9.com.br/catalogo-proc9 | PDF liberado após formulário de cadastro | permite | nada automático (não preenchemos formulário em nome do usuário) |
| petribu.com.br/alcoolsaneantes | texto corrido, sem página por produto (Wix) | permite | não separável com segurança; cadastro manual |

Nenhum desses sites publica preço. A regra do Rep360 (P1-5, ADR de preços) continua: preço
só com origem, documento e vigência.

## Decisão
- **Fonte de produtos** (`product_sources`): URL da página de produtos por indústria (uma
  indústria pode ter várias: linhas, categorias). Escrita por administrador/gerente; leitura
  por todos do tenant; RLS por `tenant_id`.
- **Robô** `scripts/sincronizar-produtos.mjs`, no GitHub Actions
  (`sincronizar-produtos.yml`, diário às 06h de Brasília, e manual). Usa navegador sem janela
  (Playwright/Chromium) porque parte dos sites monta a lista com JavaScript. Sem custo dentro
  da cota gratuita de Actions (estimativa 3 a 10 min/dia).
- **robots.txt** é obedecido para cada URL aberta (listagem, paginação e produto). Sem
  resposta do robots.txt → não abre o site naquela execução. Uma página por segundo.
- **Extração genérica** (`scripts/lib/product-extract.mjs`): JSON-LD schema.org quando
  existir; senão, os links repetidos que envolvem uma foto (cards de produto), agrupados pelo
  formato da URL. Paginação por `rel=next`/`a.next`. Página do produto: descrição, SKU e
  documentos (FT, FDS, laudos, PDFs). Padrão de link manual opcional por fonte.
- **Sincronização atômica** em `app.sync_product_source()` (SECURITY DEFINER, sem permissão
  para o app): novo entra **sem preço** e com SKU do site ou provisório `SITE-…`; o que sumiu
  vira inativo com motivo `removed_from_source`; o que voltou é reativado; desativado à mão
  (`manual`) não é reativado. **Trava**: coleta vazia ou com menos da metade dos ativos não
  altera nada. Cada coleta vai para `product_sync_runs` e `audit_logs`.
- Colunas de origem (`source_*`, `image_url`, fichas) só são gravadas pelo robô: trigger
  ignora o que o usuário enviar.
- Tela Produtos: sites cadastrados com situação da última coleta, "Novidades nos sites
  (últimos 7 dias)" (entraram/saíram, para avisar clientes), e em cada produto foto, link
  "Ver no site da indústria" e fichas.

## Consequências
- Conteúdo de sites é dado não confiável: só links http(s) viram `href`; textos são
  exibidos como texto; nada do site é tratado como instrução.
- O agendamento só roda a partir da `main` e precisa do segredo `REP360_DATABASE_URL`
  (o mesmo do importador da Receita).
- Mudança de layout de um site pode zerar a extração: a trava impede desativação em massa e
  a tela mostra "Coleta falhou".
- Pendências: modo "vigiar página" (avisar quando uma página sem lista muda, ex. Petribu);
  leitura de produtos de catálogos em PDF (ex. PROC9); compartilhar produtos com o cliente
  e receber pedidos.
