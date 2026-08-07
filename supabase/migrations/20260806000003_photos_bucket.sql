-- 40/Love — provision the photos storage bucket + policies
-- QA found nothing in the repo creates the bucket uploadProfilePhoto targets
-- (test-plan gap #1): on a fresh project the upload fails silently. This
-- migration makes `supabase db push` provision it. Guarded so it no-ops on
-- plain Postgres (local test harness has no storage schema).

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return; -- local/dev Postgres without Supabase storage: nothing to do
  end if;

  insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do nothing;

  -- Uploads go to <own user id>/<n>.jpg only.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_insert_own') then
    execute $pol$
      create policy photos_insert_own on storage.objects
        for insert to authenticated
        with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $pol$;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_update_own') then
    execute $pol$
      create policy photos_update_own on storage.objects
        for update to authenticated
        using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
        with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $pol$;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_delete_own') then
    execute $pol$
      create policy photos_delete_own on storage.objects
        for delete to authenticated
        using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $pol$;
  end if;

  -- Any signed-in user may read photo objects; the app only *surfaces*
  -- photos whose profile_photos row is approved (moderation gate).
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_read') then
    execute $pol$
      create policy photos_read on storage.objects
        for select to authenticated
        using (bucket_id = 'photos')
    $pol$;
  end if;
end
$outer$;
