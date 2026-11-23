-- ---------------------------------------------------------------------------
-- Dados cadastrais de CNPJ (Receita Federal, via BrasilAPI)
--
-- Um registro por (tenant, CNPJ): a última consulta feita pela representação.
-- Fica isolado por tenant (RLS) como qualquer outro dado privado, mesmo sendo
-- informação pública na origem, porque registra o que *esta* representação
-- consultou e quando. Ver ADR 0006.
--
-- O quadro societário (QSA) traz nomes de pessoas físicas e CPF mascarado
-- pela própria Receita. Base legal: dados tornados manifestamente públicos
-- (LGPD art. 7º, §§ 3º e 4º), usados só para qualificação comercial da
-- empresa. Nunca vira contato de prospecção automaticamente.
-- ---------------------------------------------------------------------------
create table public.cnpj_registry (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  cnpj                text not null check (cnpj ~ '^[0-9]{14}$'),
  provider            text not null default 'brasilapi' check (provider in ('brasilapi')),
  fetched_at          timestamptz not null default now(),
  fetched_by          uuid references auth.users (id) on delete set null,
  legal_name          text not null check (length(btrim(legal_name)) between 1 and 300),
  trade_name          text check (length(trade_name) <= 300),
  registration_status text check (length(registration_status) <= 60),
  status_date         date,
  status_reason       text check (length(status_reason) <= 200),
  opened_on           date,
  legal_nature        text check (length(legal_nature) <= 200),
  company_size        text check (length(company_size) <= 60),
  share_capital       numeric(18, 2),
  main_cnae           text check (main_cnae is null or main_cnae ~ '^[0-9]{7}$'),
  main_cnae_description text check (length(main_cnae_description) <= 300),
  secondary_cnaes     jsonb not null default '[]' check (jsonb_typeof(secondary_cnaes) = 'array'),
  address             jsonb not null default '{}' check (jsonb_typeof(address) = 'object'),
  state_code          char(2) references ref.states (code),
  municipality_id     integer references ref.municipalities (ibge_code),
  phones              text[] not null default '{}' check (app.all_match(phones, '^[0-9]{10,11}$')),
  email               text check (length(email) <= 300),
  partners            jsonb not null default '[]' check (jsonb_typeof(partners) = 'array'),
  simples_opt_in      boolean,
  mei_opt_in          boolean,
  is_headquarters     boolean,
  raw                 jsonb not null check (jsonb_typeof(raw) = 'object'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, cnpj),
  unique (tenant_id, id)
);
create index cnpj_registry_tenant_fetched_idx on public.cnpj_registry (tenant_id, fetched_at desc);

comment on table public.cnpj_registry is
  'Última consulta de CNPJ por representação (Receita Federal via BrasilAPI). Dados públicos na origem, privados por tenant aqui.';
comment on column public.cnpj_registry.partners is
  'QSA como publicado pela Receita (nome, qualificação, CPF mascarado, faixa etária). Não usar para comunicação.';

-- Leitura: qualquer papel. Escrita: quem cadastra empresas ou indústrias.
select app.tenant_table_policies('public.cnpj_registry',
  array['tenant_admin', 'manager', 'representative', 'assistant', 'viewer']::public.tenant_role[],
  array['tenant_admin', 'manager', 'representative', 'assistant']::public.tenant_role[]);

-- O município, quando informado, tem de pertencer à UF.
create or replace function app.cnpj_registry_municipality_matches_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.municipality_id is not null and not exists (
    select 1 from ref.municipalities m where m.ibge_code = new.municipality_id and m.state_code = new.state_code
  ) then
    -- Dado externo inconsistente: guarda sem município em vez de falhar a consulta.
    new.municipality_id := null;
  end if;
  return new;
end;
$$;
create trigger cnpj_registry_municipality_state before insert or update on public.cnpj_registry
  for each row execute function app.cnpj_registry_municipality_matches_state();
