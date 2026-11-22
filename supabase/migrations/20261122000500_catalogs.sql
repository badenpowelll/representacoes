-- Fase 1 (parte 3): catálogos, versões e produtos; armazenamento privado por tenant.
-- Arquivos ficam no bucket privado "catalogs" sob o prefixo "<tenant_id>/".

create type public.catalog_version_status as enum ('draft', 'processing', 'published', 'archived');

create table public.catalogs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  industry_id  uuid not null,
  title        text not null check (length(btrim(title)) between 2 and 300),
  category     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade
);
create index catalogs_industry_idx on public.catalogs (tenant_id, industry_id);
select app.tenant_table_policies('public.catalogs',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

create table public.catalog_versions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  catalog_id      uuid not null,
  version         integer not null check (version > 0),
  status          public.catalog_version_status not null default 'draft',
  storage_path    text not null,
  file_sha256     text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type       text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  size_bytes      bigint check (size_bytes between 1 and 52428800),
  extracted_text  text,           -- dado NÃO confiável (vem do PDF)
  valid_from      date,
  valid_until     date,
  published_at    timestamptz,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (catalog_id, version),
  foreign key (tenant_id, catalog_id) references public.catalogs (tenant_id, id) on delete cascade,
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (status <> 'published' or published_at is not null),
  -- o arquivo precisa estar sob o prefixo do próprio tenant
  check (storage_path like tenant_id::text || '/%')
);
select app.tenant_table_policies('public.catalog_versions',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  industry_id         uuid not null,
  catalog_version_id  uuid,
  sku                 text not null check (length(btrim(sku)) between 1 and 100),
  name                text not null check (length(btrim(name)) between 1 and 300),
  category            text,
  description         text check (length(description) <= 8000),
  metadata            jsonb not null default '{}'::jsonb,
  -- Somente preços autorizados pela indústria; o agente nunca inventa preço.
  authorized_price    numeric(14,2) check (authorized_price is null or authorized_price >= 0),
  price_valid_until   date,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, industry_id, sku),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, catalog_version_id) references public.catalog_versions (tenant_id, id) on delete set null (catalog_version_id)
);
create index products_tenant_category_idx on public.products (tenant_id, category);
select app.tenant_table_policies('public.products',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

-- ---------------------------------------------------------------------------
-- Storage privado (somente quando o schema storage existir: Supabase ou stub)
-- ---------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('catalogs', 'catalogs', false, 52428800, array['application/pdf'])
    on conflict (id) do update set public = false;

    create or replace function app.storage_tenant(p_name text)
    returns uuid
    language plpgsql
    immutable
    set search_path = ''
    as $f$
    begin
      return (storage.foldername(p_name))[1]::uuid;
    exception when others then
      return null;
    end;
    $f$;

    create policy catalogs_objects_select on storage.objects for select to authenticated
      using (bucket_id = 'catalogs' and app.is_member(app.storage_tenant(name)));
    create policy catalogs_objects_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'catalogs'
        and app.has_role(app.storage_tenant(name), array['tenant_admin','manager']::public.tenant_role[]));
    create policy catalogs_objects_update on storage.objects for update to authenticated
      using (bucket_id = 'catalogs'
        and app.has_role(app.storage_tenant(name), array['tenant_admin','manager']::public.tenant_role[]))
      with check (bucket_id = 'catalogs'
        and app.has_role(app.storage_tenant(name), array['tenant_admin','manager']::public.tenant_role[]));
    create policy catalogs_objects_delete on storage.objects for delete to authenticated
      using (bucket_id = 'catalogs'
        and app.has_role(app.storage_tenant(name), array['tenant_admin','manager']::public.tenant_role[]));
  end if;
end
$do$;
