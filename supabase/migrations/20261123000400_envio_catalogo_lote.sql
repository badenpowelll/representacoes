-- ---------------------------------------------------------------------------
-- Envio de catálogo em lote, modo ASSISTIDO: o sistema monta a lista de
-- destinatários (só contatos elegíveis: base legal, finalidade, oposição e
-- supressão) e a mensagem; cada envio é aberto pelo usuário no próprio e-mail
-- ou WhatsApp (mailto:/wa.me) e registrado. Nada sai automaticamente.
-- A elegibilidade é verificada de novo no momento de cada envio.
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  catalog_version_id  uuid not null,
  channel             text not null check (channel in ('email', 'whatsapp')),
  name                text not null check (length(btrim(name)) between 2 and 200),
  subject             text check (subject is null or length(subject) <= 300),
  body                text not null check (length(btrim(body)) between 1 and 4000),
  link_expires_at     timestamptz not null,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, catalog_version_id) references public.catalog_versions (tenant_id, id) on delete restrict
);
create index campaigns_tenant_idx on public.campaigns (tenant_id, created_at desc);
select app.tenant_table_policies('public.campaigns',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative']::public.tenant_role[]);

create table public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  campaign_id  uuid not null,
  company_id   uuid not null,
  contact_id   uuid,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'blocked')),
  reason       text,
  sent_at      timestamptz,
  sent_by      uuid references auth.users (id) on delete set null,
  activity_id  uuid references public.activities (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (campaign_id, company_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete set null (contact_id)
);
create index campaign_recipients_campaign_idx on public.campaign_recipients (tenant_id, campaign_id, status);
select app.tenant_table_policies('public.campaign_recipients',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative']::public.tenant_role[]);

-- Melhor contato elegível de uma empresa para receber catálogo pelo canal.
-- Vale finalidade "divulgação de catálogos"; para prospects, também "prospecção".
create or replace function app.catalog_recipient(p_tenant uuid, p_company uuid, p_channel text)
returns table (contact_id uuid, reason text)
language sql
stable
set search_path = ''
as $$
  with e as (
    select ce.contact_id, ce.eligible, ce.reason, 1 as pref
      from public.contact_eligibility(p_tenant, p_company, 'catalog_distribution', p_channel) ce
    union all
    select ce.contact_id, ce.eligible, ce.reason, 2
      from public.contact_eligibility(p_tenant, p_company, 'prospecting', p_channel) ce
      join public.companies co on co.tenant_id = p_tenant and co.id = p_company and co.kind = 'prospect'
  )
  select x.contact_id, x.reason
    from (
      select e.contact_id, case when e.eligible then null else e.reason end as reason, e.eligible, e.pref
        from e
       order by e.eligible desc, e.pref, e.contact_id
       limit 1
    ) x
  union all
  select null::uuid, 'no_contact'
   where not exists (select 1 from e);
$$;
revoke all on function app.catalog_recipient(uuid, uuid, text) from public;
grant execute on function app.catalog_recipient(uuid, uuid, text) to authenticated;

-- Cria o lote: só versão PUBLICADA do próprio tenant; empresas sem contato
-- elegível entram como "bloqueadas" com o motivo, para o usuário ver.
create or replace function public.create_catalog_campaign(
  p_tenant          uuid,
  p_catalog_version uuid,
  p_channel         text,
  p_name            text,
  p_subject         text,
  p_body            text,
  p_companies       uuid[],
  p_link_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign uuid;
  v_company uuid;
  r record;
  v_ready integer := 0;
  v_blocked integer := 0;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative']::public.tenant_role[]) then
    raise exception 'sem permissão para enviar catálogos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.catalog_versions v
                  where v.tenant_id = p_tenant and v.id = p_catalog_version and v.status = 'published') then
    raise exception 'só é possível enviar uma versão publicada do catálogo' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_companies), 0) = 0 then
    raise exception 'escolha ao menos um cliente' using errcode = '22023';
  end if;
  if cardinality(p_companies) > 500 then
    raise exception 'no máximo 500 clientes por lote' using errcode = '22023';
  end if;

  insert into public.campaigns (tenant_id, catalog_version_id, channel, name, subject, body, link_expires_at)
  values (p_tenant, p_catalog_version, p_channel, p_name, p_subject, p_body, p_link_expires_at)
  returning id into v_campaign;

  for v_company in select distinct unnest(p_companies) loop
    continue when not exists (select 1 from public.companies c where c.tenant_id = p_tenant and c.id = v_company);
    select * into r from app.catalog_recipient(p_tenant, v_company, p_channel);
    insert into public.campaign_recipients (tenant_id, campaign_id, company_id, contact_id, status, reason)
    values (p_tenant, v_campaign, v_company, r.contact_id,
            case when r.reason is null then 'pending' else 'blocked' end, r.reason);
    if r.reason is null then v_ready := v_ready + 1; else v_blocked := v_blocked + 1; end if;
  end loop;

  return pg_catalog.jsonb_build_object('campaign_id', v_campaign, 'ready', v_ready, 'blocked', v_blocked);
