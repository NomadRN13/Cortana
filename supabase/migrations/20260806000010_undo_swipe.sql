-- 40/Love — rewind (undo last swipe)
-- Takes back the caller's swipe on one person in one mode so the card can
-- return to their deck. If the swipe had just created a match, the match
-- dissolves (the other side's like still stands, so re-liking re-matches
-- instantly) and its two match notifications are cleaned up. A match with
-- messages is a conversation — those are never deleted: returns false and
-- nothing changes.

create or replace function public.undo_swipe(p_target uuid, p_mode public.app_mode)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_match uuid;
begin
  if p_target is null or auth.uid() is null or p_target = auth.uid() then
    return false;
  end if;

  select id into v_match
  from matches
  where mode = p_mode
    and closed_at is null
    and user_a = least(auth.uid(), p_target)
    and user_b = greatest(auth.uid(), p_target);

  if v_match is not null then
    if exists (select 1 from messages where match_id = v_match) then
      return false;
    end if;
    delete from notifications
    where kind = 'match' and payload->>'match_id' = v_match::text;
    delete from matches where id = v_match;
  end if;

  delete from swipes
  where actor_id = auth.uid() and target_id = p_target and mode = p_mode;
  return true;
end
$$;

grant execute on function public.undo_swipe(uuid, public.app_mode) to authenticated;
