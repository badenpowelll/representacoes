# Sincronizar produtos pelo site da indústria

Ver ADR 0008.

## Como usar
1. Em **Produtos > Sites das indústrias**, escolha a indústria e cole a página de produtos
   do site oficial (ex.: `https://www.nutriex.com.br/produtos.php`). Pode cadastrar várias
   por indústria (ex.: as categorias da Belfar).
2. O robô roda todo dia às 06h (Brasília). Para rodar na hora: GitHub → Actions →
   "Sincronizar produtos (site das indústrias)" → Run workflow (opcional: ID de uma fonte).
3. A tela mostra a última coleta de cada site e as novidades dos últimos 7 dias.

## Testar a extração de um site sem banco
```
pnpm exec playwright install chromium   # só na primeira vez
node scripts/sincronizar-produtos.mjs --url https://www.nutriex.com.br/produtos.php
```
Mostra o JSON extraído (detalhes só dos 5 primeiros produtos).

## Configuração
- Segredo do repositório `REP360_DATABASE_URL`: conexão Postgres do Supabase de **teste**
  (papel `postgres`). O mesmo do importador da Receita.
- Agendamentos do GitHub só rodam a partir da branch padrão (`main`).

## Limites
- O robô obedece o robots.txt. Se a página do produto é proibida (ex.: Nutriex Profissional),
  fica só o link para o cliente abrir.
- Sites sem lista de produtos (PDF atrás de formulário, texto corrido) não são lidos.
- Preço nunca vem do site.
