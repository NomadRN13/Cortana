-- 40/LOVE — make blocking mean what the docs say it means
--
-- "Blocking makes two people invisible to each other everywhere, enforced at
-- the database layer" (docs/backend-setup.md). Two tables were not doing that:
--
--   event_rsvps  read policy was `using (true)`. Anyone could ask
--                /rest/v1/event_rsvps?select=user_id&event_id=eq.<id>
--                and get the guest list — so someone you had blocked could
--                learn that you would be at a named venue at a named time.
--                Of everything blocking is supposed to protect, where someone
--                will physically be on Saturday is the part that matters most.
--
--   user_sports  same `using (true)`. Less serious on its own, but it left a
--                blocked member able to confirm an account still exists and
--                what it plays, which is precisely what a block should stop.
--
-- The count of who is going is now computed per viewer, so a member with
-- blocks may see one fewer attendee than there are. That is the right trade:
-- a spot count being off by one is a cosmetic inaccuracy, and a guest list
-- leaking to someone who was blocked is a safety failure.

drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps
  for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked(auth.uid(), user_id));

drop policy if exists user_sports_select on public.user_sports;
create policy user_sports_select on public.user_sports
  for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked(auth.uid(), user_id));
