-- Integridade de catálogos (parecer 002: P1 de catálogos e P2 de produto/indústria).

-- 1) Versões são imutáveis quanto ao arquivo: caminho, hash, tamanho, catálogo e
--    número da versão não mudam depois de criados. Só o status/vigência evoluem.
create or replace function app.catalog_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.storage_path is distinct from old.storage_path
     or new.file_sha256 is distinct from old.file_sha256
     or new.size_bytes is distinct from old.size_bytes
     or new.catalog_id is distinct from old.catalog_id
     or new.version is distinct from old.version
     or new.mime_type is distinct from old.mime_type then
    raise exception 'o arquivo de uma versão de catálogo é imutável; crie uma nova versão' using errcode = '42501';
  end if;
  if old.status in ('published', 'archived') and new.status in ('draft', 'processing') then
    raise exception 'versão publicada não volta para rascunho' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger catalog_versions_immutable before update on public.catalog_versions
  for each row execute function app.catalog_version_immutable();

-- Versão publicada/arquivada não pode ser excluída (mantém rastreabilidade).
create or replace function app.catalog_version_no_delete_published()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published', 'archived') then
    raise exception 'versão publicada não pode ser excluída; arquive-a' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger catalog_versions_no_delete before delete on public.catalog_versions
  for each row execute function app.catalog_version_no_delete_published();

-- 2) Storage: nenhum UPDATE de objeto; DELETE só de objeto que nenhuma versão referencia.
do $do$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    drop policy if exists catalogs_objects_update on storage.objects;
    drop policy if exists catalogs_objects_delete on storage.objects;

    create or replace function app.catalog_object_referenced(p_name text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $f$
      select exists (select 1 from public.catalog_versions v where v.storage_path = p_name);
    $f$;
    revoke all on function app.catalog_object_referenced(text) from public;
    grant execute on function app.catalog_object_referenced(text) to authenticated;

    create policy catalogs_objects_delete on storage.objects for delete to authenticated
      using (bucket_id = 'catalogs'
        and app.has_role(app.storage_tenant(name), array['tenant_admin','manager']::public.tenant_role[])
        and not app.catalog_object_referenced(name));

    -- Reconciliação: objetos do tenant sem versão associada há mais de 1 hora.
    create or replace function public.orphan_catalog_objects(p_tenant uuid)
    returns table (name text, created_at timestamptz)
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $f$
    begin
      if not app.has_role(p_tenant, array['tenant_admin','manager']::public.tenant_role[]) then
        raise exception 'sem permissão' using errcode = '42501';
      end if;
      return query
        select o.name, o.created_at from storage.objects o
        where o.bucket_id = 'catalogs'
          and app.storage_tenant(o.name) = p_tenant
          and o.created_at < now() - interval '1 hour'
          and not exists (select 1 from public.catalog_versions v where v.storage_path = o.name)
        order by o.created_at;
    end;
    $f$;
    revoke all on function public.orphan_catalog_objects(uuid) from public, anon;
    grant execute on function public.orphan_catalog_objects(uuid) to authenticated;
  end if;
end
$do$;

-- 3) Produto só pode apontar para versão de catálogo da MESMA indústria.
create or replace function app.product_version_same_industry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.catalog_version_id is not null and not exists (
    select 1 from public.catalog_versions v
    join public.catalogs c on c.tenant_id = v.tenant_id and c.id = v.catalog_id
    where v.tenant_id = new.tenant_id and v.id = new.catalog_version_id and c.industry_id = new.industry_id
  ) then
    raise exception 'a versão de catálogo pertence a outra indústria' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger products_version_same_industry before insert or update of catalog_version_id, industry_id on public.products
  for each row execute function app.product_version_same_industry();

-- Catálogo não troca de indústria depois de ter versões (evita burlar a regra acima).
create or replace function app.catalog_industry_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.industry_id is distinct from old.industry_id
     and exists (select 1 from public.catalog_versions v where v.catalog_id = old.id) then
    raise exception 'catálogo com versões não pode mudar de indústria' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger catalogs_industry_locked before update of industry_id on public.catalogs
  for each row execute function app.catalog_industry_locked();
