-- Prospecção manual: cadastra (ou reaproveita, pelo CNPJ) a empresa e cria o
-- lead numa única transação, sempre com fonte e data da fonte (não inventar).
-- SECURITY INVOKER: as políticas RLS de companies e leads continuam valendo.

create or replace function public.register_prospect(
  p_tenant        uuid,
  p_industry      uuid,
  p_legal_name    text,
  p_source        text,
  p_source_date   date,
  p_cnpj          text default null,
  p_cnae          text default null,
  p_state         char(2) default null,
  p_municipality  integer default null,
  p_segment       text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company uuid;
  v_existed boolean := false;
  v_lead uuid;
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_source, ''))) < 2 then
    raise exception 'informe a fonte do dado' using errcode = '23514';
  end if;
  if p_source_date is null or p_source_date > current_date then
    raise exception 'data da fonte inválida' using errcode = '23514';
  end if;

  if p_cnpj is not null then
    select c.id into v_company from public.companies c where c.tenant_id = p_tenant and c.cnpj = p_cnpj;
    v_existed := found;
  end if;

  if v_company is null then
    insert into public.companies (tenant_id, kind, legal_name, cnpj, cnae, segment, state_code, municipality_id,
                                  source, source_date, legal_basis)
    values (p_tenant, 'prospect', pg_catalog.btrim(p_legal_name), p_cnpj, p_cnae, p_segment, p_state, p_municipality,
            pg_catalog.btrim(p_source), p_source_date, 'legitimate_interest')
    returning id into v_company;
  end if;

  insert into public.leads (tenant_id, company_id, industry_id, status, source, source_date)
  values (p_tenant, v_company, p_industry, 'new', pg_catalog.btrim(p_source), p_source_date)
  on conflict (tenant_id, company_id, industry_id) do nothing
  returning id into v_lead;

  if v_lead is null then
    raise exception 'já existe um lead desta empresa para esta indústria' using errcode = '23505';
  end if;

  return pg_catalog.jsonb_build_object('company_id', v_company, 'lead_id', v_lead, 'company_existed', v_existed);
end;
$$;
revoke all on function public.register_prospect(uuid, uuid, text, text, date, text, text, char, integer, text) from public, anon;
grant execute on function public.register_prospect(uuid, uuid, text, text, date, text, text, char, integer, text) to authenticated;
