-- ---------------------------------------------------------------------------
-- Envio de e-mail direto pelo sistema, pela conta Google Workspace de cada
-- usuário (API do Gmail, escopo gmail.send). Conexão individual por OAuth.
--
-- Segurança:
--  * O refresh token fica CIFRADO (AES-256-GCM) com chave que só o servidor
--    da aplicação conhece; o banco guarda apenas o texto cifrado. A coluna não
--    é legível por authenticated: o servidor lê via email_connection_secret,
--    que só devolve a conexão do próprio usuário.
--  * Todo envio passa por email_prepare_send: confere elegibilidade (oposição,
--    supressão, base legal, finalidade) e grava o registro ANTES de enviar,
--    com chave de idempotência: repetir o clique não envia duas vezes.
--  * Modo de teste ("sandbox") grava tudo mas não envia; envio real depende de
--    conexão ativa e da configuração do servidor.
-- ---------------------------------------------------------------------------

create table public.email_connections (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants (id) on delete cascade,
  user_id                  uuid not null references auth.users (id) on delete cascade default auth.uid(),
  provider                 text not null default 'gmail' check (provider = 'gmail'),
  email_address            text not null check (email_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status                   text not null default 'active' check (status in ('active', 'revoked', 'error')),
  refresh_token_ciphertext text,
  last_error               text check (last_error is null or length(last_error) <= 500),
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id, provider)
);
alter table public.email_connections enable row level security;
-- Leitura: membros veem as conexões do tenant (sem o token). Escrita só via funções.
create policy email_connections_select on public.email_connections for select to authenticated
  using (app.is_member(tenant_id));
revoke all on public.email_connections from anon, authenticated;
grant select (id, tenant_id, user_id, provider, email_address, status, last_error, connected_at, updated_at)
  on public.email_connections to authenticated;

-- Grava/atualiza a conexão do próprio usuário (chamada pelo servidor no retorno do OAuth).
create or replace function public.email_connection_save(p_tenant uuid, p_email text, p_ciphertext text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]) then
    raise exception 'sem permissão para conectar e-mail' using errcode = '42501';
  end if;
  if p_ciphertext is null or length(p_ciphertext) < 20 then
    raise exception 'token inválido' using errcode = '22023';
  end if;
  insert into public.email_connections (tenant_id, user_id, email_address, refresh_token_ciphertext, status, last_error)
  values (p_tenant, auth.uid(), lower(p_email), p_ciphertext, 'active', null)
  on conflict (tenant_id, user_id, provider) do update
    set email_address = excluded.email_address, refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        status = 'active', last_error = null, connected_at = now(), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.email_connection_save(uuid, text, text) from public, anon;
grant execute on function public.email_connection_save(uuid, text, text) to authenticated;

