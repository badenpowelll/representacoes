-- Expõe os dados de referência pela API sem expor o schema "ref" inteiro.
create view public.ref_states with (security_invoker = true) as
  select code, ibge_code, name, region from ref.states;
create view public.ref_municipalities with (security_invoker = true) as
  select ibge_code, state_code, name from ref.municipalities;
revoke all on public.ref_states, public.ref_municipalities from anon;
grant select on public.ref_states, public.ref_municipalities to authenticated;
