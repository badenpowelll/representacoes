-- ---------------------------------------------------------------------------
-- Robô de respostas + bot do Telegram.
--
--  * O Gmail avisa (Pub/Sub, ou a rotina diária) que a caixa mudou; o servidor
--    lê o histórico e só guarda respostas a conversas que o PRÓPRIO sistema
--    iniciou (mesmo threadId de um e-mail enviado pelo sistema).
--  * Cada resposta vira atividade no histórico do cliente e é avisada na hora no
--    Telegram de quem enviou o e-mail (se ligou o Telegram em Mensagens).
--  * Quem recebeu o aviso responde no Telegram ("responder" à mensagem) e o bot
--    envia pelo Gmail na mesma conversa, passando pelas mesmas checagens
--    (email_prepare_send) como se fosse o próprio usuário.
--  * Cliente que responde "SAIR" tem a oposição registrada na hora.
--
-- O conteúdo dos e-mails recebidos é dado NÃO confiável: é guardado e mostrado
-- como texto, nunca interpretado como comando.
--
-- Funções svc_* rodam só com a chave de serviço (servidor: webhooks e rotinas),
-- nunca pelo navegador. Para agir em nome de um usuário, elas fixam o usuário
-- da sessão do banco (app.act_as) e chamam as funções normais, que fazem as
-- mesmas checagens de papel, elegibilidade e oposição.
-- ---------------------------------------------------------------------------

-- Conversa do Gmail de cada e-mail enviado pelo sistema.
alter table public.email_messages
  add column gmail_thread_id text check (gmail_thread_id is null or length(gmail_thread_id) <= 100),
  add column in_reply_to_inbound uuid;
create index email_messages_thread_idx on public.email_messages (tenant_id, gmail_thread_id) where gmail_thread_id is not null;

-- Leitura incremental da caixa (histórico do Gmail) por conexão.
alter table public.email_connections
  add column last_history_id text check (last_history_id is null or last_history_id ~ '^[0-9]{1,30}$'),
  add column watch_expires_at timestamptz,
  add column reads_inbox boolean not null default false;
grant select (last_history_id, watch_expires_at, reads_inbox) on public.email_connections to authenticated;

-- O resultado agora guarda também a conversa (threadId) do Gmail.
drop function public.email_record_result(uuid, uuid, text, text, text);
create or replace function public.email_record_result(
  p_tenant uuid, p_message uuid, p_status text, p_provider_id text default null, p_error text default null,
  p_thread_id text default null
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
              'campaign_recipient_id', m.campaign_recipient_id, 'direction', 'outbound',
              'reply_to_inbound', m.in_reply_to_inbound))
    returning id into v_activity;
    if m.campaign_recipient_id is not null then
      update public.campaign_recipients
         set status = 'sent', reason = null, sent_at = now(), sent_by = auth.uid(), activity_id = v_activity, updated_at = now()
       where tenant_id = p_tenant and id = m.campaign_recipient_id and status <> 'sent';
    end if;
  end if;
  update public.email_messages
     set status = p_status, provider_message_id = p_provider_id, error = left(p_error, 500),
         sent_at = case when p_status in ('sandbox', 'sent') then now() end, activity_id = v_activity,
         gmail_thread_id = coalesce(left(p_thread_id, 100), gmail_thread_id)
   where id = m.id;
  return pg_catalog.jsonb_build_object('ok', true, 'status', p_status, 'activity_id', v_activity);
