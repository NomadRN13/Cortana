-- 40/Love — multi-photo management + moderation hardening
-- Members manage up to 6 photos (positions 0–5; 0 is the main photo).
--
-- 1) SECURITY FIX: photos_write let a member write any moderation_status —
--    including approving their own photo, bypassing the moderation queue.
--    A trigger now forces every member-written photo to 'pending'; only
--    admins (migration 8) can set 'approved'/'rejected'. Replacing the
--    image file re-enters the queue automatically.
--
-- 2) Reordering: the (user_id, position) unique constraint becomes
--    deferrable so positions can be swapped/compacted atomically, and two
--    member RPCs do the only two moves the app needs:
--      make_photo_primary(p) — swap position p with 0
--      delete_photo(p)       — remove the row + its storage object, then
--                              shift higher positions down (no gaps)

alter table public.profile_photos
  drop constraint profile_photos_user_id_position_key;
alter table public.profile_photos
  add constraint profile_photos_user_id_position_key
  unique (user_id, position) deferrable initially immediate;

create or replace function public.enforce_photo_moderation()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_status := 'pending';
  else
    -- members may re-submit (→ pending), never approve/reject themselves
    if new.moderation_status is distinct from old.moderation_status
       and new.moderation_status <> 'pending' then
      raise exception 'photo moderation status can only be changed by an admin';
    end if;
    -- a replaced image always re-enters the moderation queue
    if new.storage_path is distinct from old.storage_path then
      new.moderation_status := 'pending';
    end if;
  end if;
  return new;
end
$$;

create trigger photo_moderation_guard
  before insert or update on public.profile_photos
  for each row execute function public.enforce_photo_moderation();

create or replace function public.make_photo_primary(p_position int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_position is null or p_position < 1 or p_position > 5 then
    return;
  end if;
  set constraints profile_photos_user_id_position_key deferred;
  update profile_photos
  set position = case position when 0 then p_position else 0 end
  where user_id = auth.uid() and position in (0, p_position);
end
$$;

create or replace function public.delete_photo(p_position int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_path text;
begin
  set constraints profile_photos_user_id_position_key deferred;
  delete from profile_photos
  where user_id = auth.uid() and position = p_position
  returning storage_path into v_path;
  if v_path is null then
    return;
  end if;
  update profile_photos
  set position = position - 1
  where user_id = auth.uid() and position > p_position;
  -- also remove the binary (guarded: local test Postgres has no storage)
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects where bucket_id = 'photos' and name = v_path;
  end if;
end
$$;

grant execute on function public.make_photo_primary(int) to authenticated;
grant execute on function public.delete_photo(int) to authenticated;