end;
$$;
revoke all on function public.create_catalog_campaign(uuid, uuid, text, text, text, text, uuid[], timestamptz) from public, anon;
grant execute on function public.create_catalog_campaign(uuid, uuid, text, text, text, text, uuid[], timestamptz) to authenticated;

-- Registra um envio. Confere de novo a elegibilidade (oposição pode ter
-- chegado depois de o lote ser criado) e é idempotente: enviar duas vezes o
-- mesmo destinatário devolve o registro existente.
create or replace function public.campaign_record_send(p_tenant uuid, p_recipient uuid, p_subject text, p_body text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rc public.campaign_recipients;
  cp public.campaigns;
  v_reason text;
  v_activity uuid;
  v_ok boolean;
begin
  select * into rc from public.campaign_recipients where tenant_id = p_tenant and id = p_recipient for update;
  if rc.id is null then
    raise exception 'destinatário não encontrado' using errcode = 'P0002';
  end if;
  select * into cp from public.campaigns where tenant_id = p_tenant and id = rc.campaign_id;
  if rc.status = 'sent' then
    return pg_catalog.jsonb_build_object('ok', true, 'already_sent', true, 'contact_id', rc.contact_id);
  end if;
  if rc.contact_id is null then
    v_reason := coalesce(rc.reason, 'no_contact');
  else
    select bool_or(ce.eligible) into v_ok
      from public.contact_eligibility(p_tenant, rc.company_id, 'catalog_distribution', cp.channel) ce
     where ce.contact_id = rc.contact_id;
    if not coalesce(v_ok, false) then
      select bool_or(ce.eligible) into v_ok
        from public.contact_eligibility(p_tenant, rc.company_id, 'prospecting', cp.channel) ce
        join public.companies co on co.tenant_id = p_tenant and co.id = rc.company_id and co.kind = 'prospect'
       where ce.contact_id = rc.contact_id;
    end if;
    if not coalesce(v_ok, false) then
      select ce.reason into v_reason
        from public.contact_eligibility(p_tenant, rc.company_id, 'catalog_distribution', cp.channel) ce
       where ce.contact_id = rc.contact_id;
      v_reason := coalesce(v_reason, 'not_eligible');
    end if;
  end if;
  if v_reason is not null then
    update public.campaign_recipients set status = 'blocked', reason = v_reason, updated_at = now() where id = rc.id;
    return pg_catalog.jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  insert into public.activities (tenant_id, kind, company_id, subject, body, done_at, metadata)
  values (p_tenant, cp.channel::public.activity_kind, rc.company_id,
          coalesce(nullif(pg_catalog.btrim(p_subject), ''), case when cp.channel = 'email' then 'Envio de catálogo' else 'Catálogo por WhatsApp' end),
          left(p_body, 8000), now(),
          pg_catalog.jsonb_build_object('mode', 'manual_link', 'campaign_id', cp.id, 'catalog_version_id', cp.catalog_version_id,
                                        'contact_id', rc.contact_id, 'channel', cp.channel))
  returning id into v_activity;
  update public.campaign_recipients
     set status = 'sent', reason = null, sent_at = now(), sent_by = auth.uid(), activity_id = v_activity, updated_at = now()
   where id = rc.id;
  return pg_catalog.jsonb_build_object('ok', true, 'already_sent', false, 'contact_id', rc.contact_id, 'activity_id', v_activity);
end;
$$;
revoke all on function public.campaign_record_send(uuid, uuid, text, text) from public, anon;
grant execute on function public.campaign_record_send(uuid, uuid, text, text) to authenticated;
