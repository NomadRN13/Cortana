# 40/Love — Beta Test Plan, v0.1 "First Serve" (Round 1)

**Date:** August 2026 · **Build:** first TestFlight / Google Play beta, LIVE
mode (real accounts, real matching — this is not the demo)
**Time needed:** about 60–75 minutes, working as a pair
**Written for:** the founder and mixer volunteers. No tech background needed —
if you can play a tiebreak, you can do this.

Thank you for testing. You are the first real players to touch 40/Love.
Nothing you do here can break anything permanent — worst case you find a bug,
which is exactly the point.

---

## How to report a problem

When something doesn't match what the plan says you *should see*:

1. **Take a screenshot** of what's on your screen (iPhone: side button +
   volume up. Android: power + volume down).
2. Note **the test number** (e.g. "Test 9"), **what you tapped last**, and
   **your phone model** (e.g. "iPhone 13", "Pixel 7").
3. Email it to **stjones6746@gmail.com** with the subject **"40/Love beta"**
   — or drop it in the testers' group chat if one is set up.

Small, weird, or "probably just me" problems count too. Report everything;
sorting it out is our job, not yours.

---

## 1. Setup — before you start

### What every tester needs

- [ ] An iPhone (install via the **TestFlight invite link: `<TESTFLIGHT LINK
      HERE>`**) or an Android phone (install via the **Play testing link:
      `<PLAY STORE LINK HERE>`**).
- [ ] A **real email address you can open on that phone** — sign-in works by
      emailing you a 6-digit code. No password, so the email must actually
      arrive.
- [ ] A **testing partner**. Most of the important tests — matching, chat,
      court-time, blocking — need **two phones side by side**. Pair up before
      you start and stay in the same room (or on a call) with your partner.
      One of you is **Tester A**, the other **Tester B** — a few tests give
      each of you a different job.
- [ ] When the app asks to **send you notifications, tap Allow** — Test 11
      needs it.

### Three FIRST-RUN CHECKS

Three things have never been tried on real phones against the real server
before this round. They are marked **FIRST-RUN CHECK** below:

- **Test 5** — profile photo really uploads (not just looks uploaded)
- **Test 9** — chat messages arrive live, both directions
- **Test 11** — push notifications arrive with the app closed

If any of these fails, message the founder **right away** — don't wait until
you've finished the whole plan.

### For the founder only — pre-flight (do before inviting testers)

- [ ] All three migrations pushed to the production Supabase project
      (initial schema, `push_tokens`, `realtime_messages` — the realtime one
      is the B-07 fix; without it chat silently never delivers).
- [ ] A **`photos` storage bucket exists** with upload/read policies for
      signed-in users. **No migration creates it** — if it's missing, photo
      upload (Test 5) will fail with no visible error.
- [ ] The Supabase email template for sign-in includes the **6-digit code**
      (`{{ .Token }}`) — the default magic-link-only template leaves testers
      with no code to type.
- [ ] `send-push` edge function deployed, `PUSH_WEBHOOK_SECRET` set, and the
      database webhook on `notifications` INSERT configured (Test 11 depends
      on this whole chain).
- [ ] At least **one future event** exists in the `events` table (Test 12
      shows "No upcoming events yet" otherwise).
- [ ] The beta builds were made **with the two `EXPO_PUBLIC_` Supabase
      variables set** — Test 1 catches it if not.

---

## 2. Core flows

Do these **in order** — later tests build on earlier ones. Tests 15–17
(report / block / delete) are destructive: they end your pair's session, so
they come last on purpose.

---

### Test 1 — Install and first open

1. Install the app from your invite link and open it.
2. Tap through to the sign-in screen (the one asking "What's your email?").

**You should see:** the email screen with **no yellow "Demo mode" note** on
it. If you see a note saying *"Demo mode: no email is actually sent — any
6-digit code will work"*, **stop testing** and tell the founder — the build
isn't connected to the real server, and nothing after this point would be a
real test.

- [ ] PASS  - [ ] FAIL

---

### Test 2 — Sign in with an email code

1. Type your real email address and tap **Send code**.
2. Open your email on the same phone. A message with a 6-digit code should
   arrive within a minute or two (check spam if not).
