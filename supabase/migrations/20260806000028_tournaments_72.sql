-- RSVPlay — tournaments take up to 72 entries
--
-- The first version stopped at 24. A club open day or a city championship
-- wants more, so the ceiling is now 72 — which plays in a bracket of 128 over
-- seven rounds. Nothing about how a bracket is built changes: the functions in
-- 20260806000027 never knew the number 24; only these column limits did.
--
--   entries        2..24  ->  2..72
--   bracket size   ..32   ->  ..128   (72 entries need the next power of two up)
--   seed           1..24  ->  1..72
--   round          1..5   ->  1..7    (a bracket of 128 has seven rounds)
--   slot           0..15  ->  0..63   (64 first-round matches)

alter table public.tournaments
  drop constraint tournaments_max_entries_check,
  add constraint tournaments_max_entries_check check (max_entries between 2 and 72);

alter table public.tournaments
  drop constraint tournaments_bracket_size_check,
  add constraint tournaments_bracket_size_check check (bracket_size in (2, 4, 8, 16, 32, 64, 128));

alter table public.tournament_entries
  drop constraint tournament_entries_seed_check,
  add constraint tournament_entries_seed_check check (seed between 1 and 72);

alter table public.tournament_matches
  drop constraint tournament_matches_round_check,
  add constraint tournament_matches_round_check check (round between 1 and 7);

alter table public.tournament_matches
  drop constraint tournament_matches_slot_check,
  add constraint tournament_matches_slot_check check (slot between 0 and 63);
