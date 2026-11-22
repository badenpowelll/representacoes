-- Dados sintéticos para desenvolvimento local (supabase db reset).
-- Dois tenants fictícios para validar o isolamento manualmente. Nenhum dado real.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000a001', 'admin@alfa.test', '{"full_name":"Ana Alfa"}'),
  ('00000000-0000-4000-8000-00000000a002', 'rep@alfa.test',   '{"full_name":"Rui Alfa"}'),
  ('00000000-0000-4000-8000-00000000b001', 'admin@beta.test', '{"full_name":"Bia Beta"}')
on conflict (id) do nothing;

insert into public.tenants (id, name, slug) values
  ('10000000-0000-4000-8000-00000000000a', 'Alfa Representações (fictícia)', 'alfa'),
  ('10000000-0000-4000-8000-00000000000b', 'Beta Representações (fictícia)', 'beta')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000a001', 'tenant_admin'),
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000a002', 'representative'),
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000b001', 'tenant_admin')
on conflict (tenant_id, user_id) do nothing;