3. First, type a **wrong** code on purpose (e.g. 000000) and tap **Verify**.
4. **You should see:** a friendly red message like *"That code didn't match.
   Check the newest email or resend."* — not a crash, not computer jargon.
5. Now type the **real** code and tap **Verify**.

**You should see:** the code email arrives, the wrong code is politely
rejected, and the right code takes you to the profile setup screens
("First things first").

- [ ] PASS  - [ ] FAIL

---

### Test 3 — Profile setup, including the age gate

The app is 18+ — this must be impossible to get around.

1. Type your first name.
2. In Birthdate, type a date that makes you **17** — and to make it a hard
   test, use the date exactly **18 years ago tomorrow** (e.g. if today is
   August 7, 2026, type 08/08/2008 — that person turns 18 *tomorrow*). Tap
   **Next**.
3. **You should see:** a pop-up saying **"40/Love is 18+ — You must be 18 or
   older to join."** It must NOT let you continue — not even one day early.
4. Now type an impossible date: **02/30/1990**. Tap **Next**.
5. **You should see:** *"Enter your birthdate as MM/DD/YYYY."* — the fake
   date is refused.
6. Enter your **real** birthdate, then finish the remaining steps: pick your
   sports, your skill level, and at least **Date Mode** (turn on Play Mode
   too — you'll want it later). Skip the photo for now — that's Test 5.
7. Tap **Step on court**.

**You should see:** both bad birthdates rejected with plain-English messages,
and your real one accepted. You land on the Home screen with your name in
the greeting.

- [ ] PASS  - [ ] FAIL

---

### Test 4 — A fresh account starts empty

An earlier bug showed brand-new users a list of fake people (Maya, Sam,
Priya) to chat with. Checking it stays dead:

1. Straight after setup, open the **Matches** tab (bottom bar).
2. Open the **Chat** tab.
3. On Home, tap the **bell** (top right).

**You should see:** Matches says **"No matches yet"**, Chat is empty
("Match with someone first…"), and notifications say "You're all caught up".
**If you see anyone named Maya, Sam, or Priya — FAIL, screenshot it
immediately.** You haven't matched with anyone; there should be nobody here.

- [ ] PASS  - [ ] FAIL

---

### Test 5 — Profile photo upload — FIRST-RUN CHECK

A photo can *look* saved on your phone while never actually reaching the
server — which would mean other players see your initials forever. So this
test has a tester half and a founder half.

1. Open the **Profile** tab and tap **Add photo**.
2. Allow photo access if asked, pick a photo, crop, confirm.
3. **You should see:** your photo appears in the circle at the top of your
   profile right away.
4. Force-quit the app (swipe it away from the app switcher) and reopen it.
   Your photo should still be on your Profile tab.
5. **Tell the founder your name and that your photo is up.**

**Founder check (required to pass):** in the Supabase dashboard → Storage →
`photos` → a folder named with this tester's user ID containing `0.jpg`, and
a row in `profile_photos` with `moderation_status = 'pending'`. The photo on
the phone means nothing until it's in the bucket.

*Note: your partner will still see your initials, not your photo — photos
wait for approval before anyone else sees them. That's correct behavior,
don't report it.*

- [ ] PASS  - [ ] FAIL

---

### Test 6 — The deck: pass, like, ace, save

1. On **Home**, make sure the **Date Mode** pill is selected.
2. Look at the card in the deck. It should show a name, age, sports, and
   skill level.
3. **Important: do NOT pass (✕) on your testing partner.** In the live app a
   pass is final — you'd never see them again in this mode and couldn't
   match. If your partner's card is up, use the **bookmark** icon (top right
   of the card) to **save** them, then read the buttons but don't press
   pass/like yet.
4. If a card that is *not* your partner appears, try **✕ (pass)** — the card
   should slide away and the next card appear.
5. Know the buttons: ✕ passes, the big **heart** likes, the **star** is an
   "Ace" (super like). **An Ace matches you instantly, no mutual like
   needed** — don't Ace anyone you don't want to match with.

