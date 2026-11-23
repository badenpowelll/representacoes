-- Fase 1 (parte 4): leads, motor de compatibilidade (score explicável),
-- funil comercial (deals) e atividades.

create type public.lead_status as enum ('new', 'qualified', 'discarded');
create type public.deal_stage as enum ('new', 'qualified', 'contact', 'negotiation', 'proposal', 'won', 'lost');
create type public.match_review as enum ('pending', 'approved', 'rejected');
create type public.activity_kind as enum ('note', 'call', 'email', 'meeting', 'task', 'follow_up', 'stage_change');

-- Lead = oportunidade de prospecção (empresa × indústria), com origem registrada.
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  company_id   uuid not null,
  industry_id  uuid not null,
  status       public.lead_status not null default 'new',
  source       text not null,           -- não inventar: sempre registrar de onde veio
  source_date  date not null default current_date,
  owner_membership_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, company_id, industry_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, owner_membership_id) references public.memberships (tenant_id, id) on delete set null (owner_membership_id)
);
select app.tenant_table_policies('public.leads',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative','assistant']::public.tenant_role[]);

-- Resultado do motor de compatibilidade, sempre sujeito a revisão humana.
create table public.matches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  company_id   uuid not null,
  industry_id  uuid not null,
  score        smallint not null check (score between 0 and 100),
  reasons      jsonb not null,          -- [{ "criterion": ..., "points": ..., "detail": ... }]
  review       public.match_review not null default 'pending',
  reviewed_by  uuid references auth.users (id) on delete set null,
  reviewed_at  timestamptz,
  computed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, company_id, industry_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete cascade
);
create index matches_tenant_score_idx on public.matches (tenant_id, industry_id, score desc);
select app.tenant_table_policies('public.matches',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative']::public.tenant_role[]);

create table public.deals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  company_id     uuid not null,
  industry_id    uuid,
  lead_id        uuid,
  title          text not null check (length(btrim(title)) between 2 and 300),
  stage          public.deal_stage not null default 'new',
  amount         numeric(14,2) check (amount is null or amount >= 0),
  lost_reason    text,
  owner_membership_id uuid,
  expected_close date,
  closed_at      timestamptz,
  position       integer not null default 0,   -- ordem no Kanban
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete set null (industry_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, owner_membership_id) references public.memberships (tenant_id, id) on delete set null (owner_membership_id),
  check (stage <> 'lost' or length(btrim(coalesce(lost_reason, ''))) > 0)
);
create index deals_board_idx on public.deals (tenant_id, stage, position);
select app.tenant_table_policies('public.deals',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative']::public.tenant_role[]);

create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  kind          public.activity_kind not null,
  company_id    uuid,
  deal_id       uuid,
  subject       text not null check (length(btrim(subject)) between 1 and 300),
  body          text check (length(body) <= 8000),
  due_at        timestamptz,
  done_at       timestamptz,
  actor_id      uuid references auth.users (id) on delete set null default auth.uid(),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade,
  check (company_id is not null or deal_id is not null)
);
create index activities_deal_idx on public.activities (tenant_id, deal_id, created_at desc);
create index activities_due_idx on public.activities (tenant_id, due_at) where done_at is null;
select app.tenant_table_policies('public.activities',
  array['tenant_admin','manager','representative','assistant','viewer']::public.tenant_role[],
  array['tenant_admin','manager','representative','assistant']::public.tenant_role[]);

-- Histórico automático de mudança de etapa e data de fechamento.
create or replace function app.deal_stage_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage in ('won', 'lost') and old.stage not in ('won', 'lost') then
    new.closed_at := now();
  elsif new.stage not in ('won', 'lost') then
    new.closed_at := null;
  end if;
  if new.stage is distinct from old.stage then
    insert into public.activities (tenant_id, kind, deal_id, company_id, subject, metadata)
    values (new.tenant_id, 'stage_change', new.id, new.company_id,
      'Etapa alterada', pg_catalog.jsonb_build_object('from', old.stage, 'to', new.stage, 'lost_reason', new.lost_reason));
  end if;
  return new;
end;
$$;
create trigger deals_stage_history before update of stage on public.deals
  for each row execute function app.deal_stage_history();

-- ---------------------------------------------------------------------------
-- Motor de compatibilidade (regra explicável, versão 1)
--   +40 território: a indústria tem cobertura na UF da empresa (obrigatório)
--   +30 CNAE da empresa está entre os CNAEs-alvo do contexto comercial
--   +20 segmento da empresa igual ao da indústria ou a um segmento-alvo
--   +10 empresa com contato com e-mail e sem supressão
-- Empresas sem cobertura territorial ou totalmente suprimidas não geram match.
-- Revisões humanas já feitas (approved/rejected) são preservadas.
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
    select i.id, i.segment from public.industries i
    where i.tenant_id = p_tenant and i.id = p_industry and i.active
  ),
  scored as (
    select
      c.id as company_id,
      array_remove(array[
        pg_catalog.jsonb_build_object('criterion', 'territory', 'points', 40, 'detail', 'Cobertura na UF ' || c.state_code),
        case when c.cnae = any (ctx.cnaes) then
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