end;
$$;
revoke all on function public.email_record_result(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.email_record_result(uuid, uuid, text, text, text, text) to authenticated;

-- Respostas recebidas (só de conversas iniciadas pelo sistema).
create table public.email_inbound (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  connection_id        uuid not null,
  email_message_id     uuid,               -- e-mail do sistema que iniciou a conversa
  company_id           uuid not null,
  contact_id           uuid,
  gmail_message_id     text not null check (length(gmail_message_id) <= 100),
  gmail_thread_id      text not null check (length(gmail_thread_id) <= 100),
  rfc_message_id       text check (rfc_message_id is null or length(rfc_message_id) <= 500),
  rfc_references       text check (rfc_references is null or length(rfc_references) <= 4000),
  from_address         text not null check (length(from_address) <= 320),
  subject              text check (subject is null or length(subject) <= 500),
  body_text            text check (body_text is null or length(body_text) <= 20000),
  received_at          timestamptz not null default now(),
  opted_out            boolean not null default false,
  activity_id          uuid references public.activities (id) on delete set null,
  telegram_chat_id     bigint,
  telegram_message_id  bigint,
  notified_at          timestamptz,
  created_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (connection_id, gmail_message_id),
  foreign key (tenant_id, connection_id) references public.email_connections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, email_message_id) references public.email_messages (tenant_id, id) on delete set null (email_message_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete set null (contact_id)
);
create index email_inbound_company_idx on public.email_inbound (tenant_id, company_id, received_at desc);
create unique index email_inbound_telegram_idx on public.email_inbound (telegram_chat_id, telegram_message_id) where telegram_message_id is not null;
alter table public.email_inbound enable row level security;
create policy email_inbound_select on public.email_inbound for select to authenticated using (app.is_member(tenant_id));
revoke all on public.email_inbound from anon, authenticated;
grant select on public.email_inbound to authenticated;

alter table public.email_messages
  add constraint email_messages_reply_fk foreign key (tenant_id, in_reply_to_inbound)
  references public.email_inbound (tenant_id, id) on delete set null (in_reply_to_inbound);

-- Telegram: cada usuário liga o próprio chat (um por usuário e representação).
create table public.telegram_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  chat_id     bigint not null,
  username    text check (username is null or length(username) <= 64),
  linked_at   timestamptz not null default now(),
  unique (tenant_id, user_id)
);
alter table public.telegram_links enable row level security;
create policy telegram_links_select on public.telegram_links for select to authenticated
  using (app.is_member(tenant_id) and user_id = auth.uid());
revoke all on public.telegram_links from anon, authenticated;
grant select (id, tenant_id, user_id, username, linked_at) on public.telegram_links to authenticated;

