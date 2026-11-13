---
name: self-improve
description: Run one cycle of RSVPlay's self-improvement loop — deterministic health check, triage, reviewable proposals, approved repairs, verification, and a log entry. Use when asked to "run the self-improve loop", "audit the network", "what should we improve", "run smoke tests and repair", or whenever a check or test suite is red. Never edits the safety core (CLAUDE.md, docs/rules-and-stops.md, the safety-support agent, the database stops, location.js); those changes are proposed to the founder only.
---

# Self-improve: one cycle

Read `CLAUDE.md` and `docs/self-improvement-network.md` first.

1. **Measure.** `./scripts/healthcheck.sh` — then `--full` if anything in the
   quick run is red or a release is near. Keep the raw output.
2. **Triage** every FAIL and every open item in `outreach/launch/bugs.md`
   and `outreach/launch/checklist.md` into broken / drifting / missing /
   opportunity. If a rule in `docs/rules-and-stops.md` is involved, run the
   `rules-sentinel` agent and attach its audit.
3. **Propose.** Write `docs/proposals/<YYYY-MM-DD>-<slug>.md` with the
   `network-auditor` agent's format (what · why with evidence · where · risk
   · effort · how verified · safety core? · recommendation). Rank it. Stop
   here for anything in the safety core.
4. **Repair only what is approved** (the founder says so in the conversation,
   or the item is a plain red check outside the safety core such as a stale
   derived file, brand residue, a broken link, a failing non-safety test).
   Hand it to the `self-repair` agent: smallest fix, regenerate derived files
   instead of editing them, re-run the failing check, then its whole suite.
5. **Verify.** `./scripts/healthcheck.sh --full` must be green before the
   cycle ends. Report every output verbatim; never mark something fixed you
   did not see pass.
6. **Log.** Append the cycle to `docs/improvement-log.md`.
7. **Commit only when asked**, never push on your own, and never run
   `supabase db push`, `eas`, or anything that sends or publishes.
