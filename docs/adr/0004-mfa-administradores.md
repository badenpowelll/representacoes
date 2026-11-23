# ADR 0004 — MFA obrigatório para administradores, aplicado no banco

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto
A especificação exige MFA para administradores. Checar o MFA só na interface não basta: um token AAL1 (apenas senha) chamaria o PostgREST diretamente e manteria os privilégios.

## Decisão
- `app.has_role` lê o claim `aal` do JWT (`auth.jwt()`). Um vínculo `tenant_admin` com sessão diferente de `aal2` é tratado como `viewer` em todas as políticas RLS e RPCs que usam `app.has_role`. Claim ausente conta como AAL1.
- O servidor Next.js aplica a mesma regra (`effectiveRole`) para decidir o que exibir; o banco continua sendo a autoridade.
- Apenas `tenant_admin` depende do AAL2. Gerentes e demais papéis não mudam nesta fase.
- Fator: TOTP do Supabase Auth. Onboarding: depois de criar a representação, o administrador vai para `/app/seguranca` para cadastrar o autenticador. Pode adiar, mas fica somente com leitura, com um aviso em todas as telas.
- Login: quem tem fator verificado é levado ao desafio TOTP logo após a senha.

## Recuperação
Sem bypass silencioso. Se um administrador perder o autenticador:
1. outro administrador da representação continua operando normalmente (recomenda-se ter dois);
2. caso contrário, o suporte da plataforma verifica a identidade fora do sistema e remove o fator pelo painel ou pela API administrativa do Supabase (service_role), com registro da ação. O usuário cadastra um novo fator no próximo login.
Códigos de recuperação próprios ficam para uma fase futura (backlog).

## Consequências
- Testes de banco simulam `aal2` por padrão (`asUser(..., { aal })`) e há uma suíte específica para AAL1.
- Integração com o Supabase local cadastra TOTP real e confirma que AAL1 recebe 42501 pela API.
- Os e2e cadastram o TOTP com o segredo exibido na tela (contas sintéticas).
