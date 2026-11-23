-- ---------------------------------------------------------------------------
-- Painel da prospecção e status de contato (ideias do Portal Argos, só com
-- dados reais): cada empresa mostra o último contato (e-mail, WhatsApp,
-- ligação ou reunião registrados no histórico) e as buscas filtram por
-- contatadas / não contatadas. prospect_dashboard resume os números.
-- ---------------------------------------------------------------------------

create index if not exists activities_company_contact_idx
  on public.activities (tenant_id, company_id, created_at desc)
  where kind in ('email', 'whatsapp', 'call', 'meeting');

-- Localização aproximada pelo CEP (dado público de referência, sem tenant).
-- precision: 'cep' (centro do CEP) ou 'municipio' (CEP genérico: centro da cidade).
create table ref.cep_locations (
  cep         text primary key check (cep ~ '^[0-9]{8}$'),
  latitude    double precision check (latitude between -34 and 6),
  longitude   double precision check (longitude between -75 and -28),
  precision   text not null check (precision in ('cep', 'municipio', 'nao_encontrado')),
  source      text not null,
  fetched_at  timestamptz not null default now(),
  check ((precision = 'nao_encontrado') = (latitude is null))
);
alter table ref.cep_locations enable row level security;
-- Sem políticas: leitura só pelas funções de busca (SECURITY DEFINER).