-- Código de uso único (só o hash fica no banco), válido por 15 minutos.
create table public.telegram_link_codes (
  code_hash   text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;

-- Gera o código para o usuário ligar o Telegram. Só quem pode enviar e-mail.
create or replace function public.telegram_link_code_create(p_tenant uuid, p_code_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare v_exp timestamptz := now() + interval '15 minutes';
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative']::public.tenant_role[]) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  delete from public.telegram_link_codes where (tenant_id = p_tenant and user_id = auth.uid()) or expires_at < now();
  insert into public.telegram_link_codes (code_hash, tenant_id, user_id, expires_at) values (p_code_hash, p_tenant, auth.uid(), v_exp);
  return v_exp;
end;
$$;
revoke all on function public.telegram_link_code_create(uuid, text) from public, anon;
grant execute on function public.telegram_link_code_create(uuid, text) to authenticated;

create or replace function public.telegram_unlink(p_tenant uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.telegram_links where tenant_id = p_tenant and user_id = auth.uid();
$$;
revoke all on function public.telegram_unlink(uuid) from public, anon;
grant execute on function public.telegram_unlink(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Funções do servidor (service_role).
-- ---------------------------------------------------------------------------

-- Fixa o usuário da transação para reaproveitar as funções normais (e suas checagens).
create or replace function app.act_as(p_user uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
revoke all on function app.act_as(uuid) from public;
grant execute on function app.act_as(uuid) to service_role;

create or replace function public.svc_telegram_link(p_code_hash text, p_chat_id bigint, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare c public.telegram_link_codes; v_name text;
begin
  delete from public.telegram_link_codes where code_hash = p_code_hash returning * into c;
  if c.code_hash is null or c.expires_at < now() then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = c.tenant_id and m.user_id = c.user_id and m.status = 'active') then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;
  insert into public.telegram_links (tenant_id, user_id, chat_id, username)
  values (c.tenant_id, c.user_id, p_chat_id, left(p_username, 64))
  on conflict (tenant_id, user_id) do update set chat_id = excluded.chat_id, username = excluded.username, linked_at = now();
  select t.name into v_name from public.tenants t where t.id = c.tenant_id;
  perform app.write_audit(c.tenant_id, 'telegram.linked', 'telegram_links', null, pg_catalog.jsonb_build_object('user_id', c.user_id));
  return pg_catalog.jsonb_build_object('ok', true, 'tenant_name', v_name);
end;
$$;
revoke all on function public.svc_telegram_link(text, bigint, text) from public, anon, authenticated;
grant execute on function public.svc_telegram_link(text, bigint, text) to service_role;

-- Conexões ativas (para a leitura da caixa). Devolve o texto cifrado; o servidor decifra.
create or replace function public.svc_gmail_connections(p_email text default null)
returns table (connection_id uuid, tenant_id uuid, user_id uuid, email_address text, ciphertext text, last_history_id text)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.tenant_id, c.user_id, c.email_address, c.refresh_token_ciphertext, c.last_history_id
    from public.email_connections c
   where c.status = 'active' and c.refresh_token_ciphertext is not null and c.reads_inbox
     and (p_email is null or c.email_address = lower(p_email));
$$;
revoke all on function public.svc_gmail_connections(text) from public, anon, authenticated;
grant execute on function public.svc_gmail_connections(text) to service_role;

create or replace function public.svc_gmail_set_state(
  p_connection uuid, p_history_id text, p_watch_expires timestamptz default null, p_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_connections
     set last_history_id = case
           when p_history_id is null then last_history_id
           when last_history_id is null or p_history_id::numeric > last_history_id::numeric then p_history_id
           else last_history_id end,
         watch_expires_at = coalesce(p_watch_expires, watch_expires_at),
         status = case when p_error is not null then 'error' else status end,
         last_error = case when p_error is not null then left(p_error, 500) else last_error end,
         updated_at = now()
   where id = p_connection;
$$;
revoke all on function public.svc_gmail_set_state(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.svc_gmail_set_state(uuid, text, timestamptz, text) to service_role;

-- Guarda uma resposta. Só aceita se a conversa foi iniciada pelo sistema nesta
-- conexão e o remetente não é a própria conta. Idempotente por mensagem do Gmail.
create or replace function public.svc_inbound_record(
  p_connection uuid, p_gmail_message_id text, p_gmail_thread_id text, p_rfc_message_id text, p_references text,
  p_from text, p_subject text, p_body text, p_received_at timestamptz, p_is_opt_out boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conn public.email_connections;
  orig public.email_messages;
  v_id uuid;
  v_activity uuid;
  v_company text;
  v_chat bigint;
  v_from text := lower(btrim(p_from));
begin
  select * into conn from public.email_connections where id = p_connection and status = 'active';
  if conn.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'no_connection');
  end if;
  if v_from = conn.email_address then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'own_message');
  end if;
  select * into orig from public.email_messages m
   where m.tenant_id = conn.tenant_id and m.gmail_thread_id = p_gmail_thread_id and m.status = 'sent'
   order by m.created_at limit 1;
  if orig.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_our_thread');
  end if;

  insert into public.email_inbound (tenant_id, connection_id, email_message_id, company_id, contact_id, gmail_message_id, gmail_thread_id,
                                    rfc_message_id, rfc_references, from_address, subject, body_text, received_at, opted_out)
  values (conn.tenant_id, conn.id, orig.id, orig.company_id, orig.contact_id, p_gmail_message_id, p_gmail_thread_id,
          left(p_rfc_message_id, 500), left(p_references, 4000), left(v_from, 320), left(p_subject, 500), left(p_body, 20000),
          coalesce(p_received_at, now()), coalesce(p_is_opt_out, false))
  on conflict (connection_id, gmail_message_id) do nothing
  returning id into v_id;
  if v_id is null then
    return pg_catalog.jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.activities (tenant_id, kind, company_id, subject, body, done_at, metadata, actor_id)
  values (conn.tenant_id, 'email', orig.company_id, coalesce(nullif(left(p_subject, 300), ''), 'Resposta do cliente'),
          left(coalesce(p_body, ''), 8000), coalesce(p_received_at, now()),
          pg_catalog.jsonb_build_object('mode', 'gmail_api', 'direction', 'inbound', 'email_inbound_id', v_id,
            'email_message_id', orig.id, 'contact_id', orig.contact_id, 'from', v_from),
          conn.user_id)
  returning id into v_activity;
  update public.email_inbound set activity_id = v_activity where id = v_id;

  -- "SAIR": oposição registrada na hora, como se o dono da conexão tivesse marcado.
  if p_is_opt_out and orig.contact_id is not null then
    perform app.act_as(conn.user_id);
    perform public.opt_out_contact(conn.tenant_id, orig.company_id, orig.contact_id);
    insert into public.suppression_list (tenant_id, email, reason)
    select conn.tenant_id, v_from, 'opt_out'
     where not exists (select 1 from public.suppression_list s where s.tenant_id = conn.tenant_id and lower(s.email) = v_from);
  end if;

  select co.legal_name into v_company from public.companies co where co.tenant_id = conn.tenant_id and co.id = orig.company_id;
  select t.chat_id into v_chat from public.telegram_links t where t.tenant_id = conn.tenant_id and t.user_id = conn.user_id;
  return pg_catalog.jsonb_build_object('ok', true, 'duplicate', false, 'inbound_id', v_id, 'tenant_id', conn.tenant_id,
    'company_id', orig.company_id, 'company', v_company, 'chat_id', v_chat, 'opted_out', coalesce(p_is_opt_out, false));
end;
$$;
revoke all on function public.svc_inbound_record(uuid, text, text, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.svc_inbound_record(uuid, text, text, text, text, text, text, text, timestamptz, boolean) to service_role;

create or replace function public.svc_inbound_notified(p_inbound uuid, p_chat_id bigint, p_message_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_inbound set telegram_chat_id = p_chat_id, telegram_message_id = p_message_id, notified_at = now()
   where id = p_inbound;
$$;
revoke all on function public.svc_inbound_notified(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.svc_inbound_notified(uuid, bigint, bigint) to service_role;

-- Resposta pelo Telegram: acha a resposta do cliente pela mensagem respondida no
-- chat, confere que o chat é do usuário dono da conexão e prepara o envio com as
-- checagens normais (como o próprio usuário). Idempotente por update do Telegram.
create or replace function public.svc_telegram_reply_prepare(
  p_chat_id bigint, p_reply_to_message_id bigint, p_body text, p_update_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ib public.email_inbound;
  conn public.email_connections;
  orig public.email_messages;
  v_subject text;
  v_prep jsonb;
begin
  select * into ib from public.email_inbound where telegram_chat_id = p_chat_id and telegram_message_id = p_reply_to_message_id;
  if ib.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'unknown_message');
  end if;
  select * into conn from public.email_connections where id = ib.connection_id;
  if conn.status <> 'active' or not exists (
       select 1 from public.telegram_links t where t.tenant_id = ib.tenant_id and t.user_id = conn.user_id and t.chat_id = p_chat_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;
  if ib.contact_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'no_contact');
  end if;
  select * into orig from public.email_messages where id = ib.email_message_id;
  v_subject := coalesce(nullif(btrim(ib.subject), ''), orig.subject, 'Contato');
  if v_subject !~* '^(re|res|resp):' then v_subject := 'Re: ' || v_subject; end if;

  perform app.act_as(conn.user_id);
  v_prep := public.email_prepare_send(ib.tenant_id, ib.company_id, ib.contact_id, ib.from_address, left(v_subject, 300), p_body,
    'telegram:' || p_chat_id::text || ':' || p_update_id::text,
    case when orig.campaign_recipient_id is not null then 'catalog_distribution' else 'prospecting' end::public.contact_purpose);
  if (v_prep ->> 'ok')::boolean and not coalesce((v_prep ->> 'duplicate')::boolean, false) then
    update public.email_messages set in_reply_to_inbound = ib.id, gmail_thread_id = ib.gmail_thread_id
     where id = (v_prep ->> 'message_id')::uuid;
  end if;
  return v_prep || pg_catalog.jsonb_build_object('tenant_id', ib.tenant_id, 'user_id', conn.user_id, 'connection_id', conn.id,
    'to', ib.from_address, 'subject', left(v_subject, 300), 'thread_id', ib.gmail_thread_id, 'in_reply_to', ib.rfc_message_id,
    'references', ib.rfc_references, 'ciphertext', conn.refresh_token_ciphertext, 'from', conn.email_address);
end;
$$;
revoke all on function public.svc_telegram_reply_prepare(bigint, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.svc_telegram_reply_prepare(bigint, bigint, text, bigint) to service_role;

create or replace function public.svc_email_record_result(
  p_user uuid, p_tenant uuid, p_message uuid, p_status text, p_provider_id text, p_error text, p_thread_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.act_as(p_user);
  return public.email_record_result(p_tenant, p_message, p_status, p_provider_id, p_error, p_thread_id);
end;
$$;
revoke all on function public.svc_email_record_result(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_email_record_result(uuid, uuid, uuid, text, text, text, text) to service_role;

-- Ao conectar com permissão de leitura, o servidor marca a conexão para vigiar a caixa.
create or replace function public.email_connection_set_inbox(p_tenant uuid, p_reads boolean, p_history_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_connections
     set reads_inbox = coalesce(p_reads, false),
         last_history_id = case when p_history_id ~ '^[0-9]{1,30}$' then p_history_id else last_history_id end,
         updated_at = now()
   where tenant_id = p_tenant and user_id = auth.uid();
end;
$$;
revoke all on function public.email_connection_set_inbox(uuid, boolean, text) from public, anon;
grant execute on function public.email_connection_set_inbox(uuid, boolean, text) to authenticated;
