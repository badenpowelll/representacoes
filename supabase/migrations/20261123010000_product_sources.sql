-- Sincronização de produtos a partir do site da indústria (ADR 0008).
--
-- Cada indústria pode ter uma ou mais "fontes de produtos" (URL da página de
-- produtos do site oficial). Um robô (scripts/sincronizar-produtos.mjs, GitHub
-- Actions) abre a página, extrai a lista e chama app.sync_product_source(),
-- que, de forma atômica:
--   * cadastra produtos novos (sem preço: o site não é tabela de preços);
--   * atualiza nome/categoria/foto e a data da última coleta;
--   * marca como inativo (motivo removed_from_source) o que sumiu do site;
--   * reativa o que voltou, mas nunca um produto desativado à mão;
--   * não muda nada se a coleta vier vazia ou com menos da metade dos
--     produtos ativos da fonte (site fora do ar ou mudou de layout).
-- As colunas de origem só são gravadas por essa função; o usuário não as forja.

create table public.product_sources (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  industry_id   uuid not null,
  url           text not null check (url ~ '^https?://[^\s/]+' and length(url) <= 1000),
  label         text check (label is null or length(btrim(label)) between 1 and 120),
  -- Regex opcional para reconhecer links de produto quando a detecção automática falhar.
  link_pattern  text check (link_pattern is null or length(link_pattern) between 1 and 300),
  active        boolean not null default true,
  last_run_at   timestamptz,
  last_status   text check (last_status in ('ok', 'skipped_safety', 'error')),
  last_message  text check (last_message is null or length(last_message) <= 2000),
  last_found    integer,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, industry_id, url),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade
);
select app.tenant_table_policies('public.product_sources',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager']::public.tenant_role[]);

-- Situação da última coleta é do robô, não do usuário.
create or replace function app.product_source_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.last_run_at := null; new.last_status := null; new.last_message := null; new.last_found := null;
    new.created_by := auth.uid();
  else
    new.last_run_at := old.last_run_at; new.last_status := old.last_status;
    new.last_message := old.last_message; new.last_found := old.last_found;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger product_sources_guard before insert or update on public.product_sources
  for each row execute function app.product_source_guard();

alter table public.products
  add column source_id            uuid,
  add column source_key           text check (source_key is null or length(source_key) between 1 and 300),
  add column source_url           text check (source_url is null or length(source_url) <= 1000),
  add column image_url            text check (image_url is null or length(image_url) <= 1000),
  add column source_first_seen_at timestamptz,
  add column source_seen_at       timestamptz,
  add column inactive_reason      text check (inactive_reason in ('manual', 'removed_from_source')),
  add column inactive_since       timestamptz,
  -- Fichas publicadas na página do produto (FT, FDS...): [{"kind","label","url"}].
  add column source_documents     jsonb not null default '[]'::jsonb check (jsonb_typeof(source_documents) = 'array'),
  add column details_fetched_at   timestamptz,
  add constraint products_source_fk foreign key (tenant_id, source_id)
    references public.product_sources (tenant_id, id) on delete set null (source_id),
  add constraint products_source_key_unique unique (tenant_id, source_id, source_key);

-- Usuário não grava colunas de origem; ativar/desativar à mão registra o motivo.
create or replace function app.product_source_columns_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;  -- robô/serviço (app.sync_product_source)
  end if;
  if tg_op = 'INSERT' then
    new.source_id := null; new.source_key := null; new.source_url := null; new.image_url := null;
    new.source_first_seen_at := null; new.source_seen_at := null;
    new.source_documents := '[]'::jsonb; new.details_fetched_at := null;
    new.inactive_reason := case when new.active then null else 'manual' end;
    new.inactive_since := case when new.active then null else now() end;
    return new;
  end if;
  new.source_id := old.source_id; new.source_key := old.source_key; new.source_url := old.source_url;
  new.image_url := old.image_url; new.source_first_seen_at := old.source_first_seen_at;
  new.source_seen_at := old.source_seen_at;
  new.source_documents := old.source_documents; new.details_fetched_at := old.details_fetched_at;
  if new.active is distinct from old.active then
    new.inactive_reason := case when new.active then null else 'manual' end;
    new.inactive_since := case when new.active then null else now() end;
  else
    new.inactive_reason := old.inactive_reason; new.inactive_since := old.inactive_since;
  end if;
  return new;
end $$;
create trigger products_source_columns_guard before insert or update on public.products
  for each row execute function app.product_source_columns_guard();

create table public.product_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  source_id    uuid not null,
  started_at   timestamptz not null default now(),
  status       text not null check (status in ('ok', 'skipped_safety', 'error')),
  found        integer not null default 0,
  added        integer not null default 0,
  updated      integer not null default 0,
  reactivated  integer not null default 0,
  deactivated  integer not null default 0,
  message      text check (message is null or length(message) <= 2000),
  foreign key (tenant_id, source_id) references public.product_sources (tenant_id, id) on delete cascade
);
create index product_sync_runs_idx on public.product_sync_runs (tenant_id, source_id, started_at desc);
alter table public.product_sync_runs enable row level security;
alter table public.product_sync_runs force row level security;
create policy product_sync_runs_select on public.product_sync_runs for select to authenticated
  using (app.is_member(tenant_id));
