# ADR 0005 — Exigência de MFA de administradores configurável por ambiente

**Status:** aceito (22/11/2026, decisão do proprietário)

## Contexto
O ADR 0004 tornou o segundo fator obrigatório para `tenant_admin`. Para o ambiente
de teste/demonstração ("Rep360 teste"), o proprietário pediu que o segundo fator não
apareça nas telas, mantendo-o obrigatório no produto. Também indicou que, no futuro,
o MFA deve poder ser opcional.

## Decisão
- `app.platform_settings.require_admin_mfa` (linha única), **padrão `true`**.
- `app.admin_mfa_required()` retorna `true` se a linha não existir (fail-closed).
  `app.has_role` só rebaixa o admin AAL1 para leitura quando a exigência está ligada.
- Não há API para mudar o valor: a tabela não tem grants nem políticas. Só o dono do
  banco (SQL editor / service_role) altera, e cada mudança vai para
  `app.platform_settings_log`.
- A aplicação lê `public.admin_mfa_required()` para mostrar o mesmo papel efetivo que o
  banco aplica e, se a leitura falhar, assume que é exigido. Com a exigência desligada,
  o onboarding não leva ao cadastro do autenticador. A tela "Segurança" continua
  disponível, e quem já tem fator continua passando pelo desafio no login.

## Consequências
- Staging e produção **devem** manter `require_admin_mfa = true`. O checklist de
  deploy precisa conferir esse valor e o log.
- Próximo passo (backlog): MFA opcional por representação, decidido pelo próprio
  tenant, com auditoria e um aviso de risco.
