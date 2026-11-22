-- Convites por RPC (token aleatório, apenas o hash é salvo) e proteção do
-- último administrador contra corridas concorrentes.

-- ---------------------------------------------------------------------------
-- Último administrador: serializa por tenant antes de contar.
-- Em READ COMMITTED, a consulta após o lock enxerga o commit concorrente.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Convites: criação e aceite somente via RPC
-- ---------------------------------------------------------------------------
drop policy if exists invitations_insert on public.invitations;
revoke insert on public.invitations from authenticated;

create or replace function app.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
$$;
revoke all on function app.token_hash(text) from public;

-- Retorna o token em claro UMA vez; o banco guarda só o hash.
create or replace function public.create_invitation(
  p_tenant uuid, p_email text, p_role public.tenant_role
)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'autenticação obrigatória' using errcode = '42501';
  end if;
  if not app.has_role(p_tenant, array['tenant_admin','manager']::public.tenant_role[]) then
    raise exception 'sem permissão para convidar nesta representação' using errcode = '42501';
  end if;
  if p_role = 'tenant_admin' and not app.has_role(p_tenant, array['tenant_admin']::public.tenant_role[]) then
    raise exception 'somente administradores convidam administradores' using errcode = '42501';
  end if;

  -- 244 bits aleatórios (gen_random_uuid usa o gerador criptográfico do Postgres)
  v_token := pg_catalog.replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invitations (tenant_id, email, role, token_hash, invited_by)
  values (p_tenant, lower(btrim(p_email)), p_role, app.token_hash(v_token), auth.uid())
  returning id into v_id;

  perform app.write_audit(p_tenant, 'invitation.created', 'invitations', v_id,
    pg_catalog.jsonb_build_object('role', p_role));
  return query select v_id, v_token;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'autenticação obrigatória' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations
  where token_hash = app.token_hash(p_token)
  for update;

  -- Mensagem única para não revelar se o token existe.
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_inv.tenant_id, auth.uid(), v_inv.role)
  on conflict (tenant_id, user_id) do update
    set role = excluded.role, status = 'active';

  update public.invitations set accepted_at = now() where id = v_inv.id;
  perform app.write_audit(v_inv.tenant_id, 'invitation.accepted', 'invitations', v_inv.id, '{}'::jsonb);
  return v_inv.tenant_id;
end;
$$;

revoke all on function public.create_invitation(uuid, text, public.tenant_role) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.tenant_role) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;

-- Atualização direta permitiria a um gerente trocar o papel do convite para
-- administrador; a única alteração permitida é revogar, via RPC.
drop policy if exists invitations_update on public.invitations;
revoke update on public.invitations from authenticated;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.invitations where id = p_invitation;
  if v_tenant is null
     or not app.has_role(v_tenant, array['tenant_admin','manager']::public.tenant_role[]) then
    raise exception 'convite não encontrado' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
  where id = p_invitation and accepted_at is null and revoked_at is null;
  perform app.write_audit(v_tenant, 'invitation.revoked', 'invitations', p_invitation, '{}'::jsonb);
end;
$$;

revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
