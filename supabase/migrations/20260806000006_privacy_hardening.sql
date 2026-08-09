-- 40/Love — privacy hardening (release-review findings)
-- 1) delete_account now also purges the user's photo objects from storage,
--    making the privacy policy's hard-delete promise true end to end.
-- 2) Photo reads are gated: you can always read your own objects; anyone
--    else's require an APPROVED profile_photos row (the moderation gate is
--    now enforced at the storage layer, not just in the app).
-- Both guarded so plain Postgres (local test harness) is unaffected.

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects
    where bucket_id = 'photos'
      and name like auth.uid()::text || '/%';
  end if;
  delete from auth.users where id = auth.uid();
end
$$;

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_read') then
    execute 'drop policy photos_read on storage.objects';
  end if;

  execute $pol$
    create policy photos_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'photos'
        and (
          name like auth.uid()::text || '/%'
          or exists (
            select 1 from public.profile_photos pp
            where pp.storage_path = storage.objects.name
              and pp.moderation_status = 'approved'
          )
        )
      )
  $pol$;
end
$outer$;