**You should see:** cards with real tester names, pass moves to the next
card, and the bookmark fills in when you save someone. If you allowed
location when the app asked, cards show a distance like "0.3 miles away" —
testers in the same room should see small numbers (location is rounded to
about a kilometer on purpose, so it won't be exact). If you denied
location, cards simply show no distance line — that's expected, not a bug.

- [ ] PASS  - [ ] FAIL

---

### Test 7 — Filters narrow and widen the deck

Both testers do this. You'll use the **Age range** filter. (If both of you
allowed location, also try the **Distance** filter afterward: set it to
**1 mile** — your partner in the same room should stay visible; a tester
across town should disappear until you widen it again.)

1. First, both of you: open **Settings** (menu icon, top left of Home) and
   set **Age range** to **18 – 99**. This guarantees you and your partner
   can see each other. Go back to Home.
2. Confirm your partner's card shows up in the deck (swipe through with the
   bookmark trick — no passes!). Tell each other your ages.
3. Now **narrow**: go to Settings and set the age range so your partner's
   age is *outside* it (e.g. partner is 31 → set 45 – 99). Go back to Home
   and wait a couple of seconds.
4. **You should see:** the deck reloads and your partner **no longer
   appears**.
5. Also try typing an age range where the first number is *bigger* than the
   second (e.g. 50 – 30). **You should see:** the app quietly fixes the
   order rather than breaking.
6. **Widen** back to 18 – 99. **You should see:** your partner comes back
   into the deck within a few seconds.

- [ ] PASS  - [ ] FAIL

---

### Test 8 — Matching: mutual like on two phones

The heart of the app. Phones side by side now.

1. **Tester A:** when Tester B's card comes up, tap the **heart**. Nothing
   dramatic should happen yet — that's right, B hasn't liked you back.
2. **Tester B:** find Tester A's card and tap the **heart**.
3. **You should see on Tester B's phone (the second liker):** the full-screen
   **"It's a Match Point!"** pop-up with both your pictures/initials —
   instantly.
4. **On Tester A's phone:** no pop-up appears live — that's currently
   expected. A should get a **push notification** ("It's a Match Point!") if
   notifications are allowed; either way, after closing and reopening the
   app, Tester A **must** see Tester B in the **Matches** tab.
5. Both check the **Matches** tab: each of you sees the other, once.

