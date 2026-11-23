-- Parecer 004-complemento, P1-2/3/4: direitos do titular e base legal no banco.
--
-- 1. Base legal com finalidade e justificativa, exigidas por trigger em INSERT e
--    quando a base/finalidade muda. Não há padrão: B2B não autoriza por si só.
--    (Trigger e não CHECK para que a oposição de um contato antigo, sem esses
--    campos, nunca seja bloqueada.)
-- 2. Oposição e exclusão por RPC: verificam papel, empresa e linhas afetadas,
--    falham de forma explícita e gravam auditoria minimizada (sem e-mail/nome).
--    A exclusão mantém o e-mail na supressão (reason 'legal') para que um
--    recadastro não volte a ser contatado.
-- 3. Elegibilidade calculada no servidor, completa e fail-closed:
--    public.contact_eligibility(...) devolve, por contato, se pode receber
--    comunicação por um canal/finalidade e o motivo quando não pode.

create type public.contact_purpose as enum (
  'prospecting',          -- prospecção comercial
  'customer_relationship',-- relacionamento com cliente
  'catalog_distribution', -- divulgação de catálogos
  'support'               -- atendimento/pós-venda
);

alter table public.contacts
  add column purposes          public.contact_purpose[] not null default '{}',
  add column legal_basis_note  text check (legal_basis_note is null or length(legal_basis_note) <= 2000),
  add column consent_evidence  text check (consent_evidence is null or length(consent_evidence) <= 1000);

create or replace function app.contact_lawful_basis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.legal_basis is null then
    raise exception 'informe a base legal do contato' using errcode = '23514', constraint = 'contacts_legal_basis_required';
  end if;
  if coalesce(cardinality(new.purposes), 0) = 0 then
    raise exception 'informe a finalidade do tratamento' using errcode = '23514', constraint = 'contacts_purpose_required';
  end if;
  if new.source is null or length(btrim(new.source)) < 2 then
    raise exception 'informe a origem do dado' using errcode = '23514', constraint = 'contacts_source_required';
  end if;
  if new.legal_basis = 'legitimate_interest' and length(btrim(coalesce(new.legal_basis_note, ''))) < 20 then
    raise exception 'legítimo interesse exige justificativa (mín. 20 caracteres)'
      using errcode = '23514', constraint = 'contacts_legitimate_interest_note';
  end if;
  if new.legal_basis in ('contract', 'legal_obligation') and length(btrim(coalesce(new.legal_basis_note, ''))) < 5 then
    raise exception 'informe a referência do contrato ou da obrigação legal'
      using errcode = '23514', constraint = 'contacts_basis_reference';
  end if;
  if new.legal_basis = 'consent'
     and (new.consent_at is null or length(btrim(coalesce(new.consent_evidence, ''))) < 5) then
    raise exception 'consentimento exige data e evidência'
      using errcode = '23514', constraint = 'contacts_consent_evidence';
  end if;
  return new;
end $$;

create trigger contacts_lawful_basis
  before insert or update of legal_basis, purposes, legal_basis_note, consent_evidence, consent_at, source
  on public.contacts
  for each row execute function app.contact_lawful_basis();

-- Oposição (opt-out). Idempotente: devolve a data já registrada se houver.
create or replace function public.opt_out_contact(p_tenant uuid, p_company uuid, p_contact uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
  v_prev timestamptz;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]) then
    raise exception 'sem permissão para registrar oposição' using errcode = '42501';
  end if;
  select c.opted_out_at into v_prev
    from public.contacts c
   where c.tenant_id = p_tenant and c.company_id = p_company and c.id = p_contact
   for update;
  if not found then
    raise exception 'contato não encontrado' using errcode = 'P0002';
  end if;
  if v_prev is not null then
    return v_prev;
  end if;
  update public.contacts set opted_out_at = now()
   where tenant_id = p_tenant and company_id = p_company and id = p_contact
  returning opted_out_at into v_at;
  perform app.write_audit(p_tenant, 'contact.opted_out', 'contacts', p_contact,
    jsonb_build_object('company_id', p_company));
  return v_at;
end $$;
revoke all on function public.opt_out_contact(uuid, uuid, uuid) from public, anon;
grant execute on function public.opt_out_contact(uuid, uuid, uuid) to authenticated;

-- Exclusão a pedido do titular. Mantém (ou cria) a supressão do e-mail.
create or replace function public.delete_contact(p_tenant uuid, p_company uuid, p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if not app.has_role(p_tenant, array['tenant_admin','manager','representative','assistant']::public.tenant_role[]) then
    raise exception 'sem permissão para excluir contatos' using errcode = '42501';
  end if;
  delete from public.contacts c
   where c.tenant_id = p_tenant and c.company_id = p_company and c.id = p_contact
  returning c.email into v_email;
  if not found then
    raise exception 'contato não encontrado' using errcode = 'P0002';
  end if;
  if v_email is not null then
    insert into public.suppression_list (tenant_id, email, reason, created_by)
    values (p_tenant, lower(v_email), 'legal', auth.uid())
    on conflict do nothing;
  end if;
  perform app.write_audit(p_tenant, 'contact.deleted', 'contacts', p_contact,
    jsonb_build_object('company_id', p_company, 'suppressed', v_email is not null));
end $$;
revoke all on function public.delete_contact(uuid, uuid, uuid) from public, anon;
grant execute on function public.delete_contact(uuid, uuid, uuid) to authenticated;

-- Elegibilidade para comunicação. Fonte única para telas, campanhas e agente.
-- SECURITY INVOKER: a RLS limita aos contatos e supressões do próprio tenant.
create or replace function public.contact_eligibility(
  p_tenant  uuid,
  p_company uuid default null,
  p_purpose public.contact_purpose default 'prospecting',
  p_channel text default 'email'
)
returns table (contact_id uuid, eligible boolean, reason text)
language sql
stable
set search_path = ''
as $$
  select c.id,
         r.reason is null,
         r.reason
    from public.contacts c
    cross join lateral (
      select case
        when p_channel <> 'email' then 'channel_not_supported'
        when c.opted_out_at is not null then 'opted_out'
        when c.email is null then 'no_email'
        when exists (
          select 1 from public.suppression_list s
           where s.tenant_id = c.tenant_id
             and (lower(s.email) = lower(c.email)
                  or lower(s.domain) = lower(pg_catalog.split_part(c.email, '@', 2)))
        ) then 'suppressed'
        when c.legal_basis is null then 'no_legal_basis'
        when not (p_purpose = any (c.purposes)) then 'purpose_not_allowed'
        when c.legal_basis = 'consent' and (c.consent_at is null or c.consent_evidence is null) then 'consent_missing'
        else null
      end as reason
    ) r
   where c.tenant_id = p_tenant
     and (p_company is null or c.company_id = p_company);
$$;
revoke all on function public.contact_eligibility(uuid, uuid, public.contact_purpose, text) from public, anon;
grant execute on function public.contact_eligibility(uuid, uuid, public.contact_purpose, text) to authenticated;
