-- Fase 1 (parte 2): CRM — empresas (clientes/prospects), contatos, consentimentos
-- e lista de supressão (bloqueios de comunicação / opt-out). LGPD: base legal e
-- origem do dado registradas.

create type public.company_kind as enum ('customer', 'prospect');
create type public.legal_basis as enum (
  'consent',              -- consentimento
  'legitimate_interest',  -- legítimo interesse (B2B)
  'contract',             -- execução de contrato
  'legal_obligation'
);

create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  kind             public.company_kind not null default 'prospect',
  legal_name       text not null check (length(btrim(legal_name)) between 2 and 300),
  trade_name       text,
  cnpj             text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  cnae             text check (cnae is null or cnae ~ '^[0-9]{7}$'),
  segment          text,
  state_code       char(2) references ref.states (code),
  municipality_id  integer references ref.municipalities (ibge_code),
  owner_membership_id uuid,                  -- responsável
  source           text,                     -- origem do dado (ex.: "Receita Federal - dados abertos")
  source_date      date,
  legal_basis      public.legal_basis,
  notes            text check (length(notes) <= 8000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, owner_membership_id) references public.memberships (tenant_id, id) on delete set null (owner_membership_id)
);
-- Deduplicação por CNPJ dentro do tenant.
create unique index companies_tenant_cnpj_key on public.companies (tenant_id, cnpj) where cnpj is not null;
create index companies_tenant_state_cnae_idx on public.companies (tenant_id, state_code, cnae);
create index companies_tenant_kind_idx on public.companies (tenant_id, kind, created_at desc);

create trigger companies_municipality_state before insert or update on public.companies
  for each row when (new.municipality_id is not null)
  execute function app.territory_municipality_matches_state();

select app.tenant_table_policies('public.companies',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative','assistant']::public.tenant_role[]);

create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  company_id    uuid not null,
  name          text not null check (length(btrim(name)) between 1 and 200),
  role_title    text,
  email         text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone         text,
  preferences   jsonb not null default '{}'::jsonb,
  source        text,
  source_date   date,
  legal_basis   public.legal_basis,
  consent_at    timestamptz,          -- quando aplicável
  opted_out_at  timestamptz,          -- oposição registrada
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  check (legal_basis is distinct from 'consent' or consent_at is not null)
);
create unique index contacts_tenant_email_key on public.contacts (tenant_id, lower(email)) where email is not null;
create index contacts_company_idx on public.contacts (tenant_id, company_id);

select app.tenant_table_policies('public.contacts',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative','assistant']::public.tenant_role[]);

-- Lista de supressão: e-mails/domínios que nunca devem receber comunicação do tenant.
create table public.suppression_list (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  email       text,
  domain      text,
  reason      text not null check (reason in ('opt_out', 'bounce', 'complaint', 'manual', 'legal')),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((email is not null) <> (domain is not null)),
  check (domain is null or domain ~* '^[a-z0-9.-]+\.[a-z]{2,}$')
);
create unique index suppression_email_key on public.suppression_list (tenant_id, lower(email)) where email is not null;
create unique index suppression_domain_key on public.suppression_list (tenant_id, lower(domain)) where domain is not null;

-- Qualquer membro com escrita pode bloquear; só admin/gerente pode desbloquear.
alter table public.suppression_list enable row level security;
alter table public.suppression_list force row level security;
create policy suppression_select on public.suppression_list for select to authenticated
  using (app.is_member(tenant_id));
create policy suppression_insert on public.suppression_list for insert to authenticated
  with check (app.has_role(tenant_id, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]));
create policy suppression_delete on public.suppression_list for delete to authenticated
  using (app.has_role(tenant_id, array['tenant_admin','manager']::public.tenant_role[]));
create trigger suppression_updated_at before update on public.suppression_list
  for each row execute function app.set_updated_at();
revoke all on public.suppression_list from anon;
grant select, insert, delete on public.suppression_list to authenticated;

-- Opt-out de um contato entra automaticamente na lista de supressão.
create or replace function app.contact_opt_out_to_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.opted_out_at is not null and new.email is not null
     and (tg_op = 'INSERT' or old.opted_out_at is null) then
    insert into public.suppression_list (tenant_id, email, reason, created_by)
    values (new.tenant_id, lower(new.email), 'opt_out', auth.uid())
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger contacts_opt_out after insert or update of opted_out_at on public.contacts
  for each row execute function app.contact_opt_out_to_suppression();

-- Verificação usada por campanhas/agente antes de qualquer envio.
create or replace function public.is_suppressed(p_tenant uuid, p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_member(p_tenant) then
    raise exception 'sem acesso a esta representação' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.suppression_list s
    where s.tenant_id = p_tenant
      and (lower(s.email) = lower(p_email)
           or lower(s.domain) = lower(pg_catalog.split_part(p_email, '@', 2)))
  );
end;
$$;
revoke all on function public.is_suppressed(uuid, text) from public, anon;
grant execute on function public.is_suppressed(uuid, text) to authenticated;