**Go straight to Edge case E3 now** (send the very first message immediately
— it's a 30-second test that must happen right after a fresh match), then
come back here.

- [ ] PASS  - [ ] FAIL

---

### Test 9 — Live chat, both directions — FIRST-RUN CHECK

1. Both testers: open the chat with each other and **keep it open**.
2. **Tester A:** type "First serve" and hit Send.
3. **You should see on B's phone:** the message pops into the open chat
   within a couple of seconds — **without** closing or reopening anything.
4. **Tester B:** reply "Return winner".
5. **You should see on A's phone:** same thing — arrives live, within a
   couple of seconds.
6. Trade a few more messages. Every single one must arrive, in order, both
   directions, while the chat stays open.

**FAIL if:** a message only shows up after leaving and reopening the chat or
restarting the app. That was bug B-07 — if it's back, tell the founder
immediately.

- [ ] PASS  - [ ] FAIL

---

### Test 10 — Court-time proposal and accept

The signature feature: propose a real court meetup inside chat.

1. **Tester A:** in the chat, tap **"🎾 Suggest court time"** (above the
   typing box).
2. **You should see on both phones:** a green-edged **COURT TIME** card in
   the chat with a venue, day, and time.
3. **Tester A: keep the chat open on your screen. Don't touch anything.**
4. **Tester B:** on the court-time card, tap **Accept**.
5. **You should see on Tester A's phone, within a few seconds, without
   touching anything:** the card changes to **"Accepted — see you out there
   ✓"**.

**FAIL if:** A's card still says nothing / stays a plain proposal until the
app is restarted. That was bug B-08. (Also try a second proposal the other
direction and tap **Decline** — the proposer should see "Declined — suggest
another time".)

- [ ] PASS  - [ ] FAIL

---

### Test 11 — Push notifications with the app closed — FIRST-RUN CHECK

1. **Tester A:** force-quit the app completely (swipe it away in the app
   switcher). Lock your phone.
2. **Tester B:** open your chat with A and send "Wake up, your serve".
3. **You should see on A's locked phone:** a notification — **"Your serve /
   New message waiting for you."** — within a minute or so.
4. Tap it. The app should open normally (any screen is fine; it does not
   need to jump straight to the chat).
5. Swap roles and repeat so both phones are tested. If you have a fresh
   match available (see E4), also check a **match** push ("It's a Match
   Point! 🎾") arrives with the app closed.

**FAIL if:** no notification ever arrives on a phone that allowed
notifications. Note your phone model — iPhone and Android can behave
differently here, and that's exactly what we need to learn.

- [ ] PASS  - [ ] FAIL

---

### Test 12 — Events: RSVP that sticks

1. Open the **Events** tab. You should see at least one upcoming event (if
   it's empty, tell the founder — that's a setup gap, not your bug).
2. Note the "spots left" number on an event, then tap **Join**.
3. **You should see:** the button changes to **"Going ✓"** and spots left
   drops by one.
4. Force-quit the app and reopen it. Go back to Events.
5. **You should see:** still **"Going ✓"** — the server remembered, it wasn't
   just your phone pretending.
6. Tap it again to un-join. **You should see:** back to **Join**, spots
   count back up.

- [ ] PASS  - [ ] FAIL

---

### Test 13 — Saved players survive a restart

1. On Home, find a card and tap the **bookmark** icon (you probably already
   saved your partner in Test 6).
2. Open the **Matches** tab — the **"Saved for later"** strip at the top
   shows them.
3. Force-quit the app and reopen it.
4. **You should see:** the Saved for later strip is **still there** with the
   same people. (Bug B-15 used to wipe it on every restart.)

- [ ] PASS  - [ ] FAIL

---

### Test 14 — Sign out and sign back in

Your profile lives on the server — signing out must not destroy it.

1. **Settings → Sign out** → confirm.
2. **You should see:** the welcome screen.
3. Sign in again: same email, new 6-digit code from your inbox.
4. **You should see:** you land straight on Home — **no profile setup
   again** — with your name, sports, skill level, bio, and modes exactly as
   you left them.

*Expected, don't report:* your profile photo shows as initials until you
re-add it, and your Saved-for-later strip is empty — sign-out clears both on
the phone (the photo still exists on the server). Matches and chats must all
still be there.

- [ ] PASS  - [ ] FAIL

---

### Test 15 — Report a player (safety)

Do the chat part on your partner; the deck part on a card that is **not**
your partner (reporting from the deck removes that person from your deck
permanently, in every mode).

**Part 1 — report from chat (keeps your match, so do this first):**

1. **Tester A:** open the chat with B, tap **⋯** (top right), tap
   **"Report <name>"**.
2. **You should see:** *"Thank you — our safety team will review …"*. The
   chat itself stays open (a report is not an unmatch).
3. **Founder check:** a new row appears in the `reports` table.

**Part 2 — report from the deck (regression for bugs B-03/B-04):**

4. On Home, when a card that is NOT your partner is up, tap **⋯** on the
   card → **Report**.
5. **You should see:** the thank-you message, and the deck moves to the
   **next** card — **not the same person again** (that was B-03).
6. Force-quit and reopen the app, browse the deck.
7. **You should see:** the reported person **never comes back** (that was
   B-04). If no non-partner card exists in your deck, mark this part
   "couldn't test" in your notes rather than skipping silently.

- [ ] PASS  - [ ] FAIL

---

### Test 16 — Block a player: gone on both phones (safety)

**Heads-up: blocking is permanent in this build (no unblock button), and it
ends your pair's testing. Only start this once Tests 1–15 are done.**

1. **Tester A:** open the chat with B, tap **⋯** → **"Block <name>"**.
2. **You should see on A's phone, immediately:** the chat closes, and B is
   gone from **everywhere** — the Matches grid, the Chat list, the Saved
   strip, and the Home deck (check all four).
3. Force-quit A's app and reopen: B must **stay** gone everywhere.
4. **Tester B:** force-quit your app and reopen it.
5. **You should see on B's phone:** A has disappeared from your Matches and
   Chat too. No error, no explanation — they're just gone (that's the
   standard, safe way dating apps handle it).
6. **Tester B:** if the old chat is still on screen *before* you restart,
   anything you type there may look sent on your phone but must **never**
   arrive on A's — A must see nothing, ever.

**FAIL if:** the blocked person reappears anywhere on either phone after a
restart, or any message crosses the block in either direction.

- [ ] PASS  - [ ] FAIL

---

### Test 17 — Delete account: everything gone (safety, store requirement)

**Tester B sacrifices their account.** (B was already blocked in Test 16, so
this costs nothing extra.)

1. **Tester B:** **Settings → Delete my account** (the small link at the
   bottom).
2. **You should see:** a serious warning — *"This permanently deletes your
   profile, matches, and messages. It cannot be undone."* Tap **Delete
   forever**.
3. **You should see:** you're signed out, back at the welcome screen.
4. **Tester B:** sign in again with the **same email** (new code).
5. **You should see:** the app treats you as a **brand-new player** — it
   sends you through profile setup from scratch. Your old name, photo,
   matches, and messages are gone. That proves the deletion was real.
6. **Tester A:** force-quit and reopen your app. It must open normally — no
   crash, no ghost chat with the deleted person, nothing weird on Matches,
   Chat, or Home.
7. **Founder check:** the user is gone from Supabase Auth, and their rows in
   `profiles`, `matches`, and `messages` are gone with them.

- [ ] PASS  - [ ] FAIL

---

## 3. Edge cases

### E1 — Airplane mode on the deck (honest error, B-17)

1. Turn on **Airplane Mode** (Wi-Fi off too).
2. Open the app, go to Home, and switch modes or reopen the app so it tries
   to load the deck.
3. **You should see:** the **"Can't reach the court"** message — *"We
   couldn't load players — check your connection and try again"* — with a
   **Try again** button. It must **NOT** say "That's everyone nearby" (the
   old bug lied that you'd run out of players when you were just offline).
4. Turn Airplane Mode off, tap **Try again**. **You should see:** the deck
   loads.

- [ ] PASS  - [ ] FAIL

### E2 — Rapid mode-pill switching (B-16)

1. On Home, tap the **Date / Play / Friends** pills back and forth quickly,
   at least 10 times, ending on **Play Mode**. (If you can, turn on Low Data
   Mode or do this on weak cellular — slow connections are where this bug
   lived.)
2. **You should see:** no crash, no flicker between two decks, and after a
   couple of seconds the deck settles on **Play Mode players** — matching
   the pill that's actually highlighted. Swipe one card and confirm nothing
   strange happens.

- [ ] PASS  - [ ] FAIL

### E3 — First message instantly after a match (B-01) — do this during Test 8

The nastiest bug of the review: the first message after a match used to
vanish, and the app then **invented a fake reply** attributed to the real
person.

1. The moment the **"It's a Match Point!"** pop-up appears, tap **Send a
   message** and immediately send "Hi!" — no waiting, fast as you can.
2. **You should see:** "Hi!" stays visible in your chat AND arrives on your
   partner's phone.
3. Now both of you watch that chat for a full minute **without either of you
   typing**.
4. **You should see: nothing.** If a reply like *"Sounds great — see you on
   the court! 🎾"* appears **that your partner did not type**, that is an
   automatic FAIL of the highest order — screenshot both phones and contact
   the founder immediately. No message should ever appear that a real person
   didn't send.

- [ ] PASS  - [ ] FAIL

### E4 — Matching in Date AND Play mode (one thread only, B-06)

1. Both testers: make sure **Play Mode** is on (Settings → Modes), then
   switch the Home pill to **Play Mode**. (Do this before Tests 16–17!)
2. Like each other in Play Mode, same as Test 8. The Match Point pop-up
   fires again — you're now matched twice, once per mode. (This is also a
   fresh match — a good moment to re-run the E3 instant-message check and
   the Test 11 match-push check.)
3. Open the **Matches** tab and the **Chat** list on both phones.
4. **You should see:** your partner appears **exactly once** in Matches and
   **exactly once** in Chat. Two tiles or two chat rows for the same person
   = FAIL, screenshot it.
5. Send a message each way in the one thread — both must arrive live.

*Expected, don't report:* your earlier Date-mode messages may no longer show
in the thread after the second match — the app currently shows the newest
match's conversation. Merging histories is on the list (B-06 deferral).

- [ ] PASS  - [ ] FAIL

### Founder-only check F1 — closed match stays closed (B-02)

Not for volunteers — needs dashboard access. In Supabase, set `closed_at =
now()` on one of a pair's `matches` rows (e.g. the leftover Play match after
E4). Both testers relaunch the app. Expected: that conversation disappears
from both phones, nothing crashes, and no "Match Point!" pop-up ever fires
for a closed match.

- [ ] PASS  - [ ] FAIL

---

## 4. Known limitations — do NOT report these

Real, known, and accepted for round 1. Reporting them costs triage time:

1. **Unread dots and the "YOUR SERVE" badge are best guesses.** They can be
   wrong and they reset when the app restarts. Real read receipts are
   planned for v1.1 (B-14).
2. **Rewind is off in live mode.** Tapping it says live swipes can't be
   taken back — that's intentional (it's slated for premium).
