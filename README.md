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

- Telas ainda não implementadas: produtos, contatos das empresas, publicação/versões de catálogos e extração de PDF, prospecção. O banco e as políticas desses módulos já existem e estão testados.
- MFA: administradores só têm privilégios com sessão AAL2 (TOTP). Ainda não há códigos de recuperação próprios; a recuperação é feita pelo suporte da plataforma (ADR 0004).
- Municípios do IBGE ainda não carregados (apenas as 27 UFs).
- Gmail, campanhas e agente de IA são Fases 2 e 3.
- Validação contra um projeto Supabase real depende da criação de staging (decisão do proprietário).
