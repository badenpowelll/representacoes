-- ---------------------------------------------------------------------------
-- Prospecção automática por indústria a partir da base pública de CNPJ
-- (Receita Federal, dados abertos). Ver ADR 0007.
--
--  * ref.cnaes / ref.cnpj_establishments / ref.cnpj_imports: dados GLOBAIS de
--    referência, carregados pelo importador (scripts/importar-receita-cnpj.mjs)
--    com a chave de serviço. Usuários NUNCA leem ref.cnpj_establishments
--    diretamente: só pelas funções abaixo, que exigem vínculo com o tenant e
--    devolvem apenas empresas dentro dos territórios da indústria escolhida
--    (minimização, LGPD art. 6º, III).
--  * industries.target_cnaes: CNAEs-alvo de cada indústria representada.
--  * message_templates: textos de e-mail e WhatsApp editáveis por indústria.
--  * WhatsApp como canal de elegibilidade (telefone, supressão por telefone).
-- Nada aqui envia mensagens: o envio é feito pelo usuário (mailto / wa.me),
-- depois da checagem de elegibilidade no servidor, e fica registrado.
-- ---------------------------------------------------------------------------

-- CNAE (subclasses). Sementes de saúde; o importador atualiza com a tabela
-- oficial da Receita (Cnaes.zip).
create table ref.cnaes (
  code        text primary key check (code ~ '^[0-9]{7}$'),
  description text not null
);
alter table ref.cnaes enable row level security;
create policy cnaes_read on ref.cnaes for select to authenticated using (true);
grant select on ref.cnaes to authenticated;
insert into ref.cnaes (code, description) values
  ('8610101', 'Atividades de atendimento hospitalar, exceto pronto-socorro e unidades para atendimento a urgências'),
  ('8610102', 'Atividades de atendimento em pronto-socorro e unidades hospitalares para atendimento a urgências'),
  ('8621601', 'UTI móvel'),
  ('8621602', 'Serviços móveis de atendimento a urgências, exceto por UTI móvel'),
  ('8630501', 'Atividade médica ambulatorial com recursos para realização de procedimentos cirúrgicos'),
  ('8630502', 'Atividade médica ambulatorial com recursos para realização de exames complementares'),
  ('8630503', 'Atividade médica ambulatorial restrita a consultas'),
  ('8630504', 'Atividade odontológica'),
  ('8630506', 'Serviços de vacinação e imunização humana'),
  ('8640202', 'Laboratórios clínicos'),
  ('8640203', 'Serviços de diálise e nefrologia'),
  ('8640205', 'Serviços de diagnóstico por imagem com uso de radiação ionizante, exceto tomografia'),
  ('8711502', 'Instituições de longa permanência para idosos'),
  ('4645101', 'Comércio atacadista de instrumentos e materiais para uso médico, cirúrgico, hospitalar e de laboratórios'),
  ('4771701', 'Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas'),
  ('4773300', 'Comércio varejista de artigos médicos e ortopédicos'),
  ('7500100', 'Atividades veterinárias')
on conflict (code) do nothing;

create view public.ref_cnaes with (security_invoker = true) as
  select code, description from ref.cnaes;
revoke all on public.ref_cnaes from anon;
grant select on public.ref_cnaes to authenticated;

-- Estabelecimentos ATIVOS (situação cadastral 02) no recorte importado.
create table ref.cnpj_establishments (
  cnpj              text primary key check (cnpj ~ '^[0-9]{14}$'),
  legal_name        text not null,
  trade_name        text,
  is_headquarters   boolean not null,
  opened_on         date,
  main_cnae         text not null check (main_cnae ~ '^[0-9]{7}$'),
  secondary_cnaes   text[] not null default '{}',
  legal_nature_code text,
  company_size      text,             -- 00 não informado, 01 ME, 03 EPP, 05 demais (Receita)
  state_code        char(2) not null references ref.states (code),
  municipality_id   integer references ref.municipalities (ibge_code),
  municipality_name text,
  street            text,
  number            text,
  complement        text,
  district          text,
  zip_code          text,
  phones            text[] not null default '{}' check (app.all_match(phones, '^[0-9]{10,11}$')),
  email             text,
  dataset_ref       text not null check (dataset_ref ~ '^[0-9]{4}-[0-9]{2}$'),
  imported_at       timestamptz not null default now()
);
create index cnpj_est_cnae_state_idx on ref.cnpj_establishments (main_cnae, state_code, municipality_id);
create index cnpj_est_secondary_idx on ref.cnpj_establishments using gin (secondary_cnaes);
alter table ref.cnpj_establishments enable row level security;
alter table ref.cnpj_establishments force row level security;
-- Sem política para authenticated: acesso só pelas funções SECURITY DEFINER.
revoke all on ref.cnpj_establishments from public, anon, authenticated;

