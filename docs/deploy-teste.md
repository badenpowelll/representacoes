# Ambiente de teste publicado (Vercel + Supabase "Rep360 teste")

Ambiente para o Baden navegar e testar o Rep360. **Sem dados reais.**

- Hospedagem: Vercel, plano Hobby (gratuito), projeto `rep360-teste`.
  Production Branch = `claude/project-thread-ixa248` (cópia do PR #3 com ajustes de deploy).
- Banco/Auth: projeto Supabase gratuito "Rep360 teste" (região sa-east-1).
- Variáveis na Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (chave publicável), `APP_ENV=staging`. A service role **não** é usada em runtime
  e não está na Vercel.
- Supabase Auth: Site URL e Redirect URLs apontando para o domínio `*.vercel.app` do projeto.
- MFA obrigatório de administrador desligado **só** neste banco (flag de ambiente, ADR 0004).

Limitações: plano Hobby é para uso não comercial; e-mails de confirmação usam o SMTP
padrão do Supabase (poucos envios por hora). Nenhum envio real de campanha/Gmail existe nesta fase.
