-- Exigência de MFA para administradores como configuração do ambiente.
--
-- Padrão: exigida (fail-closed). Decisão do proprietário (22/11/2026): pode ser
-- desligada apenas no ambiente de teste/demonstração. Não há API para mudar o
-- valor: a tabela não tem políticas nem grants, então só o dono do banco
-- (SQL editor / service_role) altera, e cada mudança fica registrada em
-- app.platform_settings_log. Em produção deve permanecer ligada (ver ADR 0005).

create table app.platform_settings (
  id boolean primary key default true check (id),
  require_admin_mfa boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into app.platform_settings default values;
alter table app.platform_settings enable row level security;
alter table app.platform_settings force row level security;
revoke all on app.platform_settings from public, anon, authenticated;

create table app.platform_settings_log (
  id bigint generated always as identity primary key,
  require_admin_mfa boolean not null,
  changed_by text not null default current_user,
  changed_at timestamptz not null default now()
);
alter table app.platform_settings_log enable row level security;
alter table app.platform_settings_log force row level security;
revoke all on app.platform_settings_log from public, anon, authenticated;

create or replace function app.log_platform_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.require_admin_mfa is distinct from old.require_admin_mfa then
    insert into app.platform_settings_log(require_admin_mfa) values (new.require_admin_mfa);
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger platform_settings_log
  before update on app.platform_settings
  for each row execute function app.log_platform_settings();

-- Sem a linha (ou com qualquer falha de leitura do valor), a exigência vale.
create or replace function app.admin_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.require_admin_mfa from app.platform_settings s where s.id), true);
$$;
revoke all on function app.admin_mfa_required() from public;
grant execute on function app.admin_mfa_required() to authenticated;

-- Para a aplicação mostrar o mesmo papel efetivo que o banco aplica.
create or replace function public.admin_mfa_required()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.admin_mfa_required();
$$;
revoke all on function public.admin_mfa_required() from public, anon;
grant execute on function public.admin_mfa_required() to authenticated;

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
             when m.role = 'tenant_admin'
                  and app.current_aal() is distinct from 'aal2'
                  and app.admin_mfa_required()
               then 'viewer'::public.tenant_role
             else m.role
           end) = any (p_roles)
  );
$$;
revoke all on function app.has_role(uuid, public.tenant_role[]) from public;
grant execute on function app.has_role(uuid, public.tenant_role[]) to authenticated;
