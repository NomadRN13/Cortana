# Decisions for the founder — from the independent review (2026-11-13)

The fifteen additions were built and then attacked by an independent review
(six reviewers, a skeptic per finding, reproductions against a throwaway
database). Everything it confirmed that had a clear right answer was fixed
the same day (see `docs/improvement-log.md`). These are the findings where
the fix is a **policy choice with a cost on both sides**, so they are yours.
Nothing below has been done.

## 1. Deleting an account while a report is open escapes the ban

**What:** a reported member who deletes their account before the desk acts
takes their phone number with them (deletion is hard), signs up again, and is
a new person. Today the number is kept only if the account was already
suspended or banned at deletion.
**Option A (the reviewer's):** when an account is deleted with open reports
against it, hold a hash of its number for 30 days; during the hold the number
cannot verify. Disclose the 30-day hold on the privacy and deletion pages.
**Cost of A:** a false or petty report locks an innocent person out for 30
days if they happen to delete and return, and the desk can no longer review
the report (it is deleted with the account).
**Option B:** keep deletion complete, and instead make the desk's 24-hour
target the defence: sort the report queue so accounts with open reports and a
recent login come first.
**Recommendation:** B now; revisit A if evasion is actually seen.
**Safety core:** yes. **Effort:** A — small migration + policy text; B — small.

## 2. Should browsing also require a verified phone?

**What:** migration 39 requires a verified phone to *reach* anyone (swipe,
message, RSVP, enter, join). It deliberately leaves *reading* open: an account
with no phone can still load the deck and profile cards. So a banned person on
a fresh email can browse members — including someone who blocked their old
account — without ever verifying.
**Option A:** also require a verified phone for the deck and profile cards
(behind the same `app_settings` switch).
**Cost of A:** a brand-new member sees nothing until the text arrives; if
SMS is down, the app is empty rather than read-only. The app already gates
signup on the phone step, so real members would rarely notice.
**Recommendation:** A, before public launch. It is one condition in two
functions plus a harness test.
**Safety core:** yes. **Effort:** small.

## 3. The dating flag can be probed by toggling your own Date mode

**What:** "also open to dating" is mutual, so a member who flips their own
Date mode and "looking for" can learn whether a crew member is in Date mode
and whether they fit. The reviewer's skeptic judged this **not a new leak**:
the Date deck already shows exactly those people under exactly that toggle.
**Recommendation:** no change. Listed so the trade-off is on the record.

## 4. Onboarding default: Play pre-selected, Date off

**What changed (done, flagging it because it is product direction):** the
prototype and the phone app used to pre-select Date mode at signup. Both now
pre-select Play; Date is something a member turns on. This follows the
positioning ("dating is opt-in") and the review flagged the old default as a
contradiction. Say so if you want Date pre-selected again.

## 5. Who records a ladder result

**What:** either of the two players records who won, once, and it cannot be
changed. So a player can claim a win they did not earn, and the other player's
only remedy is the desk.
**Option A (the reviewer's):** a win is conceded, never claimed. Only the
player who lost records the result (`report_league_result` refuses
`p_winner = me`). The app's "You beat them?" button becomes "I lost".
**Cost of A:** a sore loser can stall a result forever; the winner then needs
the desk anyway. It also changes the rule printed on the challenge sheet
("either of you records who won"), the phone app and the prototype.
**Option B:** keep "either player", and add "dispute this result" to the
report reasons so the desk can reverse it.
**Recommendation:** A for the first league season; it is the convention most
club ladders use. The database change is three lines plus a harness test.
**Safety core:** no. **Effort:** small (migration 37, `EventsScreen.js`,
`state.js`, the prototype, their tests).

## 6. The two-rung cap is counted on the real ladder

**What:** a challenge may reach two rungs up on the ladder the challenger
*sees*, but a win moves them up at most two rungs on the *real* ladder. With a
hidden member between the two, the winner lands one visible rung below the
player they beat rather than on that player's rung.
**Option A (the reviewer's):** count the cap on the challenger's visible
ladder too, so the winner always takes the loser's rung.
**Cost of A:** a member who can see everyone on the ladder may infer a block
between two others from a three-rung move. A second account can already tell
a block from a departure, so the exposure is small either way.
**Recommendation:** A, together with decision 5, in one change to migration 37
before any league is created.
**Safety core:** yes (block visibility). **Effort:** small.

Already done from the same finding, because it had no cost: a member's real
rung is no longer readable (`league_members` is desk-only and `join_league()`
answers with the visible rung).

## 7. Two small sign-offs

**The safety agent's opening line.** `.claude/agents/safety-support.md` still
opens "RSVPlay is a dating and social app for racquet sports players". The
file is safety core, so it was not edited. Proposed replacement, changing no
rule: "RSVPlay is an events-first social app for paddle and racquet sports
players, with opt-in dating."

**Store category.** The Play listing draft is filed under the Dating category
and Apple's questionnaire answers "Is this a dating app? Yes". Both are
truthful while Date mode exists, and stores penalise an undeclared dating
feature. The alternative is Social on Play with dating declared in the
content questionnaire. **Recommendation:** ask the store reviewer contact or
counsel before filing; until then the draft stays as it is.