3. **Other players' photos show as initials on colored circles.** Photos
   wait in a moderation queue and this round nobody else's photo displays.
   Your own photo on your own Profile tab is the only photo you'll see.
4. **Distances are approximate on purpose.** Location is rounded to about a
   kilometer before it ever leaves your phone, so "0.3 miles" between two
   people in the same room is normal. If someone denied location, their
   cards show no distance and the Distance filter can't exclude them. Use the Age
   filter for Test 7.
5. **The first liker gets no live pop-up.** Only the *second* liker sees
   "It's a Match Point!" instantly; the first learns via push or on next
   app open.
6. **After sign-out/in, your own photo shows initials** until you re-add it,
   and your Saved list starts empty. The server copy of your photo is safe.
7. **Matching in a second mode hides the older conversation history** (one
   thread, newest match wins — merge is deferred).
8. **The sign-out pop-up mentions a "local demo profile."** Wording leftover
   — your real account is fine.
9. **City votes on the 40love website count per visitor/browser**, not per
   account. Website quirks aren't part of this app test.
10. **Events only appear when the founder has published them.** An empty
    Events tab on day one is a setup note for the founder, not an app bug.

---

## 5. Results — template for the founder

Paste one row per test, per pair (or per phone where sides differ). Results
land in `outreach/launch/bugs.md` after triage.