-- Texto cifrado do token, só da conexão do próprio usuário (o servidor decifra).
create or replace function public.email_connection_secret(p_tenant uuid)
returns table (connection_id uuid, email_address text, ciphertext text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.email_address, c.refresh_token_ciphertext
    from public.email_connections c
   where c.tenant_id = p_tenant and c.user_id = auth.uid() and c.status = 'active'
     and app.is_member(p_tenant);
$$;
revoke all on function public.email_connection_secret(uuid) from public, anon;
grant execute on function public.email_connection_secret(uuid) to authenticated;

-- Desconectar (apaga o token) ou marcar erro (ex.: acesso revogado no Google).
create or replace function public.email_connection_set_status(p_tenant uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('revoked', 'error') then
    raise exception 'status inválido' using errcode = '22023';
  end if;
  update public.email_connections
     set status = p_status,
         refresh_token_ciphertext = case when p_status = 'revoked' then null else refresh_token_ciphertext end,
         last_error = left(p_error, 500), updated_at = now()
   where tenant_id = p_tenant and user_id = auth.uid() and app.is_member(p_tenant);
end;
$$;
revoke all on function public.email_connection_set_status(uuid, text, text) from public, anon;
grant execute on function public.email_connection_set_status(uuid, text, text) to authenticated;

-- Registro de cada e-mail (sandbox ou real). Idempotente por chave.
create table public.email_messages (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null,
  connection_id          uuid,
  company_id             uuid not null,
  contact_id             uuid,
  campaign_recipient_id  uuid,
  to_address             text not null,
  from_address           text,
  subject                text not null check (length(btrim(subject)) between 1 and 300),
  body                   text not null check (length(body) between 1 and 20000),
  status                 text not null default 'queued' check (status in ('queued', 'sandbox', 'sent', 'failed')),
  provider_message_id    text,
  error                  text check (error is null or length(error) <= 500),
  idempotency_key        text not null check (length(idempotency_key) between 8 and 200),
  activity_id            uuid references public.activities (id) on delete set null,
  created_by             uuid references auth.users (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  sent_at                timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, connection_id) references public.email_connections (tenant_id, id) on delete set null (connection_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete set null (contact_id),
  foreign key (tenant_id, campaign_recipient_id) references public.campaign_recipients (tenant_id, id) on delete set null (campaign_recipient_id)
);
create index email_messages_company_idx on public.email_messages (tenant_id, company_id, created_at desc);
create index email_messages_daily_idx on public.email_messages (tenant_id, created_by, created_at desc);
alter table public.email_messages enable row level security;
create policy email_messages_select on public.email_messages for select to authenticated using (app.is_member(tenant_id));
revoke all on public.email_messages from anon, authenticated;
grant select on public.email_messages to authenticated;

-- Prepara um envio: elegibilidade do contato + destinatário fora da supressão,
-- limite diário por usuário, e registro idempotente. Devolve o registro.
create or replace function public.email_prepare_send(
  p_tenant          uuid,
  p_company         uuid,
  p_contact         uuid,
  p_to              text,
  p_subject         text,
  p_body            text,
  p_idempotency_key text,
  p_purpose         public.contact_purpose default 'prospecting',
  p_campaign_recipient uuid default null,
  p_daily_limit     integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.email_messages;
  v_ok boolean;
  v_reason text;
  v_conn uuid;
  v_from text;
  v_id uuid;
  v_today integer;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative']::public.tenant_role[]) then
    raise exception 'sem permissão para enviar e-mail' using errcode = '42501';
  end if;
  select * into v_existing from public.email_messages where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  -- Repetição do mesmo envio: devolve o registro existente. Só um envio que
  -- falhou pode ser tentado de novo (passa outra vez por todas as checagens).
  if v_existing.id is not null and v_existing.status <> 'failed' then
    return pg_catalog.jsonb_build_object('ok', true, 'message_id', v_existing.id, 'status', v_existing.status, 'duplicate', true);
  end if;
  if p_to is null or p_to !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_address');
  end if;
  if not exists (select 1 from public.contacts c where c.tenant_id = p_tenant and c.id = p_contact and c.company_id = p_company) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'no_contact');
  end if;

  -- Envio de um lote: o destinatário tem de estar na fila, com esta empresa e este contato.
  if p_campaign_recipient is not null and not exists (
       select 1 from public.campaign_recipients r
        where r.tenant_id = p_tenant and r.id = p_campaign_recipient and r.company_id = p_company
          and r.contact_id = p_contact and r.status = 'pending') then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  -- Elegibilidade do contato (mesma regra das telas). Prospect também vale por "prospecção".
  select bool_or(e.eligible), min(e.reason) into v_ok, v_reason
    from public.contact_eligibility(p_tenant, p_company, p_purpose, 'email') e
   where e.contact_id = p_contact;
  if not coalesce(v_ok, false) and p_purpose = 'catalog_distribution'
     and exists (select 1 from public.companies co where co.tenant_id = p_tenant and co.id = p_company and co.kind = 'prospect') then
    select bool_or(e.eligible), min(e.reason) into v_ok, v_reason
      from public.contact_eligibility(p_tenant, p_company, 'prospecting', 'email') e
     where e.contact_id = p_contact;
  end if;
  if not coalesce(v_ok, false) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', coalesce(v_reason, 'not_eligible'));
  end if;
  -- O endereço efetivo (pode ter sido corrigido na tela) também não pode estar suprimido.
  if exists (select 1 from public.suppression_list s where s.tenant_id = p_tenant
               and (lower(s.email) = lower(p_to) or lower(s.domain) = lower(pg_catalog.split_part(p_to, '@', 2)))) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;

  select count(*) into v_today from public.email_messages m
   where m.tenant_id = p_tenant and m.created_by = auth.uid() and m.created_at > now() - interval '24 hours'
     and m.status in ('queued', 'sent');
  if v_today >= greatest(coalesce(p_daily_limit, 500), 1) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'daily_limit');
  end if;

  select c.id, c.email_address into v_conn, v_from from public.email_connections c
   where c.tenant_id = p_tenant and c.user_id = auth.uid() and c.status = 'active';

  insert into public.email_messages (tenant_id, connection_id, company_id, contact_id, campaign_recipient_id, to_address, from_address,
                                     subject, body, status, idempotency_key)
  values (p_tenant, v_conn, p_company, p_contact, p_campaign_recipient, lower(p_to), v_from, p_subject, p_body, 'queued', p_idempotency_key)
  on conflict (tenant_id, idempotency_key) do update
     set status = 'queued', error = null, connection_id = excluded.connection_id, to_address = excluded.to_address,
         from_address = excluded.from_address, subject = excluded.subject, body = excluded.body
   where public.email_messages.status = 'failed' and public.email_messages.created_by = auth.uid()
  returning id into v_id;
  if v_id is null then
    -- Outro clique gravou o mesmo envio ao mesmo tempo: não envia de novo.
    select * into v_existing from public.email_messages where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
    return pg_catalog.jsonb_build_object('ok', true, 'message_id', v_existing.id, 'status', v_existing.status, 'duplicate', true);
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'message_id', v_id, 'status', 'queued', 'duplicate', false,
                                       'connection_id', v_conn, 'from', v_from);
end;
$$;
revoke all on function public.email_prepare_send(uuid, uuid, uuid, text, text, text, text, public.contact_purpose, uuid, integer) from public, anon;
grant execute on function public.email_prepare_send(uuid, uuid, uuid, text, text, text, text, public.contact_purpose, uuid, integer) to authenticated;

-- Resultado do envio: grava status e, se saiu (ou foi simulado), a atividade no histórico.
create or replace function public.email_record_result(
  p_tenant uuid, p_message uuid, p_status text, p_provider_id text default null, p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.email_messages;
  v_activity uuid;
begin
  if p_status not in ('sandbox', 'sent', 'failed') then
    raise exception 'status inválido' using errcode = '22023';
  end if;
  select * into m from public.email_messages
   where tenant_id = p_tenant and id = p_message and created_by = auth.uid() for update;
  if m.id is null then
    raise exception 'e-mail não encontrado' using errcode = 'P0002';
  end if;
  if m.status <> 'queued' then
    return pg_catalog.jsonb_build_object('ok', true, 'status', m.status, 'activity_id', m.activity_id);
  end if;
  if p_status in ('sandbox', 'sent') then
    insert into public.activities (tenant_id, kind, company_id, subject, body, done_at, metadata)
    values (p_tenant, 'email', m.company_id, m.subject, left(m.body, 8000), now(),
            pg_catalog.jsonb_build_object('mode', case when p_status = 'sent' then 'gmail_api' else 'sandbox' end,
              'email_message_id', m.id, 'contact_id', m.contact_id, 'to', m.to_address, 'from', m.from_address,
              'campaign_recipient_id', m.campaign_recipient_id))
    returning id into v_activity;
    if m.campaign_recipient_id is not null then
      update public.campaign_recipients
         set status = 'sent', reason = null, sent_at = now(), sent_by = auth.uid(), activity_id = v_activity, updated_at = now()
       where tenant_id = p_tenant and id = m.campaign_recipient_id and status <> 'sent';
    end if;
  end if;
  update public.email_messages
     set status = p_status, provider_message_id = p_provider_id, error = left(p_error, 500),
         sent_at = case when p_status in ('sandbox', 'sent') then now() end, activity_id = v_activity
   where id = m.id;
  return pg_catalog.jsonb_build_object('ok', true, 'status', p_status, 'activity_id', v_activity);
end;
$$;
revoke all on function public.email_record_result(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.email_record_result(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Texto padrão por representação: cada tenant tem seus modelos (prospecção e
-- envio de catálogo, por canal) e sua assinatura de e-mail. Ordem de uso:
-- modelo da indústria → padrão da representação → padrão do sistema.
-- ---------------------------------------------------------------------------
alter table public.commercial_contexts
  add column email_signature text check (email_signature is null or length(email_signature) <= 1000);

create table public.message_defaults (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  purpose     text not null check (purpose in ('prospeccao', 'catalogo')),
  channel     text not null check (channel in ('email', 'whatsapp')),
  subject     text check (subject is null or length(subject) <= 200),
  body        text not null check (length(btrim(body)) between 10 and 5000),
  updated_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, purpose, channel),
  check (channel <> 'email' or length(btrim(coalesce(subject, ''))) >= 3)
);
select app.tenant_table_policies('public.message_defaults',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);
