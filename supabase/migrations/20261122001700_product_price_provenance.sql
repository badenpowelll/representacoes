-- Parecer 004-complemento, P1-5: preço autorizado verificável e elegibilidade
-- centralizada de produtos para comunicação comercial.
--
-- Preço só existe com origem e referência documental. Quem autorizou e quando
-- é gravado pelo servidor (auth.uid()/now()), não pelo cliente. Toda mudança
-- de preço vai para product_price_history (somente leitura para o tenant).
-- public.product_eligibility(...) é a fonte única para campanhas e agente: só
-- produto ativo, com preço autorizado, vigência definida e não vencida (data
-- comercial em America/Sao_Paulo) e procedência completa é elegível.

alter table public.products
  add column price_source         text check (price_source is null or length(btrim(price_source)) between 2 and 300),
  add column price_reference      text check (price_reference is null or length(btrim(price_reference)) between 2 and 300),
  add column price_authorized_by  uuid references auth.users (id) on delete set null,
  add column price_authorized_at  timestamptz;

create table public.product_price_history (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  product_id        uuid not null,
  authorized_price  numeric(14,2),
  price_valid_until date,
  price_source      text,
  price_reference   text,
  changed_by        uuid references auth.users (id) on delete set null,
  changed_at        timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index product_price_history_idx on public.product_price_history (tenant_id, product_id, changed_at desc);
alter table public.product_price_history enable row level security;
alter table public.product_price_history force row level security;
create policy product_price_history_select on public.product_price_history for select to authenticated
  using (app.is_member(tenant_id));
revoke all on public.product_price_history from public, anon, authenticated;
grant select on public.product_price_history to authenticated;

create or replace function app.product_price_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.authorized_price is not distinct from old.authorized_price
     and new.price_valid_until is not distinct from old.price_valid_until
     and new.price_source is not distinct from old.price_source
     and new.price_reference is not distinct from old.price_reference then
    -- Preço inalterado: preserva quem autorizou (o cliente não pode reescrever).
    new.price_authorized_by := old.price_authorized_by;
    new.price_authorized_at := old.price_authorized_at;
    return new;
  end if;
  if new.authorized_price is null then
    if new.price_valid_until is not null then
      raise exception 'vigência sem preço autorizado' using errcode = '23514', constraint = 'products_validity_requires_price';
    end if;
    new.price_source := null;
    new.price_reference := null;
    new.price_authorized_by := null;
    new.price_authorized_at := null;
  else
    if new.price_source is null or new.price_reference is null then
      raise exception 'preço autorizado exige origem e referência do documento'
        using errcode = '23514', constraint = 'products_price_provenance';
    end if;
    new.price_authorized_by := auth.uid();
    new.price_authorized_at := now();
  end if;
  return new;
end $$;

create trigger products_price_provenance
  before insert or update on public.products
  for each row execute function app.product_price_provenance();

create or replace function app.product_price_history_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.authorized_price is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.authorized_price is not distinct from old.authorized_price
     and new.price_valid_until is not distinct from old.price_valid_until
     and new.price_source is not distinct from old.price_source
     and new.price_reference is not distinct from old.price_reference then
    return new;
  end if;
  insert into public.product_price_history
    (tenant_id, product_id, authorized_price, price_valid_until, price_source, price_reference, changed_by)
  values (new.tenant_id, new.id, new.authorized_price, new.price_valid_until, new.price_source, new.price_reference, auth.uid());
  return new;
end $$;

create trigger products_price_history
  after insert or update on public.products
  for each row execute function app.product_price_history_log();

-- Data comercial (fuso do Brasil) usada para vigência.
create or replace function app.commercial_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
$$;
grant execute on function app.commercial_today() to authenticated;

create or replace function public.product_eligibility(
  p_tenant   uuid,
  p_industry uuid default null,
  p_on       date default null
)
returns table (product_id uuid, eligible boolean, reason text, authorized_price numeric, price_valid_until date)
language sql
stable
set search_path = ''
as $$
  select p.id,
         r.reason is null,
         r.reason,
         case when r.reason is null then p.authorized_price end,
         case when r.reason is null then p.price_valid_until end
    from public.products p
    cross join lateral (
      select case
        when not p.active then 'inactive'
        when p.authorized_price is null then 'no_price'
        when p.price_valid_until is null then 'no_validity'
        when p.price_valid_until < coalesce(p_on, app.commercial_today()) then 'price_expired'
        when p.price_source is null or p.price_reference is null
             or p.price_authorized_at is null then 'no_provenance'
        else null
      end as reason
    ) r
   where p.tenant_id = p_tenant
     and (p_industry is null or p.industry_id = p_industry);
$$;
revoke all on function public.product_eligibility(uuid, uuid, date) from public, anon;
grant execute on function public.product_eligibility(uuid, uuid, date) to authenticated;
