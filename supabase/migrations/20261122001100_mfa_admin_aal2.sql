-- MFA para administradores: privilégios de tenant_admin exigem sessão AAL2.
--
-- Um administrador com sessão AAL1 (só senha) é tratado como "leitura" em todas
-- as políticas RLS e RPCs que usam app.has_role: lê os dados da representação,
-- mas não altera nada, não convida, não gerencia membros e não lê auditoria.
-- Não existe bypass: quem não cadastrou fator precisa cadastrar (onboarding) e
-- a recuperação de um fator perdido é feita pela plataforma (ver docs/adr/0004).

-- Nível de garantia da sessão, lido do JWT da requisição (claim "aal").
create or replace function app.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;
revoke all on function app.current_aal() from public;
grant execute on function app.current_aal() to authenticated;

create or replace function app.has_role(p_tenant uuid, p_roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (case
             when m.role = 'tenant_admin' and app.current_aal() is distinct from 'aal2'
               then 'viewer'::public.tenant_role
             else m.role
           end) = any (p_roles)
  );
$$;
revoke all on function app.has_role(uuid, public.tenant_role[]) from public;
grant execute on function app.has_role(uuid, public.tenant_role[]) to authenticated;
