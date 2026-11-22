# Backlog

Legenda: ✅ feito · 🔄 em andamento · ⏳ pendente · ⛔ bloqueado (decisão do proprietário)

## Fase 0 — Fundação
- ✅ Scaffold Next.js 15 + TypeScript + Tailwind + ESLint
- ✅ Vitest (unitário + banco) e harness de RLS em Postgres puro
- ✅ Migration do núcleo multi-tenant (tenants, profiles, memberships, invitations, audit_logs, platform_admins)
- ✅ Convites por RPC com token hasheado; lock contra corrida no último admin
- ✅ Seed sintético com dois tenants fictícios
- ✅ CI (lint, typecheck, testes com Postgres, build)
- ✅ README, ADRs, arquitetura, `.env.example`
- ⛔ Projetos Supabase de staging/prod e secrets do CI para deploy

## Fase 1 — Produto base
- ⏳ Login, cadastro com verificação de e-mail, recuperação de senha, MFA obrigatório para administradores
- ⏳ Onboarding: criar representação, convidar colaboradores, aceitar convite
- ⏳ Contexto comercial (segmentos, CNAEs, ICP, diferenciais, restrições, tom, metas)
- ⏳ Indústrias representadas e acordos de representação
- ⏳ Territórios (UFs e municípios como dados de referência globais; cobertura por tenant)
- ⏳ Catálogos e produtos (Storage privado com políticas por tenant, versões, SKU, preços autorizados)
- ⏳ CRM: empresas, contatos, consentimentos e lista de supressão
- ⏳ Motor de compatibilidade com score explicável
- ⏳ Prospecção manual com registro de fonte e data
- ⏳ Funil Kanban (deals, atividades, motivos de perda)
- ⏳ Dashboard básico
- ⏳ Testes e2e (Playwright)

## Pendências e riscos
- Validar migrations em um Supabase real (staging) — depende de ⛔.
- Codex no GitHub requer environment em chatgpt.com/codex — decisão do proprietário.
- Base legal LGPD por finalidade a ser definida com o proprietário antes de campanhas.
