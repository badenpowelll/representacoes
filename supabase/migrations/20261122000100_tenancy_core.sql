-- Rep360 — núcleo multi-tenant: tenants, perfis, vínculos, convites e auditoria.
-- Toda tabela privada tem tenant_id e RLS habilitado. Funções auxiliares ficam
-- no schema "app", fora da API exposta pelo PostgREST.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.tenant_role as enum (
  'tenant_admin',     -- administrador da representação
  'manager',          -- gerente
  'representative',   -- representante
  'assistant',        -- assistente
  'viewer'            -- somente leitura
);

create type public.membership_status as enum ('active', 'revoked');

-- ---------------------------------------------------------------------------
-- Utilidades genéricas
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Impede que uma linha seja "movida" para outro tenant via UPDATE.
create or replace function app.prevent_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id não pode ser alterado' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 63),
  cnpj        text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Perfil público mínimo de cada usuário autenticado (1:1 com auth.users).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or length(full_name) <= 200),
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Administradores da plataforma (operadores do SaaS). Sem acesso via API.
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.tenant_role not null,
  status      public.membership_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id, status);
create index memberships_tenant_role_idx on public.memberships (tenant_id, role) where status = 'active';

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         public.tenant_role not null,
  token_hash   text not null unique,           -- sha256 do token; o token em si nunca é salvo
  invited_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index invitations_tenant_idx on public.invitations (tenant_id, created_at desc);
create unique index invitations_pending_unique
  on public.invitations (tenant_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);

-- Triggers de manutenção
create trigger tenants_updated_at before update on public.tenants
  for each row execute function app.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function app.set_updated_at();
create trigger invitations_updated_at before update on public.invitations
  for each row execute function app.set_updated_at();

create trigger memberships_tenant_lock before update on public.memberships
  for each row execute function app.prevent_tenant_change();
create trigger invitations_tenant_lock before update on public.invitations
  for each row execute function app.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER para não recursar em RLS)
-- ---------------------------------------------------------------------------
create or replace function app.is_member(p_tenant uuid)
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
  );
$$;

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
      and m.role = any (p_roles)
  );
$$;

create or replace function app.shares_tenant_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = p_user and theirs.status = 'active'
  );
$$;

create or replace function app.write_audit(
  p_tenant uuid, p_action text, p_entity text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, metadata)
  values (p_tenant, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on function app.is_member(uuid) from public;
revoke all on function app.has_role(uuid, public.tenant_role[]) from public;
revoke all on function app.shares_tenant_with(uuid) from public;
revoke all on function app.write_audit(uuid, text, text, uuid, jsonb) from public;
grant execute on function app.is_member(uuid) to authenticated;
grant execute on function app.has_role(uuid, public.tenant_role[]) to authenticated;
grant execute on function app.shares_tenant_with(uuid) to authenticated;

-- Um tenant nunca pode ficar sem administrador ativo.
create or replace function app.ensure_tenant_has_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  if not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return null; -- tenant sendo excluído em cascata
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = v_tenant and m.role = 'tenant_admin' and m.status = 'active'
  ) then
    raise exception 'a representação precisa de pelo menos um administrador ativo'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger memberships_keep_admin
  after update or delete on public.memberships
  deferrable initially deferred
  for each row execute function app.ensure_tenant_has_admin();

-- Perfil criado automaticamente ao cadastrar usuário no Supabase Auth.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPCs expostas (validam o usuário no servidor)
-- ---------------------------------------------------------------------------
create or replace function public.create_tenant(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'autenticação obrigatória' using errcode = '42501';
  end if;
  insert into public.tenants (name, slug) values (btrim(p_name), lower(btrim(p_slug)))
    returning id into v_tenant;
  insert into public.memberships (tenant_id, user_id, role)
    values (v_tenant, auth.uid(), 'tenant_admin');
  perform app.write_audit(v_tenant, 'tenant.created', 'tenants', v_tenant, jsonb_build_object('slug', p_slug));
  return v_tenant;
end;
$$;

revoke all on function public.create_tenant(text, text) from public, anon;
grant execute on function public.create_tenant(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tenants          enable row level security;
alter table public.profiles         enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.memberships      enable row level security;
alter table public.invitations      enable row level security;
alter table public.audit_logs       enable row level security;

alter table public.tenants          force row level security;
alter table public.memberships      force row level security;
alter table public.invitations      force row level security;
alter table public.audit_logs       force row level security;

-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (app.is_member(id));
create policy tenants_update on public.tenants for update to authenticated
  using (app.has_role(id, array['tenant_admin']::public.tenant_role[]))
  with check (app.has_role(id, array['tenant_admin']::public.tenant_role[]));
-- INSERT apenas via create_tenant(); DELETE apenas pela plataforma (service_role).

-- profiles: o próprio usuário e colegas de representação
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_tenant_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- platform_admins: sem políticas => inacessível via API (somente service_role).

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (app.is_member(tenant_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app.has_role(tenant_id, array['tenant_admin']::public.tenant_role[]));
create policy memberships_update on public.memberships for update to authenticated
  using (app.has_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
  with check (app.has_role(tenant_id, array['tenant_admin']::public.tenant_role[]));
create policy memberships_delete on public.memberships for delete to authenticated
  using (app.has_role(tenant_id, array['tenant_admin']::public.tenant_role[]));

-- invitations: administradores e gerentes gerenciam convites do próprio tenant
create policy invitations_select on public.invitations for select to authenticated
  using (app.has_role(tenant_id, array['tenant_admin','manager']::public.tenant_role[]));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    app.has_role(tenant_id, array['tenant_admin','manager']::public.tenant_role[])
    and invited_by = auth.uid()
    -- gerente não convida administrador
    and (role <> 'tenant_admin' or app.has_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
  );
create policy invitations_update on public.invitations for update to authenticated
  using (app.has_role(tenant_id, array['tenant_admin','manager']::public.tenant_role[]))
  with check (app.has_role(tenant_id, array['tenant_admin','manager']::public.tenant_role[]));

-- audit_logs: somente leitura para administradores; escrita via app.write_audit()
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (tenant_id is not null and app.has_role(tenant_id, array['tenant_admin']::public.tenant_role[]));

-- Privilégios de tabela: anon não acessa nada; authenticated depende das políticas.
revoke all on public.tenants, public.profiles, public.platform_admins,
  public.memberships, public.invitations, public.audit_logs from anon;
grant select, update on public.tenants to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update on public.invitations to authenticated;
grant select on public.audit_logs to authenticated;
revoke all on public.platform_admins from authenticated;
