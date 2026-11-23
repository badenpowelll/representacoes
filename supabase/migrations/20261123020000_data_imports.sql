-- ---------------------------------------------------------------------------
-- Importação de planilhas (clientes e tabela de preços) — ADR 0009
--
-- Cada importação vira um registro em public.data_imports com o lote inteiro:
-- arquivo (nome e hash), origem do dado, base legal e finalidades (LGPD) para
-- clientes; indústria, origem e referência do documento de preços para
-- produtos. As linhas criadas ou atualizadas guardam import_id, para rastrear
-- de onde veio cada dado. O relatório de erros guarda só número da linha,
-- coluna e motivo, nunca o conteúdo da célula (minimização).
-- ---------------------------------------------------------------------------
create type public.data_import_kind as enum ('companies', 'products');
create type public.data_import_status as enum ('running', 'completed', 'failed');

create table public.data_imports (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  kind              public.data_import_kind not null,
  status            public.data_import_status not null default 'running',
  file_name         text not null check (length(btrim(file_name)) between 1 and 255),
  file_sha256       text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  -- Origem do dado (LGPD) ou, em produtos, origem do preço.
  source            text not null check (length(btrim(source)) between 2 and 300),
  source_date       date,
  -- Clientes: base legal e finalidades do lote.
  legal_basis       public.legal_basis,
  legal_basis_note  text check (legal_basis_note is null or length(legal_basis_note) <= 2000),
  purposes          public.contact_purpose[] not null default '{}',
  -- Produtos: indústria e documento dos preços.
  industry_id       uuid,
  price_reference   text check (price_reference is null or length(btrim(price_reference)) between 2 and 300),
  options           jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(options) = 'object'),
  total_rows        integer not null default 0 check (total_rows between 0 and 20000),
  created_count     integer not null default 0 check (created_count >= 0),
  updated_count     integer not null default 0 check (updated_count >= 0),
  unchanged_count   integer not null default 0 check (unchanged_count >= 0),
  error_count       integer not null default 0 check (error_count >= 0),
  contacts_created  integer not null default 0 check (contacts_created >= 0),
  -- [{ "row": 12, "column": "CNPJ", "message": "CNPJ inválido" }]
  errors            jsonb not null default '[]'::jsonb
                    check (pg_catalog.jsonb_typeof(errors) = 'array' and pg_catalog.jsonb_array_length(errors) <= 1000),
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, industry_id) references public.industries (tenant_id, id) on delete set null (industry_id),
  check (kind <> 'companies' or legal_basis is not null),
  check (kind <> 'companies' or legal_basis in ('legitimate_interest', 'contract')),
  check (legal_basis is distinct from 'legitimate_interest' or length(coalesce(legal_basis_note, '')) >= 20),
  check (legal_basis is distinct from 'contract' or length(coalesce(legal_basis_note, '')) >= 5),
  check (kind <> 'companies' or cardinality(purposes) > 0),
  check (kind <> 'products' or price_reference is not null),
  check ((status = 'running') = (finished_at is null))
);
create index data_imports_tenant_idx on public.data_imports (tenant_id, kind, created_at desc);

alter table public.data_imports enable row level security;
alter table public.data_imports force row level security;

-- Clientes: quem escreve no CRM. Produtos/preços: só quem escreve no catálogo.
create or replace function app.can_import(p_tenant uuid, p_kind public.data_import_kind)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(p_tenant, case p_kind
    when 'products' then array['tenant_admin','manager']::public.tenant_role[]
    else array['tenant_admin','manager','representative','assistant']::public.tenant_role[]
  end);
$$;
revoke all on function app.can_import(uuid, public.data_import_kind) from public;
grant execute on function app.can_import(uuid, public.data_import_kind) to authenticated;

create policy data_imports_select on public.data_imports for select to authenticated
  using (app.is_member(tenant_id));
create policy data_imports_insert on public.data_imports for insert to authenticated
  with check (app.can_import(tenant_id, kind));
create policy data_imports_update on public.data_imports for update to authenticated
  using (app.can_import(tenant_id, kind) and status = 'running')
  with check (app.can_import(tenant_id, kind));
-- Sem delete: o histórico de importações é trilha de auditoria.
revoke all on public.data_imports from public, anon, authenticated;
grant select, insert, update on public.data_imports to authenticated;

create or replace function app.data_import_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Autor e situação inicial definidos pelo servidor.
    new.created_by := auth.uid();
    new.status := 'running';
    new.finished_at := null;
    new.created_count := 0; new.updated_count := 0; new.unchanged_count := 0;
    new.error_count := 0; new.contacts_created := 0; new.errors := '[]'::jsonb;
  else
    -- O lote (arquivo, origem, base legal, indústria) não muda depois de criado.
    if new.kind is distinct from old.kind
       or new.file_name is distinct from old.file_name
       or new.file_sha256 is distinct from old.file_sha256
       or new.source is distinct from old.source
       or new.source_date is distinct from old.source_date
       or new.legal_basis is distinct from old.legal_basis
       or new.legal_basis_note is distinct from old.legal_basis_note
       or new.purposes is distinct from old.purposes
       or new.industry_id is distinct from old.industry_id
       or new.price_reference is distinct from old.price_reference
       or new.options is distinct from old.options
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'os dados do lote de importação não podem ser alterados'
        using errcode = '23514', constraint = 'data_imports_immutable';
    end if;
    -- Contadores só crescem.
    if new.created_count < old.created_count or new.updated_count < old.updated_count
       or new.unchanged_count < old.unchanged_count or new.error_count < old.error_count
       or new.contacts_created < old.contacts_created then
      raise exception 'contadores da importação não podem diminuir'
        using errcode = '23514', constraint = 'data_imports_counters';
    end if;
    if new.status <> 'running' and old.status = 'running' then
      new.finished_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger data_imports_guard before insert or update on public.data_imports
  for each row execute function app.data_import_guard();
create trigger data_imports_updated_at before update on public.data_imports
  for each row execute function app.set_updated_at();
create trigger data_imports_tenant_lock before update on public.data_imports
  for each row execute function app.prevent_tenant_change();

-- Conclusão vai para a auditoria (só números, sem dados pessoais).
create or replace function app.data_import_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'running' and old.status = 'running' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, metadata)
    values (new.tenant_id, auth.uid(), 'data_import.' || new.status::text, 'data_imports', new.id,
      pg_catalog.jsonb_build_object(
        'kind', new.kind, 'total_rows', new.total_rows, 'created', new.created_count,
        'updated', new.updated_count, 'unchanged', new.unchanged_count, 'errors', new.error_count,
        'contacts_created', new.contacts_created));
  end if;
  return new;
end;
$$;
create trigger data_imports_audit after update of status on public.data_imports
  for each row execute function app.data_import_audit();

-- Rastreio: de qual importação veio a linha (última que a criou ou alterou).
alter table public.companies add column import_id uuid;
alter table public.companies add constraint companies_import_fk
  foreign key (tenant_id, import_id) references public.data_imports (tenant_id, id) on delete set null (import_id);
alter table public.contacts add column import_id uuid;
alter table public.contacts add constraint contacts_import_fk
  foreign key (tenant_id, import_id) references public.data_imports (tenant_id, id) on delete set null (import_id);
alter table public.products add column import_id uuid;
alter table public.products add constraint products_import_fk
  foreign key (tenant_id, import_id) references public.data_imports (tenant_id, id) on delete set null (import_id);
create index companies_import_idx on public.companies (tenant_id, import_id) where import_id is not null;
create index products_import_idx on public.products (tenant_id, import_id) where import_id is not null;
