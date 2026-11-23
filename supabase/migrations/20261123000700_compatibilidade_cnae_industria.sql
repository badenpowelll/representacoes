-- ---------------------------------------------------------------------------
-- Compatibilidade: o CNAE-alvo passa a valer também pelos CNAEs da própria
-- indústria (cadastrados na Prospecção), além dos CNAEs do contexto comercial.
-- Antes só o contexto contava, e uma indústria com CNAEs próprios recebia
-- nota menor do que devia. Mesma regra e pontuação; só a origem do CNAE muda.
-- ---------------------------------------------------------------------------
create or replace function public.compute_matches(p_tenant uuid, p_industry uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative']::public.tenant_role[]) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;

  with ctx as (
    select coalesce(cc.cnaes, '{}') as cnaes, coalesce(cc.segments, '{}') as segments
    from (select 1) one
    left join public.commercial_contexts cc on cc.tenant_id = p_tenant
  ),
  ind as (
    select i.id, i.segment, i.target_cnaes from public.industries i
    where i.tenant_id = p_tenant and i.id = p_industry and i.active
  ),
  scored as (
    select
      c.id as company_id,
      array_remove(array[
        pg_catalog.jsonb_build_object('criterion', 'territory', 'points', 40, 'detail', 'Cobertura na UF ' || c.state_code),
        case when c.cnae = any (ctx.cnaes || ind.target_cnaes) then
          pg_catalog.jsonb_build_object('criterion', 'cnae', 'points', 30, 'detail', 'CNAE ' || c.cnae || ' é alvo') end,
        case when c.segment is not null and (lower(c.segment) = lower(ind.segment)
             or lower(c.segment) = any (select lower(s) from pg_catalog.unnest(ctx.segments) s)) then
          pg_catalog.jsonb_build_object('criterion', 'segment', 'points', 20, 'detail', 'Segmento ' || c.segment) end,
        case when exists (
          select 1 from public.contacts ct
          where ct.tenant_id = p_tenant and ct.company_id = c.id and ct.email is not null and ct.opted_out_at is null
            and not exists (
              select 1 from public.suppression_list s
              where s.tenant_id = p_tenant
                and (lower(s.email) = lower(ct.email) or lower(s.domain) = lower(pg_catalog.split_part(ct.email, '@', 2)))
            )
        ) then pg_catalog.jsonb_build_object('criterion', 'reachable', 'points', 10, 'detail', 'Contato com e-mail apto') end
      ], null) as reasons
    from public.companies c
    cross join ctx
    cross join ind
    where c.tenant_id = p_tenant
      and c.state_code is not null
      and exists (
        select 1 from public.territories t
        where t.tenant_id = p_tenant and t.industry_id = ind.id and t.state_code = c.state_code
          and (t.municipality_id is null or t.municipality_id = c.municipality_id)
      )
  ),
  upserted as (
    insert into public.matches (tenant_id, company_id, industry_id, score, reasons, computed_at)
    select p_tenant, s.company_id, p_industry,
      (select coalesce(sum((r ->> 'points')::int), 0) from pg_catalog.unnest(s.reasons) r)::smallint,
      pg_catalog.to_jsonb(s.reasons), now()
    from scored s
    on conflict (tenant_id, company_id, industry_id) do update
      set score = excluded.score, reasons = excluded.reasons, computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end;
$$;
revoke all on function public.compute_matches(uuid, uuid) from public, anon;
grant execute on function public.compute_matches(uuid, uuid) to authenticated;
