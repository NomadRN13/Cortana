-- 40/Love — admin & moderation
-- A tiny, explicit admin layer so moderation happens on a real page
-- (site /admin) instead of the Supabase dashboard. Admins can:
--   · see every profile photo (any moderation status) and approve/reject it
--   · read every report and mark it reviewed/actioned
--   · read any profile (context while triaging a report)
--   · create, edit, and delete events
-- Membership is deliberately NOT manageable through the API: the admins
-- table has RLS on and no policies, so the only way in is the dashboard
-- SQL editor (see docs/backend-setup.md). is_admin() is security definer
-- and is the single source of truth the policies below consult.

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- no policies on purpose: invisible and immutable via the API

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;
grant execute on function public.is_admin() to authenticated;

-- ---- moderation: photos ----
create policy photos_admin_select on public.profile_photos
  for select to authenticated using (public.is_admin());
create policy photos_admin_update on public.profile_photos
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- moderation: reports ----
create policy reports_admin_select on public.reports
  for select to authenticated using (public.is_admin());
create policy reports_admin_update on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- context: any profile, even ones RLS would otherwise hide ----
create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.is_admin());

-- ---- events: the founder curates the calendar from the page ----
create policy events_admin_insert on public.events
  for insert to authenticated with check (public.is_admin());
create policy events_admin_update on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy events_admin_delete on public.events
  for delete to authenticated using (public.is_admin());

-- ---- storage: admins can view pending photo files to review them ----
-- (Guarded so plain Postgres — the local test harness — is unaffected.)
do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;
  execute $pol$
    create policy photos_admin_read on storage.objects
      for select to authenticated
      using (bucket_id = 'photos' and public.is_admin())
  $pol$;
end
$outer$;
