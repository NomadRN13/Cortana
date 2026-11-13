-- RSVPlay — tournaments no longer tell a block apart from a suspension
--
-- The residual logged with migration 31. A tournament's entry count is the
-- true count (migration 29), but a member's entry list leaves out anyone
-- hidden from them — someone they have a block with either way, or a
-- suspended member. The draw then dropped suspended entrants and kept blocked
-- ones. So "N entered, I can see N-1" before the draw, followed by an
-- N-1-player bracket or an N-player bracket with one unnamed place, said
-- which of the two the missing entrant was.
--
-- Now a suspension withdraws the member from every tournament still taking
-- entries, at the moment of the suspension. Their place frees up and the
-- count drops, exactly as if they had left — which is all anyone else sees.
-- So the entrants hidden from you that are still counted are only ever
-- people you have a block with, and every one of them is in the draw. (That a
-- hidden entrant has a block with you was already plain once you met them in
-- the bracket; who they are, and whether they blocked you or you them, is
-- not shown.)
--
-- After the draw nothing changes: the bracket keeps every place. A player
-- suspended after the draw stays in it, unnamed for everyone, the same as a
-- player hidden from you by a block; the desk settles their matches.
--
-- Lifting a suspension doesn't put the member back in: they enter again if
-- there is still room. The draw's own clean-up of suspended entrants stays as
-- a backstop.

create or replace function public.withdraw_suspended_entries()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  tid uuid;
begin
  -- Tournament rows first, the same lock the draw and join_tournament take:
  -- a draw in progress finishes before this looks, and one that has been
  -- made is no longer 'registration' (the lock re-reads the row), so a drawn
  -- bracket is never left with a hole.
  for tid in
    select t.id from tournaments t
     where t.status = 'registration'
       and exists (select 1 from tournament_entries e
                    where e.tournament_id = t.id and e.user_id = new.id)
     order by t.id
     for update of t
  loop
    delete from tournament_entries where tournament_id = tid and user_id = new.id;
  end loop;
  return null;
end
$$;

revoke all on function public.withdraw_suspended_entries() from public, anon, authenticated;

drop trigger if exists profiles_suspension_withdraws on public.profiles;
create trigger profiles_suspension_withdraws
  after update of suspended_at on public.profiles
  for each row
  when (old.suspended_at is null and new.suspended_at is not null)
  execute function public.withdraw_suspended_entries();

-- Anyone already suspended who is still entered somewhere taking entries.
delete from public.tournament_entries e
 using public.tournaments t, public.profiles p
 where t.id = e.tournament_id and t.status = 'registration'
   and p.id = e.user_id and p.suspended_at is not null;