create table ref.cnpj_imports (
  id            uuid primary key default gen_random_uuid(),
  dataset_ref   text not null check (dataset_ref ~ '^[0-9]{4}-[0-9]{2}$'),
  states        text[] not null,
  cnaes         text[] not null,
  rows_upserted integer not null default 0,
  rows_removed  integer not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  error         text
);
alter table ref.cnpj_imports enable row level security;
create policy cnpj_imports_read on ref.cnpj_imports for select to authenticated using (true);
grant select on ref.cnpj_imports to authenticated;

create view public.ref_cnpj_imports with (security_invoker = true) as
  select dataset_ref, states, cnaes, rows_upserted, rows_removed, started_at, finished_at, status
  from ref.cnpj_imports;
revoke all on public.ref_cnpj_imports from anon;
grant select on public.ref_cnpj_imports to authenticated;

-- ---------------------------------------------------------------------------
-- CNAEs-alvo por indústria
-- ---------------------------------------------------------------------------
alter table public.industries
  add column target_cnaes text[] not null default '{}' check (app.all_match(target_cnaes, '^[0-9]{7}$'));

-- ---------------------------------------------------------------------------
-- Telefone: normalização e supressão
-- ---------------------------------------------------------------------------
-- Devolve DDD + número (10 ou 11 dígitos) ou null. Aceita +55, 0 de discagem e máscara.
create or replace function app.normalize_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- DDD nunca começa com 0: "0" inicial é prefixo de discagem; 12-13 dígitos com 55 é DDI.
  select case
    when d ~ '^0[1-9][0-9]{9,10}$' then pg_catalog.substr(d, 2)
    when d ~ '^55[1-9][0-9]{9,10}$' then pg_catalog.substr(d, 3)
    when d ~ '^[1-9][0-9]{9,10}$' then d
    else null end
  from (select pg_catalog.regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;
grant execute on function app.normalize_phone(text) to authenticated;

alter table public.suppression_list add column phone text check (phone is null or phone ~ '^[0-9]{10,11}$');
do $$
declare r record;
begin
  for r in select conname from pg_catalog.pg_constraint
           where conrelid = 'public.suppression_list'::regclass and contype = 'c'
             and pg_catalog.pg_get_constraintdef(oid) ilike '%email IS NOT NULL%domain IS NOT NULL%'
  loop
    execute pg_catalog.format('alter table public.suppression_list drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.suppression_list
  add constraint suppression_list_one_target check (num_nonnulls(email, domain, phone) = 1);
create unique index suppression_phone_key on public.suppression_list (tenant_id, phone) where phone is not null;

-- Opt-out e exclusão passam a bloquear também o telefone do contato.
create or replace function app.contact_opt_out_to_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := app.normalize_phone(new.phone);
begin
  if new.opted_out_at is not null and (tg_op = 'INSERT' or old.opted_out_at is null) then
    if new.email is not null then
      insert into public.suppression_list (tenant_id, email, reason, created_by)
      values (new.tenant_id, lower(new.email), 'opt_out', auth.uid())
      on conflict do nothing;
    end if;
    if v_phone is not null then
      insert into public.suppression_list (tenant_id, phone, reason, created_by)
      values (new.tenant_id, v_phone, 'opt_out', auth.uid())
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.delete_contact(p_tenant uuid, p_company uuid, p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_phone text;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]) then
    raise exception 'sem permissão para excluir contatos' using errcode = '42501';
  end if;
  delete from public.contacts c
   where c.tenant_id = p_tenant and c.company_id = p_company and c.id = p_contact
  returning c.email, app.normalize_phone(c.phone) into v_email, v_phone;
  if not found then
    raise exception 'contato não encontrado' using errcode = 'P0002';
  end if;
  if v_email is not null then
    insert into public.suppression_list (tenant_id, email, reason, created_by)
    values (p_tenant, lower(v_email), 'legal', auth.uid())
    on conflict do nothing;
  end if;
  if v_phone is not null then
    insert into public.suppression_list (tenant_id, phone, reason, created_by)
    values (p_tenant, v_phone, 'legal', auth.uid())
    on conflict do nothing;
  end if;
  perform app.write_audit(p_tenant, 'contact.deleted', 'contacts', p_contact,
    jsonb_build_object('company_id', p_company, 'suppressed', v_email is not null or v_phone is not null));
end $$;

-- Elegibilidade: e-mail (como antes) e WhatsApp (telefone).
create or replace function public.contact_eligibility(
  p_tenant  uuid,
  p_company uuid default null,
  p_purpose public.contact_purpose default 'prospecting',
  p_channel text default 'email'
)
returns table (contact_id uuid, eligible boolean, reason text)
language sql
stable
set search_path = ''
as $$
  select c.id,
         r.reason is null,
         r.reason
    from public.contacts c
    cross join lateral (
      select case
        when p_channel not in ('email', 'whatsapp') then 'channel_not_supported'
        when c.opted_out_at is not null then 'opted_out'
        when p_channel = 'email' and c.email is null then 'no_email'
        when p_channel = 'whatsapp' and app.normalize_phone(c.phone) is null then 'no_phone'
        when c.email is not null and exists (
          select 1 from public.suppression_list s
           where s.tenant_id = c.tenant_id
             and (lower(s.email) = lower(c.email)
                  or lower(s.domain) = lower(pg_catalog.split_part(c.email, '@', 2)))
        ) then 'suppressed'
        when p_channel = 'whatsapp' and exists (
          select 1 from public.suppression_list s
           where s.tenant_id = c.tenant_id and s.phone = app.normalize_phone(c.phone)
        ) then 'suppressed'
        when c.legal_basis is null then 'no_legal_basis'
        when not (p_purpose = any (c.purposes)) then 'purpose_not_allowed'
        when c.legal_basis = 'consent' and (c.consent_at is null or c.consent_evidence is null) then 'consent_missing'
        else null
      end as reason
    ) r
   where c.tenant_id = p_tenant
     and (p_company is null or c.company_id = p_company);
$$;

-- Atividade de WhatsApp no histórico.
alter type public.activity_kind add value if not exists 'whatsapp';

-- ---------------------------------------------------------------------------
-- Modelos de mensagem por indústria e canal
-- ---------------------------------------------------------------------------
create table public.message_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  industry_id  uuid not null,
  channel      text not null check (channel in ('email', 'whatsapp')),
  subject      text check (subject is null or length(subject) <= 200),
  body         text not null check (length(btrim(body)) between 10 and 5000),
  updated_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, industry_id, channel),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade,
  check (channel <> 'email' or length(btrim(coalesce(subject, ''))) >= 3)
);
select app.tenant_table_policies('public.message_templates',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative']::public.tenant_role[]);

-- ---------------------------------------------------------------------------
-- Busca de empresas-alvo (somente leitura, minimizada)
-- ---------------------------------------------------------------------------
create or replace function public.prospect_search(
  p_tenant            uuid,
  p_industry          uuid,
  p_municipality      integer default null,
  p_query             text default null,
  p_with_email        boolean default false,
  p_with_phone        boolean default false,
  p_include_secondary boolean default false,
  p_hide_in_portfolio boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0
)
returns table (
  cnpj text, legal_name text, trade_name text, is_headquarters boolean, opened_on date,
  main_cnae text, main_cnae_description text, company_size text,
  state_code char(2), municipality_id integer, municipality_name text, district text,
  phones text[], email text, dataset_ref text,
  company_id uuid, lead_id uuid, email_suppressed boolean, phone_suppressed boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cnaes text[];
  v_q text := nullif(pg_catalog.btrim(coalesce(p_query, '')), '');
begin
  if not app.is_member(p_tenant) then
    raise exception 'sem acesso a esta representação' using errcode = '42501';
  end if;
  select i.target_cnaes into v_cnaes from public.industries i
   where i.tenant_id = p_tenant and i.id = p_industry;
  if not found then
    raise exception 'indústria não encontrada' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(v_cnaes), 0) = 0 then
    return;
  end if;

  return query
  with hits as (
    select e.*
      from ref.cnpj_establishments e
     where (e.main_cnae = any (v_cnaes) or (p_include_secondary and e.secondary_cnaes && v_cnaes))
       and exists (
         select 1 from public.territories t
          where t.tenant_id = p_tenant and t.industry_id = p_industry and t.state_code = e.state_code
            and (t.municipality_id is null or t.municipality_id = e.municipality_id))
       and (p_municipality is null or e.municipality_id = p_municipality)
       and (not p_with_email or e.email is not null)
       and (not p_with_phone or cardinality(e.phones) > 0)
       and (v_q is null
            or e.legal_name ilike '%' || v_q || '%'
            or e.trade_name ilike '%' || v_q || '%'
            or e.cnpj = pg_catalog.regexp_replace(v_q, '[^0-9]', '', 'g'))
  ),
  enriched as (
    select h.*, c.id as c_id, l.id as l_id,
           (h.email is not null and exists (
              select 1 from public.suppression_list s where s.tenant_id = p_tenant
                and (lower(s.email) = lower(h.email) or lower(s.domain) = lower(pg_catalog.split_part(h.email, '@', 2))))) as e_sup,
           (cardinality(h.phones) > 0 and exists (
              select 1 from public.suppression_list s where s.tenant_id = p_tenant and s.phone = any (h.phones))) as p_sup
      from hits h
      left join public.companies c on c.tenant_id = p_tenant and c.cnpj = h.cnpj
      left join public.leads l on l.tenant_id = p_tenant and l.company_id = c.id and l.industry_id = p_industry
  )
  select x.cnpj, x.legal_name, x.trade_name, x.is_headquarters, x.opened_on,
         x.main_cnae, cn.description, x.company_size,
         x.state_code, x.municipality_id, coalesce(m.name, x.municipality_name), x.district,
         case when x.p_sup then '{}'::text[] else x.phones end,
         case when x.e_sup then null else x.email end,
         x.dataset_ref, x.c_id, x.l_id, x.e_sup, x.p_sup,
         count(*) over ()
    from enriched x
    left join ref.cnaes cn on cn.code = x.main_cnae
    left join ref.municipalities m on m.ibge_code = x.municipality_id
   where not p_hide_in_portfolio or x.l_id is null
   order by (x.l_id is not null), (x.email is null), x.legal_name, x.cnpj
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.prospect_search(uuid, uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.prospect_search(uuid, uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer) to authenticated;

-- Um estabelecimento da base pública, só se estiver no território da indústria.
create or replace function app.target_establishment(p_tenant uuid, p_industry uuid, p_cnpj text)
returns setof ref.cnpj_establishments
language sql
stable
security definer
set search_path = ''
as $$
  select e.* from ref.cnpj_establishments e
   join public.industries i on i.tenant_id = p_tenant and i.id = p_industry
   where app.is_member(p_tenant)
     and e.cnpj = p_cnpj
     and exists (
       select 1 from public.territories t
        where t.tenant_id = p_tenant and t.industry_id = p_industry and t.state_code = e.state_code
          and (t.municipality_id is null or t.municipality_id = e.municipality_id));
$$;
revoke all on function app.target_establishment(uuid, uuid, text) from public;
grant execute on function app.target_establishment(uuid, uuid, text) to authenticated;

-- Auditoria da inclusão (write_audit não é exposto a authenticated).
create or replace function app.audit_prospect_added(p_tenant uuid, p_lead uuid, p_dataset text, p_company_created boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_industry uuid;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select l.industry_id into v_industry from public.leads l where l.tenant_id = p_tenant and l.id = p_lead;
  if not found then
    raise exception 'lead não encontrado' using errcode = 'P0002';
  end if;
  perform app.write_audit(p_tenant, 'prospect.added', 'leads', p_lead,
    pg_catalog.jsonb_build_object('industry_id', v_industry, 'dataset_ref', p_dataset, 'company_created', p_company_created));
end $$;
revoke all on function app.audit_prospect_added(uuid, uuid, text, boolean) from public;
grant execute on function app.audit_prospect_added(uuid, uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Leva empresas da base pública para a carteira: empresa + lead + contato
-- institucional (e-mail/telefone publicados na Receita), com fonte, data e base
-- legal registradas. Idempotente por CNPJ. SECURITY INVOKER: RLS vale.
-- p_email / p_phone substituem os dados públicos quando o usuário os corrigiu.
-- ---------------------------------------------------------------------------
create or replace function public.prospect_add(
  p_tenant   uuid,
  p_industry uuid,
  p_cnpj     text,
  p_email    text default null,
  p_phone    text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e ref.cnpj_establishments;
  v_industry_name text;
  v_source text;
  v_date date;
  v_company uuid;
  v_lead uuid;
  v_contact uuid;
  v_email text;
  v_phone text;
  v_created_company boolean := false;
  v_created_lead boolean := false;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]) then
    raise exception 'sem permissão para adicionar empresas' using errcode = '42501';
  end if;
  select * into e from app.target_establishment(p_tenant, p_industry, p_cnpj);
  if e.cnpj is null then
    raise exception 'empresa fora da base ou do território desta indústria' using errcode = 'P0002';
  end if;
  select i.name into v_industry_name from public.industries i where i.tenant_id = p_tenant and i.id = p_industry;

  v_source := 'Receita Federal - dados abertos do CNPJ (ref. ' || e.dataset_ref || ')';
  v_date := least(pg_catalog.to_date(e.dataset_ref || '-01', 'YYYY-MM-DD'), current_date);

  select c.id into v_company from public.companies c where c.tenant_id = p_tenant and c.cnpj = e.cnpj;
  if v_company is null then
    insert into public.companies (tenant_id, kind, legal_name, trade_name, cnpj, cnae, segment, state_code, municipality_id,
                                  source, source_date, legal_basis)
    values (p_tenant, 'prospect', pg_catalog.left(e.legal_name, 300), e.trade_name, e.cnpj, e.main_cnae,
            (select pg_catalog.left(cn.description, 120) from ref.cnaes cn where cn.code = e.main_cnae),
            e.state_code, e.municipality_id, v_source, v_date, 'legitimate_interest')
    returning id into v_company;
    v_created_company := true;
  end if;

  insert into public.leads (tenant_id, company_id, industry_id, status, source, source_date)
  values (p_tenant, v_company, p_industry, 'new', 'Prospecção automática por CNAE e território: ' || v_source, v_date)
  on conflict (tenant_id, company_id, industry_id) do nothing
  returning id into v_lead;
  if v_lead is null then
    select l.id into v_lead from public.leads l
     where l.tenant_id = p_tenant and l.company_id = v_company and l.industry_id = p_industry;
  else
    v_created_lead := true;
  end if;

  v_email := lower(nullif(pg_catalog.btrim(coalesce(p_email, e.email, '')), ''));
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'e-mail inválido' using errcode = '23514';
  end if;
  v_phone := app.normalize_phone(coalesce(nullif(pg_catalog.btrim(coalesce(p_phone, '')), ''), e.phones[1]));

  if v_email is not null or v_phone is not null then
    select ct.id into v_contact from public.contacts ct
     where ct.tenant_id = p_tenant and ct.company_id = v_company
       and ((v_email is not null and lower(ct.email) = v_email)
            or (v_phone is not null and app.normalize_phone(ct.phone) = v_phone))
     order by ct.created_at limit 1;
    if v_contact is null then
      insert into public.contacts (tenant_id, company_id, name, email, phone, source, source_date,
                                   legal_basis, purposes, legal_basis_note)
      values (p_tenant, v_company, 'Contato institucional', v_email, v_phone,
              case when p_email is not null or p_phone is not null
                   then v_source || ', corrigido manualmente' else v_source end,
              v_date, 'legitimate_interest', array['prospecting']::public.contact_purpose[],
              'Prospecção B2B para ' || coalesce(v_industry_name, 'indústria representada')
                || ': empresa com CNAE ' || e.main_cnae || ' compatível, no território atendido; '
                || 'contato institucional publicado no CNPJ. Oposição pode ser feita a qualquer momento.')
      on conflict do nothing
      returning id into v_contact;
      if v_contact is null and v_email is not null then
        -- e-mail já usado por contato de outra empresa do tenant: não duplica
        select ct.id into v_contact from public.contacts ct where ct.tenant_id = p_tenant and lower(ct.email) = v_email;
      end if;
    elsif p_email is not null or p_phone is not null then
      update public.contacts ct
         set email = coalesce(v_email, ct.email), phone = coalesce(v_phone, ct.phone)
       where ct.tenant_id = p_tenant and ct.id = v_contact;
    end if;
  end if;

  if v_created_company or v_created_lead then
    perform app.audit_prospect_added(p_tenant, v_lead, e.dataset_ref, v_created_company);
  end if;

  return jsonb_build_object('company_id', v_company, 'lead_id', v_lead, 'contact_id', v_contact,
                            'company_created', v_created_company, 'lead_created', v_created_lead);
end;
$$;
revoke all on function public.prospect_add(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.prospect_add(uuid, uuid, text, text, text) to authenticated;
