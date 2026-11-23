-- Último administrador também sob REPEATABLE READ / SERIALIZABLE.
--
-- O advisory lock serializa as transações, mas em REPEATABLE READ a contagem
-- usa o snapshot do início da transação e não enxerga o commit concorrente.
-- Uma linha-guarda por tenant resolve: toda transação que mexe em vínculos
-- atualiza a mesma linha; em RR/SERIALIZABLE a segunda falha com 40001
-- (serialization_failure) e em READ COMMITTED espera e recontagem vê o commit.

create table app.tenant_admin_guard (
  tenant_id  uuid primary key references public.tenants (id) on delete cascade,
  version    bigint not null default 0
);
revoke all on app.tenant_admin_guard from public;

create or replace function app.ensure_tenant_has_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rep360.tenant_admin:' || v_tenant::text, 0));
  if not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return null; -- tenant sendo excluído em cascata
  end if;
  insert into app.tenant_admin_guard as g (tenant_id) values (v_tenant)
  on conflict (tenant_id) do update set version = g.version + 1;
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
