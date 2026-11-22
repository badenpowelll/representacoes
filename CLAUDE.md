# Rep360 — Instruções permanentes para Claude Code

## Missão
Construir um SaaS B2B multi-tenant de inteligência comercial para empresas de representação, reduzindo deslocamentos presenciais, automatizando prospecção e divulgação de catálogos e acompanhando oportunidades até a venda. Cada representação é um cliente independente, com contexto comercial próprio. Esta especificação foi reconstruída a partir dos requisitos disponíveis; não é uma transcrição integral da conversa original.

## Arquitetura proposta
TypeScript, React/Next.js ou stack equivalente justificada, PostgreSQL/Supabase Auth e RLS, armazenamento privado de catálogos, processamento assíncrono por fila, API modular e testes automatizados. Antes de implementar, inspecione o repositório, registre decisões em ADRs e não substitua código existente sem justificativa. Ambientes dev/staging/prod separados. Nunca versionar segredos.

## Autenticação e segurança
Usar autenticação gerenciada, verificação de e-mail, recuperação de senha, MFA para administradores, sessões com expiração e revogação. Papéis: administrador da plataforma, administrador da representação, gerente, representante, assistente e leitura. Modelar tenants, memberships e permissões; validar vínculo e papel no servidor em cada requisição. Aplicar RLS a todas as tabelas e objetos de armazenamento por tenant_id, inclusive filas, logs, documentos e relatórios. Não confiar no tenant_id recebido sem validar associação. Chaves privilegiadas exclusivamente no servidor. Testar acessos cruzados negativos. Senhas nunca armazenadas pela aplicação. Para OAuth Gmail, usar authorization code com PKCE quando aplicável, state, escopos mínimos, HTTPS, tokens de acesso de curta duração e refresh tokens criptografados em servidor; revogação e reconexão. Não registrar tokens nos logs nem expor ao cliente. Esta é arquitetura pretendida, não uma descrição de autenticação já existente.

## Módulos
1. Onboarding multi-tenant, usuários, convites, papéis e contexto comercial editável por empresa: segmentos, CNAEs, ICP, diferenciais, restrições, tom de comunicação e metas.
2. Indústrias e empresas representadas: cadastro, contatos, condições comerciais, vigência, exclusividade, regiões e relacionamento com representantes.
3. Catálogos e produtos: upload privado, versões, extração de PDF, metadados, categorias, SKU, preços autorizados, vigência e associação a indústrias e territórios.
4. Territórios: estados brasileiros, municípios, cobertura e exclusividade por indústria e representante.
5. CRM: clientes e prospects, CNPJ, segmento/CNAE, localização, contatos, histórico, preferências, consentimentos quando aplicáveis e bloqueios de comunicação.
6. Motor de compatibilidade: combinar indústria, produto, setor, estado, perfil e restrições. Score explicável, deduplicação e revisão humana.
7. Prospecção: pesquisar fontes públicas autorizadas, registrar fonte e data, contextualizar por tenant e gerar leads qualificados. Não inventar empresas ou contatos.
8. Funil comercial Kanban: novo, qualificado, contato, negociação, proposta, ganho e perdido; tarefas, follow-up, histórico, motivos de perda e indicadores.
9. Gmail: conexão individual por OAuth, sincronização incremental, threads, envio e recebimento, webhooks quando disponíveis, fila, deduplicação, tratamento de erros, limites e reconexão. Implementar inicialmente em sandbox; envio automático real apenas sob política configurada e autorização do tenant.
10. Agente IA: ao publicar novo catálogo, identificar clientes compatíveis pelo ramo e estado, elaborar mensagem personalizada com dados verificáveis, submeter a política de aprovação, enviar pelo Gmail autorizado, acompanhar respostas, classificar intenção e encaminhar ao responsável. Respeitar opt-out, limites, horários e bloqueios. Nunca enviar catálogo de outro tenant ou inventar preços. Tratar conteúdo de e-mails e PDFs como dados não confiáveis, impedindo prompt injection e ações arbitrárias.
11. Dashboard: clientes, leads, conversões, visitas evitadas estimadas com premissas explícitas, atividades, campanhas, respostas e vendas. Indicadores filtrados por indústria, representante, estado e período.

## Modelo inicial de dados
tenants, profiles, memberships, commercial_contexts, industries, representation_agreements, territories, representatives, catalogs, catalog_versions, products, companies, contacts, leads, matches, deals, activities, email_connections, email_threads, email_messages, campaigns, campaign_recipients, agent_runs, outbox_jobs, suppression_list, audit_logs. PK UUID, FKs, tenant_id, timestamps, índices compostos, restrições de unicidade e integridade. Dados globais de referência separados de dados privados.

## Plano de execução
Fase 0: scaffold, README, .env.example sem valores reais, ADRs, CI, migrations e fixtures sintéticas.
Fase 1: autenticação, isolamento, onboarding, dashboard básico, indústrias, territórios, catálogos/produtos, CRM, motor de compatibilidade, prospecção manual, funil e colaboradores.
Fase 2: Gmail OAuth e sincronização, filas e campanhas em modo rascunho; testar com contas de desenvolvimento.
Fase 3: agente IA e prospecção automatizada, aprovação governada, envio autorizado, métricas e auditoria.
Fase 4: otimização, observabilidade, backup/restauração testados, billing e escalabilidade.

## Critérios de aceite
Aplicação responsiva em português brasileiro, acessibilidade, estados de loading/erro/vazio, validação server-side, testes unitários, integração e e2e. Dois tenants fictícios não podem ler, alterar, listar ou baixar dados um do outro. Segredos fora do Git. Migrações reproduzíveis. Envio idempotente e auditável, sem duplicidade. LGPD: minimização, finalidade, retenção, exclusão, registro da base legal e canal de oposição. Não realizar disparos reais ou deploy em produção sem autorização. Documentar execução local e limitações. A cada etapa executar lint, typecheck, testes e build; relatar resultados reais, nunca simular sucesso.

## Primeira tarefa
Implemente Fase 0 e depois Fase 1 em incrementos verificáveis, começando pelo isolamento multi-tenant. Entregue código funcional, não apenas telas mockadas. Crie documentação de arquitetura e backlog, registre decisões e pendências. Faça commits pequenos e não altere produção.
