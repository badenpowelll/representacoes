-- Exclusão de negócios do funil fica registrada na auditoria (quem, quando e o quê).
-- A exclusão em si continua governada pela RLS de public.deals
-- (tenant_admin, manager e representative da própria representação).

create or replace function app.deal_delete_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.write_audit(old.tenant_id, 'deal.deleted', 'deals', old.id,
    pg_catalog.jsonb_build_object(
      'title', old.title,
      'company_id', old.company_id,
      'industry_id', old.industry_id,
      'stage', old.stage,
      'amount', old.amount));
  return old;
end;
$$;

revoke all on function app.deal_delete_audit() from public;

create trigger deals_delete_audit after delete on public.deals
  for each row execute function app.deal_delete_audit();
