# RSVPlay — The self-improvement network

Three agents and one script that keep the kit honest and make it better over
time **without ever changing a rule on their own**. Added 2026-11-13 on top of
the ten-agent team in `docs/networking-team.md`.

## The loop

```
healthcheck.sh ──► network-auditor ──► docs/proposals/<date>-*.md
 (deterministic)     (measures, triages)        │
                                                ▼
                                     founder reads, decides
                                      │ approve   │ reject / later
                                      ▼           ▼
                      self-repair (broken)   docs/improvement-log.md
                      rules-sentinel (drift)       (the memory)
                                      │
                                      ▼
                          ./scripts/test.sh green again
                                      │
                                      ▼
                          improvement-log entry + regression test
```

| Piece | What it is | Can it change the code? |
|---|---|---|
| `scripts/healthcheck.sh` | Deterministic diagnostic: structure, brand residue, derived files current, every rule in `docs/rules-and-stops.md` still enforced, and (with `--full`) the three test suites. Exit 1 on any FAIL. | No — read-only |
| `network-auditor` | Runs the check, reads the bug tracker, checklist and scorecards, writes ranked proposals, logs every cycle | No — proposals only |
| `rules-sentinel` | Verifies every rule still holds, statically and by running the suites; escalates any loosening as URGENT | No — reports only |
| `self-repair` | Fixes approved *broken* items with the smallest change, re-runs the check, adds a regression test | Yes — outside the safety core |

## The safety core (humans only)

`CLAUDE.md` · `docs/rules-and-stops.md` · `.claude/agents/safety-support.md`
· the stops in `supabase/migrations/` (RLS, guard triggers, the 18+ check,
`set_my_location`, `delete_account`) · `mobile/src/lib/location.js` · the
admin gating in `admin/index.html` · the humans-send rule in every agent.
Agents may propose changes here; only the founder makes them. `healthcheck.sh`
checks that `self-repair` still names the core off-limits.

## Operating rhythm

- **Every push / before a release:** `./scripts/healthcheck.sh --full`.
- **Weekly (Monday, with validation-analyst):** `network-auditor` runs a
  cycle and leaves one proposals file; the founder spends 15 minutes marking
  each item *do now / later / don't*.
- **After any backend or app change:** `rules-sentinel` audit.
- **Any red check:** `self-repair`, then the suite, then the log.

Ask for it in one line: "Run the self-improve loop" (the `self-improve` skill
in `.claude/skills/`), or name an agent directly.

## Why proposals, not autonomy

RSVPlay's only asset at launch is a small city's trust. An agent that could
loosen a privacy rule, widen a grant or "fix" a safety test to pass would be
the most dangerous thing in the repo. So the network's output is a document
the founder reads, and its memory is a log the founder can audit. Speed comes
from the deterministic check (seconds) and from `self-repair` being allowed to
move fast everywhere else.
