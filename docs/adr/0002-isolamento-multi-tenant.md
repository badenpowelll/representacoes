# ADR 0002 — Isolamento multi-tenant por RLS

- **Status:** aceita
- **Data:** 2026-11-22

## Decisão
Banco compartilhado com coluna `tenant_id` em toda tabela privada e RLS obrigatório. Autorização via funções `SECURITY DEFINER` no schema `app` (`search_path = ''`, nomes qualificados, `EXECUTE` restrito). Escritas sensíveis (criar tenant, convites, auditoria) só por RPC. `tenant_id` imutável por trigger. Entidades relacionadas usam FKs compostas `(tenant_id, id)`. O servidor Next.js revalida o vínculo a cada requisição (`requireTenantContext`).

## Alternativas consideradas
- Schema por tenant: isolamento forte, mas migrations e consultas agregadas ficam caras.
- Banco por tenant: custo e operação inviáveis no estágio atual.

## Consequências
- Um teste automatizado falha se alguma tabela de `public` estiver sem RLS.
- O invariante "pelo menos um administrador ativo" usa trigger diferido com `pg_advisory_xact_lock` por tenant para resistir a transações concorrentes.
