-- Permite ao PostgREST embutir o perfil do membro (memberships → profiles).
-- profiles.id = auth.users.id e o perfil é criado por trigger no cadastro.
alter table public.memberships
  add constraint memberships_user_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
