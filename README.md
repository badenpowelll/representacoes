# Rep360

SaaS B2B multi-tenant de inteligência comercial para empresas de representação: catálogos, prospecção, CRM, funil de vendas e (futuramente) campanhas por Gmail com agente de IA. A especificação completa está em [`CLAUDE.md`](CLAUDE.md).

> **Status:** Fase 0 concluída e Fase 1 em andamento (banco completo da Fase 1; telas de autenticação, onboarding, equipe/convites, contexto, indústrias, territórios, catálogos, empresas, compatibilidade, funil e painel). Não há ambiente de staging ou produção. Nenhum envio real de e-mail.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript estrito
- Supabase: Postgres, Auth e Storage, com isolamento por **Row Level Security**
- Vitest (testes unitários e de banco), ESLint, GitHub Actions
- pnpm 10, Node 22

Decisões registradas em [`docs/adr/`](docs/adr). Visão geral em [`docs/architecture.md`](docs/architecture.md). Pendências em [`docs/backlog.md`](docs/backlog.md).

## Rodando localmente

```bash
pnpm install
cp .env.example .env.local   # preencha as variáveis
pnpm dev                     # http://localhost:3000
```

Para um Supabase local completo (Auth, Storage, Studio) use a [Supabase CLI](https://supabase.com/docs/guides/local-development) com Docker:

```bash
npx supabase start      # sobe a stack local e mostra URL e chave anon
npx supabase db reset   # aplica supabase/migrations e supabase/seed.sql
```

## Verificação

```bash
pnpm lint
pnpm typecheck
pnpm test        # unitários + banco (+ integração, se configurada)
pnpm build
pnpm test:e2e    # Playwright; requer `npx supabase start` e .env.local apontando para ele
```

Testes de integração (`tests/integration`) rodam contra a stack Supabase **local** quando `SUPABASE_TEST_URL` (só `localhost`/`127.0.0.1`), `SUPABASE_TEST_ANON_KEY` e `SUPABASE_TEST_SERVICE_ROLE_KEY` estão definidas (valores impressos por `npx supabase status`); caso contrário são pulados. O e2e lê o e-mail de confirmação no Mailpit local (`http://127.0.0.1:54324`).

No GitHub, o workflow **E2E (manual)** (`.github/workflows/e2e.yml`) sobe a mesma stack local no runner e roda integração + e2e. Ele só executa quando disparado manualmente em Actions → Run workflow, pois consome minutos do Actions; o CI de cada PR continua rodando lint, typecheck, testes de banco e build.

Os testes de banco (`tests/db`) precisam apenas de um PostgreSQL 16 acessível em `TEST_DATABASE_ADMIN_URL` (padrão `postgres://postgres:postgres@localhost:5432/postgres`). Cada arquivo cria um banco descartável, aplica `supabase/tests/supabase_stub.sql` (papéis `anon`/`authenticated`/`service_role` e `auth.uid()`) e todas as migrations, e executa as consultas com o papel `authenticated` e claims de JWT simuladas, como o PostgREST faz. Veja a [ADR 0003](docs/adr/0003-testes-de-banco.md).

## Estrutura

```
src/app/            páginas (Next.js App Router)
src/lib/            env, clientes Supabase, autorização
supabase/migrations migrations SQL (fonte da verdade do schema e das políticas RLS)
supabase/seed.sql   dados sintéticos (dois tenants fictícios)
supabase/tests/     stub do Supabase para testes em Postgres puro
tests/db/           testes de isolamento e regras de banco
docs/               arquitetura, ADRs e backlog
```

## Segurança

- Segredos nunca vão para o Git; use `.env.local` (ignorado). `.env.example` não contém valores reais.
- `SUPABASE_SERVICE_ROLE_KEY` só no servidor.
- Toda tabela de `public` tem RLS; um teste falha se alguma tabela nova vier sem RLS.

## Limitações atuais

- Telas ainda não implementadas: publicação/versões de catálogos e extração de PDF. O banco e as políticas desses módulos já existem e estão testados.
- MFA: administradores só têm privilégios com sessão AAL2 (TOTP). Ainda não há códigos de recuperação próprios; a recuperação é feita pelo suporte da plataforma (ADR 0004). A exigência pode ser desligada por ambiente em `app.platform_settings`, mas só no ambiente de teste (ADR 0005).
- Links de download de catálogos são URLs assinadas de 5 minutos: um link já emitido continua válido até expirar, mesmo que o acesso do usuário seja revogado nesse intervalo.
- Upload de catálogo passa pela server action (arquivo em memória, até 50 MB). Antes de produção: upload resumível direto, quarentena e parser de PDF isolado (backlog).
- Municípios: snapshot de 5.571 municípios com códigos IBGE (ver `supabase/reference/README.md`); ainda não conferido contra a API oficial do IBGE, sem acesso de rede neste ambiente.
- Consulta de CNPJ: usa a BrasilAPI (gratuita) a partir do servidor; não foi chamada de verdade neste ambiente (rede bloqueada), só com servidor simulado no e2e (`CNPJ_API_BASE_URL`). Sem limite de consultas por representação ainda (ADR 0006).
- Importação de planilhas (ADR 0009): `.xlsx`/`.csv` até 10 MB e 5.000 linhas, lida no navegador e enviada em lotes de 25; `.xls` antigo não é lido. Com a consulta à Receita ligada, cada CNPJ novo custa uma chamada à BrasilAPI (limite da API gratuita), então planilhas grandes levam minutos com a página aberta.
- Gmail, campanhas e agente de IA são Fases 2 e 3.
- Validação contra um projeto Supabase real depende da criação de staging (decisão do proprietário).
