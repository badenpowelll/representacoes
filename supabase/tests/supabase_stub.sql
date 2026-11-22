-- Stub mínimo do ambiente Supabase para rodar migrations e testes de RLS em um
-- PostgreSQL comum (CI e desenvolvimento sem Docker). NÃO é uma migration e
-- nunca deve ser aplicado em um projeto Supabase real, que já fornece isto.

-- Papéis são globais ao cluster e as suítes rodam em paralelo: tolera corrida.
do $$
declare
  r record;
begin
  for r in select * from (values ('anon', ''), ('authenticated', ''), ('service_role', ' bypassrls')) v(name, extra) loop
    if not exists (select 1 from pg_roles where rolname = r.name) then
      begin
        execute format('create role %I nologin noinherit%s', r.name, r.extra);
      exception when duplicate_object or unique_violation then
        null;
      end;
    end if;
  end loop;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Mesma semântica do Supabase: lê o "sub" das claims do JWT da requisição.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