revoke all on public.product_sync_runs from public, anon, authenticated;
grant select on public.product_sync_runs to authenticated;

-- Registra uma coleta que falhou (site fora do ar, robots.txt, nada encontrado).
create or replace function app.record_product_source_failure(p_source uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.product_sources;
begin
  select * into s from public.product_sources where id = p_source;
  if not found then raise exception 'fonte inexistente' using errcode = 'P0002'; end if;
  insert into public.product_sync_runs (tenant_id, source_id, status, message)
  values (s.tenant_id, s.id, 'error', left(p_message, 2000));
  update public.product_sources
     set last_run_at = now(), last_status = 'error', last_message = left(p_message, 2000)
   where id = s.id;
end $$;

-- p_items: [{"key","name","url","category","image_url","sku",
--            "details": true|false, "description", "documents": [{"kind","label","url"}]}].
-- "details" = a página do produto foi lida (só quando o robots.txt permite);
-- sem ela, descrição e fichas existentes são mantidas.
create or replace function app.sync_product_source(p_source uuid, p_items jsonb, p_min_ratio numeric default 0.5)
returns public.product_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.product_sources;
  run      public.product_sync_runs;
  v_found  integer;
  v_prev   integer;
  v_added  integer := 0;
  v_upd    integer := 0;
  v_react  integer := 0;
  v_deact  integer := 0;
  it       record;
  existing public.products;
  v_sku    text;
begin
  select * into s from public.product_sources where id = p_source for update;
  if not found then raise exception 'fonte inexistente' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'itens devem ser uma lista' using errcode = '22023';
  end if;

  -- Normaliza e deduplica pela chave.
  create temporary table if not exists pg_temp.sync_items (
    key text primary key, name text not null, url text, category text, image_url text,
    has_details boolean not null default false, description text, documents jsonb, sku text
  ) on commit drop;
  truncate pg_temp.sync_items;
  insert into pg_temp.sync_items (key, name, url, category, image_url, has_details, description, documents, sku)
  select distinct on (k) k, n, u, c, i, hd, d, docs, sk
    from (
      select left(btrim(e->>'key'), 300) k,
             left(regexp_replace(btrim(e->>'name'), '\s+', ' ', 'g'), 300) n,
             nullif(left(btrim(e->>'url'), 1000), '') u,
             nullif(left(btrim(e->>'category'), 120), '') c,
             nullif(left(btrim(e->>'image_url'), 1000), '') i,
             coalesce((e->>'details')::boolean, false) hd,
             nullif(left(btrim(e->>'sku'), 100), '') sk,
             nullif(left(btrim(e->>'description'), 8000), '') d,
             (select coalesce(jsonb_agg(jsonb_build_object(
                        'kind', left(coalesce(nullif(btrim(doc->>'kind'), ''), 'outro'), 20),
                        'label', left(coalesce(nullif(btrim(doc->>'label'), ''), 'Documento'), 120),
                        'url', left(doc->>'url', 1000))), '[]'::jsonb)
                from jsonb_array_elements(case when jsonb_typeof(e->'documents') = 'array' then e->'documents' else '[]'::jsonb end) doc
               where doc->>'url' ~ '^https?://') docs
        from jsonb_array_elements(p_items) e
       where jsonb_typeof(e) = 'object'
    ) x
   where k <> '' and n <> ''
   order by k;
  select count(*) into v_found from pg_temp.sync_items;
  select count(*) into v_prev from public.products
   where tenant_id = s.tenant_id and source_id = s.id and active;

  if v_found = 0 or (v_prev >= 4 and v_found < ceil(v_prev * p_min_ratio)) then
    insert into public.product_sync_runs (tenant_id, source_id, status, found, message)
    values (s.tenant_id, s.id, case when v_found = 0 then 'error' else 'skipped_safety' end, v_found,
            case when v_found = 0 then 'Nenhum produto encontrado na página; nada foi alterado.'
                 else format('Encontrados %s produtos, mas havia %s ativos. Por segurança nada foi alterado.', v_found, v_prev) end)
    returning * into run;
    update public.product_sources
       set last_run_at = now(), last_status = run.status, last_message = run.message, last_found = v_found
     where id = s.id;
    return run;
  end if;

  for it in select * from pg_temp.sync_items loop
    select * into existing from public.products
     where tenant_id = s.tenant_id and source_id = s.id and source_key = it.key;
    if found then
      update public.products p
         set name = it.name,
             category = coalesce(it.category, p.category),
             source_url = it.url,
             image_url = coalesce(it.image_url, p.image_url),
             source_seen_at = now(),
             description = case when it.has_details then coalesce(it.description, p.description) else p.description end,
             source_documents = case when it.has_details then it.documents else p.source_documents end,
             details_fetched_at = case when it.has_details then now() else p.details_fetched_at end,
             active = case when p.inactive_reason = 'removed_from_source' then true else p.active end,
             inactive_reason = case when p.inactive_reason = 'removed_from_source' then null else p.inactive_reason end,
             inactive_since = case when p.inactive_reason = 'removed_from_source' then null else p.inactive_since end
       where p.id = existing.id;
      -- SKU real publicado pelo site substitui o provisório, se estiver livre.
      if it.sku is not null and existing.sku like 'SITE-%' and existing.sku <> it.sku
         and not exists (select 1 from public.products where tenant_id = s.tenant_id and industry_id = s.industry_id and sku = it.sku) then
        update public.products set sku = it.sku where id = existing.id;
      end if;
      if existing.inactive_reason = 'removed_from_source' then
        v_react := v_react + 1;
      elsif existing.name is distinct from it.name
            or existing.source_url is distinct from it.url
            or (it.category is not null and existing.category is distinct from it.category) then
        v_upd := v_upd + 1;
      end if;
    else
      -- SKU do site quando publicado; senão um provisório (SITE-...).
      v_sku := case when it.sku is not null then it.sku
                    when it.key ~ '^[A-Za-z0-9._-]{1,60}$' then 'SITE-' || it.key
                    else 'SITE-' || upper(left(md5(s.id::text || it.key), 12)) end;
      if exists (select 1 from public.products where tenant_id = s.tenant_id and industry_id = s.industry_id and sku = v_sku) then
        v_sku := 'SITE-' || upper(left(md5(s.id::text || it.key), 12));
      end if;
      insert into public.products (tenant_id, industry_id, sku, name, category, description, metadata,
                                   source_id, source_key, source_url, image_url,
                                   source_first_seen_at, source_seen_at, source_documents, details_fetched_at)
      values (s.tenant_id, s.industry_id, v_sku, it.name, it.category, it.description,
              jsonb_build_object('origem', 'site da indústria'),
              s.id, it.key, it.url, it.image_url, now(), now(),
              case when it.has_details then it.documents else '[]'::jsonb end,
              case when it.has_details then now() end);
      v_added := v_added + 1;
    end if;
  end loop;

  with gone as (
    update public.products p
       set active = false, inactive_reason = 'removed_from_source', inactive_since = now()
     where p.tenant_id = s.tenant_id and p.source_id = s.id and p.active
       and not exists (select 1 from pg_temp.sync_items i where i.key = p.source_key)
    returning 1
  )
  select count(*) into v_deact from gone;

  insert into public.product_sync_runs (tenant_id, source_id, status, found, added, updated, reactivated, deactivated)
  values (s.tenant_id, s.id, 'ok', v_found, v_added, v_upd, v_react, v_deact)
  returning * into run;
  update public.product_sources
     set last_run_at = now(), last_status = 'ok', last_message = null, last_found = v_found
   where id = s.id;
  insert into public.audit_logs (tenant_id, action, entity, entity_id, metadata)
  values (s.tenant_id, 'product_source.sync', 'product_sources', s.id,
          jsonb_build_object('found', v_found, 'added', v_added, 'updated', v_upd,
                             'reactivated', v_react, 'deactivated', v_deact));
  return run;
end $$;

revoke all on function app.sync_product_source(uuid, jsonb, numeric) from public, anon, authenticated;
revoke all on function app.record_product_source_failure(uuid, text) from public, anon, authenticated;
