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
Banco (migrations + RLS + testes):
- ✅ Contexto comercial, indústrias, contatos da indústria, acordos de representação
- ✅ Territórios (UFs globais; cobertura por indústria/UF/município/representante)
- ✅ CRM: empresas, contatos, base legal LGPD, opt-out e lista de supressão
- ✅ Catálogos, versões, produtos com preço autorizado; Storage privado por prefixo de tenant
- ✅ Leads com fonte obrigatória, motor de compatibilidade explicável com revisão humana, funil e atividades
- ✅ Validação real no Supabase local (Auth, PostgREST, Storage)

Interface:
- ✅ Login, cadastro com confirmação de e-mail, recuperação e redefinição de senha
- ✅ Onboarding (criar representação), lista de representações
- ✅ Painel básico (indústrias, clientes, prospects, leads, vendas ganhas, negócios por etapa)
- ✅ Indústrias, empresas e funil Kanban (criar e mover negócios, motivo de perda)
- ✅ E2E Playwright do fluxo principal, incluindo acesso negado entre representações
- ✅ Equipe e convites (link exibido uma vez; sem envio de e-mail nesta fase)
- ✅ Preenchimento automático por CNPJ (BrasilAPI) em indústrias, empresas e prospecção; dados completos da Receita (endereço, telefones, CNAEs, sócios) na ficha da empresa (ADR 0006)
- ⏳ CNPJ: limite de consultas por tenant, provedor de reserva, ficha da Receita também para indústrias
- ✅ Contexto comercial e territórios
- ✅ Compatibilidade: calcular, ver motivos do score, aprovar (gera lead) ou rejeitar
- ✅ Catálogos: upload de PDF privado (validação de assinatura %PDF, SHA-256, link assinado de 5 min)
- ✅ MFA obrigatório para administradores (AAL2 exigido no banco; TOTP no onboarding e no login) — ADR 0004
- ✅ Exigência de MFA configurável por ambiente (desligada só no projeto de teste) — ADR 0005
- ⏳ MFA opcional por representação (pedido do proprietário, 22/11)
- ⏳ Códigos de recuperação de MFA próprios (hoje a recuperação é pelo suporte da plataforma)
- ⏳ Extração de texto do PDF (fila assíncrona; conteúdo tratado como não confiável), novas versões e publicação
- ✅ Contatos das empresas: base legal, consentimento com data, oposição (vai para a supressão) e exclusão a pedido
- ✅ Produtos: cadastro com SKU único por indústria, preço autorizado com vigência e vínculo à versão do catálogo
- ✅ Prospecção manual: prospect + lead numa transação, fonte e data obrigatórias, CNPJ reaproveitado, lead levado ao funil
- ✅ Parecer 004-complemento (P1): abrangência territorial explícita; oposição e exclusão por RPC com auditoria; elegibilidade de contatos (`contact_eligibility`) e de produtos (`product_eligibility`) no servidor, fail-closed; base legal sem padrão, com finalidade, justificativa e evidência; preço com origem, referência, responsável, data e histórico
- ⏳ P2 do parecer 004-complemento: verificação IBGE no CI, direitos do titular (exportação), retenção da supressão, centavos inteiros, paginação de produtos, erros em toggleProduct
- ⏳ Importação de produtos em lote (planilha)
- ✅ Municípios do IBGE: snapshot CSV versionado com data e sha256, migration gerada por script
- ✅ Workflow manual de E2E (`workflow_dispatch`), ainda não disparado
- ⏳ E2E automático em cada PR (decisão do proprietário: minutos do Actions)

## Pendências e riscos
- Validar migrations em um Supabase real (staging) — depende de ⛔.
- Codex no GitHub requer environment em chatgpt.com/codex — decisão do proprietário.
- Base legal LGPD: finalidades por contato já existem (prospecção, relacionamento, catálogos, atendimento); política por canal além de e-mail ainda a definir com o proprietário antes de campanhas.
