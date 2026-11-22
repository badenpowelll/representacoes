# ADR 0003 — Testes de banco em Postgres puro com stub do Supabase

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto
`supabase start` exige Docker e baixa vários serviços; é lento no CI. As políticas RLS dependem apenas de Postgres, dos papéis `anon`/`authenticated` e de `auth.uid()`.

## Decisão
Testes de banco rodam em PostgreSQL 16 comum. `supabase/tests/supabase_stub.sql` cria os papéis e `auth.uid()` com a mesma semântica do Supabase (lê `request.jwt.claims`). Cada suíte cria um banco descartável e aplica todas as migrations do zero. As consultas rodam com `set local role authenticated|anon` e claims simuladas — nunca como `postgres`/`service_role`.

## Consequências
- CI rápido e sem custo; migrations são reproduzíveis do zero a cada execução.
- O stub não cobre Storage nem Auth real: políticas de Storage e fluxos de Auth precisarão de validação no Supabase local (Docker) ou em staging.
