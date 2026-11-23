-- ---------------------------------------------------------------------------
-- Site e canais de contato próprios de indústrias e empresas
--
-- Ficam na própria entidade, separados da consulta à Receita
-- (public.cnpj_registry): uma nova consulta à Receita nunca altera estas
-- colunas, o que o usuário editou fica. Cada canal tem tipo (telefone,
-- WhatsApp, e-mail, endereço, outro), rótulo livre (Comercial, Licitações,
-- Financeiro...) e origem: 'receita' (igual ao dado da Receita ao salvar) ou
-- 'manual'. São canais institucionais da empresa; dados de pessoas continuam
-- em public.contacts, com base legal própria.
-- ---------------------------------------------------------------------------
create or replace function app.valid_contact_channels(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p) = 'array'
     and pg_catalog.jsonb_array_length(p) <= 50
     and coalesce((
       select bool_and(
         pg_catalog.jsonb_typeof(c) = 'object'
         and (c ->> 'kind') in ('phone', 'whatsapp', 'email', 'address', 'other')
         and pg_catalog.length(pg_catalog.btrim(coalesce(c ->> 'value', ''))) between 1 and 300
         and pg_catalog.length(coalesce(c ->> 'label', '')) <= 60
         and (c ->> 'source') in ('receita', 'manual')
         and ((c ->> 'kind') <> 'email' or (c ->> 'value') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
       )
       from pg_catalog.jsonb_array_elements(p) c
     ), true)
$$;

create type public.contact_info_source as enum ('receita', 'manual');

alter table public.industries
  add column contact_channels jsonb not null default '[]' check (app.valid_contact_channels(contact_channels)),
  add column website_source   public.contact_info_source;

alter table public.companies
  add column website          text check (website is null or (length(website) <= 300 and website ~* '^https?://')),
  add column website_source   public.contact_info_source,
  add column contact_channels jsonb not null default '[]' check (app.valid_contact_channels(contact_channels));

-- Origem do site coerente com o valor, qualquer que seja o caminho de escrita
-- (a Receita não informa site: sem origem informada conta como 'manual').
create or replace function app.website_source_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.website_source := case when new.website is null then null else coalesce(new.website_source, 'manual') end;
  return new;
end;
$$;
create trigger industries_website_source before insert or update on public.industries
  for each row execute function app.website_source_sync();
create trigger companies_website_source before insert or update on public.companies
  for each row execute function app.website_source_sync();

update public.industries set website_source = 'manual' where website is not null;
