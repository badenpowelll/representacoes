# Arquitetura do Rep360

## Visão geral

```
Navegador ── Next.js (App Router, Server Components/Actions) ── Supabase
                 │  cookies httpOnly de sessão                   ├─ Postgres + RLS (dados por tenant)
                 │  validação server-side (zod)                  ├─ Auth (e-mail, MFA, OAuth)
                 │  requireTenantContext()                       └─ Storage privado (catálogos)
                 └─ workers assíncronos (Fase 2: outbox_jobs → Gmail)
```

## Isolamento multi-tenant

1. **Banco como autoridade.** Toda tabela privada tem `tenant_id` e RLS habilitado (`force row level security` nas tabelas de tenant). O cliente usa sempre a chave anon + JWT do usuário; a chave `service_role` fica restrita a jobs de servidor.
2. **Funções de autorização** no schema `app` (não exposto pela API): `app.is_member(tenant)`, `app.has_role(tenant, roles[])`, `app.shares_tenant_with(user)`. São `SECURITY DEFINER`, `search_path = ''`, referências qualificadas, `EXECUTE` restrito — isso evita recursão de RLS em `memberships`.
3. **Servidor valida a cada requisição.** `requireTenantContext(tenantId)` confere sessão e vínculo ativo antes de qualquer ação; o `tenant_id` vindo do cliente nunca é aceito sem essa checagem.
4. **Imutabilidade do tenant.** Trigger `app.prevent_tenant_change` impede mover linhas entre tenants.
5. **FKs compostas.** Entidades filhas referenciam o pai por `(tenant_id, id)`, garantindo que relações nunca cruzem tenants (a partir da Fase 1).
6. **Auditoria.** `audit_logs` só é gravado por `app.write_audit()` dentro de RPCs; usuários apenas leem (administradores).

## Papéis

| Papel | Escopo |
|---|---|
| Administrador da plataforma | `platform_admins`, só via service_role (sem acesso pela API) |
| `tenant_admin` | tudo no tenant, membros, auditoria |
| `manager` | convites (exceto admin), catálogos, CRM, funil, aprovação de campanhas |
| `representative` | CRM e funil |
| `assistant` | CRM |
| `viewer` | leitura |

A matriz em `src/lib/auth/permissions.ts` espelha as políticas e serve à interface; o banco decide.

## Convites

`create_invitation` gera um token aleatório, devolve-o uma única vez e guarda apenas o SHA-256. `accept_invitation` exige que o e-mail do usuário autenticado seja o do convite e rejeita tokens expirados, revogados ou reutilizados, com mensagem genérica. Alterações diretas na tabela são negadas; revogação via `revoke_invitation`.

## Ambientes

`dev` (local), `staging` e `prod` serão projetos Supabase separados. Staging/prod ainda **não existem**: criá-los é decisão do proprietário (possível custo).
