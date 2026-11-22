-- Fase 1 (parte 1): contexto comercial, indústrias representadas, acordos e territórios.
-- Dados globais de referência (UFs, municípios) ficam no schema "ref", separados
-- dos dados privados de cada tenant.

-- ---------------------------------------------------------------------------
-- Referência global (somente leitura para usuários)
-- ---------------------------------------------------------------------------
create schema if not exists ref;
grant usage on schema ref to authenticated, service_role;

create table ref.states (
  code        char(2) primary key check (code ~ '^[A-Z]{2}$'),
  ibge_code   smallint not null unique,
  name        text not null,
  region      text not null check (region in ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul'))
);

create table ref.municipalities (
  ibge_code   integer primary key,
  state_code  char(2) not null references ref.states (code),
  name        text not null
);
create index municipalities_state_idx on ref.municipalities (state_code, name);

alter table ref.states enable row level security;
alter table ref.municipalities enable row level security;
create policy states_read on ref.states for select to authenticated using (true);
create policy municipalities_read on ref.municipalities for select to authenticated using (true);
grant select on ref.states, ref.municipalities to authenticated;

insert into ref.states (code, ibge_code, name, region) values
  ('RO',11,'Rondônia','Norte'),('AC',12,'Acre','Norte'),('AM',13,'Amazonas','Norte'),
  ('RR',14,'Roraima','Norte'),('PA',15,'Pará','Norte'),('AP',16,'Amapá','Norte'),
  ('TO',17,'Tocantins','Norte'),('MA',21,'Maranhão','Nordeste'),('PI',22,'Piauí','Nordeste'),
  ('CE',23,'Ceará','Nordeste'),('RN',24,'Rio Grande do Norte','Nordeste'),('PB',25,'Paraíba','Nordeste'),
  ('PE',26,'Pernambuco','Nordeste'),('AL',27,'Alagoas','Nordeste'),('SE',28,'Sergipe','Nordeste'),
  ('BA',29,'Bahia','Nordeste'),('MG',31,'Minas Gerais','Sudeste'),('ES',32,'Espírito Santo','Sudeste'),
  ('RJ',33,'Rio de Janeiro','Sudeste'),('SP',35,'São Paulo','Sudeste'),('PR',41,'Paraná','Sul'),
  ('SC',42,'Santa Catarina','Sul'),('RS',43,'Rio Grande do Sul','Sul'),
  ('MS',50,'Mato Grosso do Sul','Centro-Oeste'),('MT',51,'Mato Grosso','Centro-Oeste'),
  ('GO',52,'Goiás','Centro-Oeste'),('DF',53,'Distrito Federal','Centro-Oeste');

-- ---------------------------------------------------------------------------
-- Helper: aplica o padrão de tabela de tenant (RLS, triggers, unique(tenant_id,id))
-- ---------------------------------------------------------------------------
create or replace function app.tenant_table_policies(
  p_table regclass,
  p_read public.tenant_role[],
  p_write public.tenant_role[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t text := p_table::text;
  n text := pg_catalog.replace(pg_catalog.replace(p_table::text, 'public.', ''), '.', '_');
begin
  execute pg_catalog.format('alter table %s enable row level security', t);
  execute pg_catalog.format('alter table %s force row level security', t);
  execute pg_catalog.format(
    'create policy %I on %s for select to authenticated using (app.has_role(tenant_id, %L::public.tenant_role[]))',
    n || '_select', t, p_read);
  execute pg_catalog.format(
    'create policy %I on %s for insert to authenticated with check (app.has_role(tenant_id, %L::public.tenant_role[]))',
    n || '_insert', t, p_write);
  execute pg_catalog.format(
    'create policy %I on %s for update to authenticated using (app.has_role(tenant_id, %L::public.tenant_role[])) with check (app.has_role(tenant_id, %L::public.tenant_role[]))',
    n || '_update', t, p_write, p_write);
  execute pg_catalog.format(
    'create policy %I on %s for delete to authenticated using (app.has_role(tenant_id, %L::public.tenant_role[]))',
    n || '_delete', t, p_write);
  execute pg_catalog.format('create trigger %I before update on %s for each row execute function app.set_updated_at()', n || '_updated_at', t);
  execute pg_catalog.format('create trigger %I before update on %s for each row execute function app.prevent_tenant_change()', n || '_tenant_lock', t);
  execute pg_catalog.format('revoke all on %s from anon', t);
  execute pg_catalog.format('grant select, insert, update, delete on %s to authenticated', t);
end;
$$;
revoke all on function app.tenant_table_policies(regclass, public.tenant_role[], public.tenant_role[]) from public;

-- Para FKs compostas (tenant_id, id) a partir de tabelas filhas.
alter table public.memberships add constraint memberships_tenant_id_id_key unique (tenant_id, id);

create or replace function app.all_match(p_values text[], p_pattern text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(v ~ p_pattern), true) from pg_catalog.unnest(p_values) v;
$$;

-- ---------------------------------------------------------------------------
-- Contexto comercial (1 por tenant)
-- ---------------------------------------------------------------------------
create table public.commercial_contexts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null unique references public.tenants (id) on delete cascade,
  segments           text[] not null default '{}',
  cnaes              text[] not null default '{}' check (app.all_match(cnaes, '^[0-9]{7}$')),
  ideal_customer     text check (length(ideal_customer) <= 4000),
  differentiators    text check (length(differentiators) <= 4000),
  restrictions       text check (length(restrictions) <= 4000),
  communication_tone text check (length(communication_tone) <= 1000),
  goals              text check (length(goals) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
select app.tenant_table_policies('public.commercial_contexts',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

-- ---------------------------------------------------------------------------
-- Indústrias / empresas representadas
-- ---------------------------------------------------------------------------
create table public.industries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 200),
  cnpj        text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  segment     text,
  website     text check (website is null or website ~* '^https?://'),
  notes       text check (length(notes) <= 4000),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index industries_tenant_cnpj_key on public.industries (tenant_id, cnpj) where cnpj is not null;
create unique index industries_tenant_name_key on public.industries (tenant_id, lower(name));
select app.tenant_table_policies('public.industries',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

create table public.industry_contacts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  industry_id  uuid not null,
  name         text not null,
  role_title   text,
  email        text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade
);
create index industry_contacts_industry_idx on public.industry_contacts (tenant_id, industry_id);
select app.tenant_table_policies('public.industry_contacts',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

-- Condições comerciais do contrato de representação com a indústria.
create table public.representation_agreements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  industry_id      uuid not null,
  commission_pct   numeric(5,2) check (commission_pct between 0 and 100),
  payment_terms    text,
  exclusive        boolean not null default false,
  valid_from       date not null,
  valid_until      date,
  notes            text check (length(notes) <= 4000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  check (valid_until is null or valid_until >= valid_from),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade
);
create index representation_agreements_industry_idx on public.representation_agreements (tenant_id, industry_id, valid_from desc);
select app.tenant_table_policies('public.representation_agreements',
  array['tenant_admin','manager']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

-- ---------------------------------------------------------------------------
-- Territórios: cobertura por indústria, UF/município e representante
-- ---------------------------------------------------------------------------
create table public.territories (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  industry_id      uuid not null,
  state_code       char(2) not null references ref.states (code),
  municipality_id  integer references ref.municipalities (ibge_code),
  membership_id    uuid,              -- representante responsável (opcional)
  exclusive        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id) on delete set null (membership_id)
);
create unique index territories_unique_scope
  on public.territories (tenant_id, industry_id, state_code, coalesce(municipality_id, 0), coalesce(membership_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index territories_state_idx on public.territories (tenant_id, state_code);

-- Município precisa pertencer à UF informada.
create or replace function app.territory_municipality_matches_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.municipality_id is not null and not exists (
    select 1 from ref.municipalities m where m.ibge_code = new.municipality_id and m.state_code = new.state_code
  ) then
    raise exception 'município não pertence à UF informada' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger territories_municipality_state before insert or update on public.territories
  for each row execute function app.territory_municipality_matches_state();

select app.tenant_table_policies('public.territories',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);
