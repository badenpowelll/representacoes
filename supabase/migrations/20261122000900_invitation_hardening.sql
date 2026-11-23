-- Endurecimento do aceite de convites (parecer 002 do ChatGPT, P1):
--  * exige e-mail confirmado no Auth;
--  * nunca altera papel/status de vínculo existente (inclusive revogado);
--  * revalida, no aceite, que quem convidou ainda tem autorização para aquele papel.

create or replace function app.user_has_role(p_tenant uuid, p_user uuid, p_roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_user
      and m.status = 'active' and m.role = any (p_roles)
  );
$$;
revoke all on function app.user_has_role(uuid, uuid, public.tenant_role[]) from public;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'autenticação obrigatória' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations
  where token_hash = app.token_hash(p_token)
  for update;

  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = auth.uid();
  if v_email is distinct from lower(v_inv.email) or v_confirmed is null then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  -- Quem convidou precisa continuar autorizado a conceder este papel.
  if v_inv.invited_by is null
     or not app.user_has_role(v_inv.tenant_id, v_inv.invited_by,
          case when v_inv.role = 'tenant_admin'
               then array['tenant_admin']::public.tenant_role[]
               else array['tenant_admin','manager']::public.tenant_role[] end) then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  -- Vínculo existente (ativo ou revogado) não é alterado por convite.
  if exists (select 1 from public.memberships m where m.tenant_id = v_inv.tenant_id and m.user_id = auth.uid()) then
    raise exception 'você já possui vínculo com esta representação; peça a um administrador para ajustar o acesso'
      using errcode = '22023';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_inv.tenant_id, auth.uid(), v_inv.role);

  update public.invitations set accepted_at = now() where id = v_inv.id;
  perform app.write_audit(v_inv.tenant_id, 'invitation.accepted', 'invitations', v_inv.id,
    pg_catalog.jsonb_build_object('role', v_inv.role));
  return v_inv.tenant_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