**Round 1 · App build: ______ · Dates: ______**

| Test | Name | Pair / Tester | Phone (model + OS) | Result (Pass / Fail / Couldn't test) | Notes + screenshot link |
|------|------|---------------|--------------------|--------------------------------------|-------------------------|
| 1 | Install + live-mode check | | | | |
| 2 | Email code sign-in | | | | |
| 3 | Setup + 18+ gate | | | | |
| 4 | Fresh account empty | | | | |
| 5 | Photo upload (FIRST-RUN) | | | | |
| 6 | Deck basics | | | | |
| 7 | Filters narrow/widen | | | | |
| 8 | Mutual match | | | | |
| 9 | Live chat (FIRST-RUN) | | | | |
| 10 | Court time accept | | | | |
| 11 | Push, app closed (FIRST-RUN) | | | | |
| 12 | Event RSVP sticks | | | | |
| 13 | Saved survives restart | | | | |
| 14 | Sign out / back in | | | | |
| 15 | Report | | | | |
| 16 | Block, both phones | | | | |
| 17 | Delete account | | | | |
| E1 | Airplane mode deck | | | | |
| E2 | Rapid mode pills | | | | |
| E3 | Instant first message | | | | |
| E4 | Date + Play, one thread | | | | |
| F1 | Closed match (founder) | | | | |

**Severity guide for triage:** Blocker = sign-in, matching, chat, or a
safety feature (report / block / delete / 18+) is broken. Major = a tester
hit wrong behavior in normal use. Minor = edge case. Polish = cosmetic.

---

*Maintained by QA. Regression scenarios in this plan cover the fixed
findings B-01 through B-13 and B-15 through B-17 from
`outreach/launch/bugs.md`; B-14 (read receipts) remains open for v1.1 and is
listed under Known limitations.*
