-- ---------------------------------------------------------------------------
-- Mix de indústrias por cliente: uma empresa pode comprar de várias indústrias
-- representadas. A prospecção mostra, para cada empresa, TODAS as indústrias
-- compatíveis (CNAE-alvo + território) e leva à carteira com um lead por
-- indústria. A ficha da empresa mostra o encaixe com cada indústria.
-- O vínculo cliente × indústria continua sendo o lead (unique por par).
-- ---------------------------------------------------------------------------

-- Indústrias ativas do tenant compatíveis com um estabelecimento da base pública.
create or replace function app.compatible_industries(p_tenant uuid, p_cnpj text, p_include_secondary boolean default false)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
    from ref.cnpj_establishments e
    join public.industries i on i.tenant_id = p_tenant and i.active
   where app.is_member(p_tenant)
     and e.cnpj = p_cnpj
     and (e.main_cnae = any (i.target_cnaes) or (p_include_secondary and e.secondary_cnaes && i.target_cnaes))
     and exists (
       select 1 from public.territories t
        where t.tenant_id = p_tenant and t.industry_id = i.id and t.state_code = e.state_code
          and (t.municipality_id is null or t.municipality_id = e.municipality_id))
   order by i.name;
$$;
revoke all on function app.compatible_industries(uuid, text, boolean) from public;
grant execute on function app.compatible_industries(uuid, text, boolean) to authenticated;

-- Busca em todas as indústrias de uma vez.
create or replace function public.prospect_search_mix(
  p_tenant            uuid,
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
  company_id uuid, industries jsonb, industry_count integer, linked_count integer,
  email_suppressed boolean, phone_suppressed boolean,
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
         count(*) over ()
    from enriched x
    left join ref.cnaes cn on cn.code = x.main_cnae
    left join ref.municipalities m on m.ibge_code = x.municipality_id
   order by (x.n_linked = x.n), x.n desc, (x.email is null), x.legal_name, x.cnpj
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.prospect_search_mix(uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.prospect_search_mix(uuid, integer, text, boolean, boolean, boolean, boolean, integer, integer) to authenticated;

-- Leva a empresa à carteira com um lead para cada indústria compatível (ou só
-- para as escolhidas, entre as compatíveis). SECURITY INVOKER: usa prospect_add.
create or replace function public.prospect_add_mix(
  p_tenant            uuid,
  p_cnpj              text,
  p_industries        uuid[] default null,
  p_email             text default null,
  p_phone             text default null,
  p_include_secondary boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ind uuid;
  r jsonb;
  v_company uuid;
  v_contact uuid;
  v_created integer := 0;
  v_linked uuid[] := '{}';
begin
  for v_ind in select app.compatible_industries(p_tenant, p_cnpj, p_include_secondary) loop
    continue when p_industries is not null and not (v_ind = any (p_industries));
    r := public.prospect_add(p_tenant, v_ind, p_cnpj, p_email, p_phone);
    v_company := (r ->> 'company_id')::uuid;
    v_contact := coalesce(v_contact, (r ->> 'contact_id')::uuid);
    if (r ->> 'lead_created')::boolean then v_created := v_created + 1; end if;
    v_linked := v_linked || v_ind;
  end loop;
  if v_company is null then
    raise exception 'empresa sem indústria compatível no seu território' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object('company_id', v_company, 'contact_id', v_contact,
    'leads_created', v_created, 'industries', pg_catalog.to_jsonb(v_linked));
end;
$$;
revoke all on function public.prospect_add_mix(uuid, text, uuid[], text, text, boolean) from public, anon;
grant execute on function public.prospect_add_mix(uuid, text, uuid[], text, text, boolean) to authenticated;

-- Encaixe de uma empresa da carteira com cada indústria (para a ficha do cliente).
create or replace function public.company_industry_fit(p_tenant uuid, p_company uuid)
returns table (
  industry_id uuid, industry_name text, cnae_match boolean, territory_match boolean,
  lead_id uuid, lead_status public.lead_status
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.name,
         c.cnae is not null and c.cnae = any (i.target_cnaes),
         c.state_code is not null and exists (
           select 1 from public.territories t
            where t.tenant_id = p_tenant and t.industry_id = i.id and t.state_code = c.state_code
              and (t.municipality_id is null or t.municipality_id = c.municipality_id)),
         l.id, l.status
    from public.companies c
    join public.industries i on i.tenant_id = c.tenant_id and i.active
    left join public.leads l on l.tenant_id = c.tenant_id and l.company_id = c.id and l.industry_id = i.id
   where c.tenant_id = p_tenant and c.id = p_company
   order by (l.id is null), i.name;
$$;
revoke all on function public.company_industry_fit(uuid, uuid) from public, anon;
grant execute on function public.company_industry_fit(uuid, uuid) to authenticated;
