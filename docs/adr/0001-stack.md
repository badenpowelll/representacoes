# ADR 0001 — Stack: Next.js + Supabase

- **Status:** aceita (revisada pelo ChatGPT na issue #1, parecer técnico 001)
- **Data:** 2026-11-22

## Contexto
O `CLAUDE.md` propõe TypeScript, React/Next.js, PostgreSQL/Supabase Auth e RLS, armazenamento privado e filas. O repositório estava vazio.

## Decisão
Next.js 15 (App Router) + React 19 + TypeScript estrito, Supabase (Postgres, Auth, Storage), Vitest, ESLint, pnpm com lockfile e versões fixadas. Filas na Fase 2 via tabela `outbox_jobs` no Postgres (padrão outbox), avaliando pg-boss/Supabase Queues quando houver staging.

## Consequências
- RLS do Postgres é a principal barreira de isolamento, testável em SQL.
- Dependência de um provedor gerenciado (Supabase); migrations SQL puras reduzem o lock-in.