drop function if exists public.prospect_search(uuid, uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer);
drop function if exists public.prospect_search_mix(uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer);

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
  p_offset            integer default 0,
  p_contact           text default null
)
returns table (
  cnpj text, legal_name text, trade_name text, is_headquarters boolean, opened_on date,
  main_cnae text, main_cnae_description text, company_size text,
  state_code char(2), municipality_id integer, municipality_name text, district text,
  phones text[], email text, dataset_ref text,
  company_id uuid, lead_id uuid, email_suppressed boolean, phone_suppressed boolean,
  last_contact_at timestamptz, last_contact_kind text, contact_count integer,
  zip_code text, street text, street_number text, latitude double precision, longitude double precision, location_precision text,
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
         lc.at, lc.kind, coalesce(lc.n, 0),
         x.zip_code, x.street, x.number, g.latitude, g.longitude, nullif(g.precision, 'nao_encontrado'),
         count(*) over ()
    from enriched x
    left join ref.cnaes cn on cn.code = x.main_cnae
    left join ref.municipalities m on m.ibge_code = x.municipality_id
    left join lateral (
      select max(a.created_at) as at,
             (array_agg(a.kind::text order by a.created_at desc))[1] as kind,
             count(*)::integer as n
        from public.activities a
       where a.tenant_id = p_tenant and a.company_id = x.c_id
         and a.kind in ('email', 'whatsapp', 'call', 'meeting')
    ) lc on x.c_id is not null
    left join ref.cep_locations g on g.cep = x.zip_code
   where (not p_hide_in_portfolio or x.l_id is null)
     and (p_contact is null or (p_contact = 'sim') = (lc.at is not null))
   order by (x.l_id is not null), (x.email is null), x.legal_name, x.cnpj
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.prospect_search(uuid, uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer, text) from public, anon;
grant execute on function public.prospect_search(uuid, uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer, text) to authenticated;

create or replace function public.prospect_search_mix(
  p_tenant            uuid,
  p_municipality      integer default null,
  p_query             text default null,
  p_with_email        boolean default false,
  p_with_phone        boolean default false,
  p_include_secondary boolean default false,
  p_hide_in_portfolio boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_contact           text default null
)
returns table (
  cnpj text, legal_name text, trade_name text, is_headquarters boolean, opened_on date,
  main_cnae text, main_cnae_description text, company_size text,
  state_code char(2), municipality_id integer, municipality_name text, district text,
  phones text[], email text, dataset_ref text,
  company_id uuid, industries jsonb, industry_count integer, linked_count integer,
  email_suppressed boolean, phone_suppressed boolean,
  last_contact_at timestamptz, last_contact_kind text, contact_count integer,
  zip_code text, street text, street_number text, latitude double precision, longitude double precision, location_precision text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all text[];
  v_q text := nullif(pg_catalog.btrim(coalesce(p_query, '')), '');
begin
  if not app.is_member(p_tenant) then
    raise exception 'sem acesso a esta representação' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct c), '{}') into v_all
    from public.industries i, pg_catalog.unnest(i.target_cnaes) c
   where i.tenant_id = p_tenant and i.active;
  if cardinality(v_all) = 0 then
    return;
  end if;

  return query
  with hits as (
    select e.*, f.inds, f.n::integer as n, f.n_linked::integer as n_linked, f.c_id
      from ref.cnpj_establishments e
      cross join lateral (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', i.id, 'name', i.name, 'lead_id', l.id) order by i.name) as inds,
               count(*) as n, count(l.id) as n_linked, max(c.id::text)::uuid as c_id
          from public.industries i
          left join public.companies c on c.tenant_id = p_tenant and c.cnpj = e.cnpj
          left join public.leads l on l.tenant_id = p_tenant and l.company_id = c.id and l.industry_id = i.id
         where i.tenant_id = p_tenant and i.active
           and (e.main_cnae = any (i.target_cnaes) or (p_include_secondary and e.secondary_cnaes && i.target_cnaes))
           and exists (
             select 1 from public.territories t
              where t.tenant_id = p_tenant and t.industry_id = i.id and t.state_code = e.state_code
                and (t.municipality_id is null or t.municipality_id = e.municipality_id))
      ) f
     where (e.main_cnae = any (v_all) or (p_include_secondary and e.secondary_cnaes && v_all))
       and f.n > 0
       and (p_municipality is null or e.municipality_id = p_municipality)
       and (not p_with_email or e.email is not null)
       and (not p_with_phone or cardinality(e.phones) > 0)
       and (not p_hide_in_portfolio or f.n_linked < f.n)
       and (v_q is null
            or e.legal_name ilike '%' || v_q || '%'
            or e.trade_name ilike '%' || v_q || '%'
            or e.cnpj = pg_catalog.regexp_replace(v_q, '[^0-9]', '', 'g'))
  ),
  enriched as (
    select h.*,
           (h.email is not null and exists (
              select 1 from public.suppression_list s where s.tenant_id = p_tenant
                and (lower(s.email) = lower(h.email) or lower(s.domain) = lower(pg_catalog.split_part(h.email, '@', 2))))) as e_sup,
           (cardinality(h.phones) > 0 and exists (
              select 1 from public.suppression_list s where s.tenant_id = p_tenant and s.phone = any (h.phones))) as p_sup
      from hits h
  )
  select x.cnpj, x.legal_name, x.trade_name, x.is_headquarters, x.opened_on,
         x.main_cnae, cn.description, x.company_size,
         x.state_code, x.municipality_id, coalesce(m.name, x.municipality_name), x.district,
         case when x.p_sup then '{}'::text[] else x.phones end,
         case when x.e_sup then null else x.email end,
         x.dataset_ref, x.c_id, x.inds, x.n, x.n_linked, x.e_sup, x.p_sup,
         lc.at, lc.kind, coalesce(lc.n, 0),
         x.zip_code, x.street, x.number, g.latitude, g.longitude, nullif(g.precision, 'nao_encontrado'),
         count(*) over ()
    from enriched x
    left join ref.cnaes cn on cn.code = x.main_cnae
    left join ref.municipalities m on m.ibge_code = x.municipality_id
    left join lateral (
      select max(a.created_at) as at,
             (array_agg(a.kind::text order by a.created_at desc))[1] as kind,
             count(*)::integer as n
        from public.activities a
       where a.tenant_id = p_tenant and a.company_id = x.c_id
         and a.kind in ('email', 'whatsapp', 'call', 'meeting')
    ) lc on x.c_id is not null
    left join ref.cep_locations g on g.cep = x.zip_code
   where p_contact is null or (p_contact = 'sim') = (lc.at is not null)
   order by (x.n_linked = x.n), x.n desc, (x.email is null), x.legal_name, x.cnpj
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.prospect_search_mix(uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer, text) from public, anon;
grant execute on function public.prospect_search_mix(uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer, text) to authenticated;
