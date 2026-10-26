# Getting 40/LOVE in front of other people

Three different things get called "sending someone the app", and they cost very
different amounts of time and money. This is the honest version of each.

**Start here:** what do you want the tester to be able to do?

| You want them to… | Use | Cost | How long |
|---|---|---|---|
| Look at it, click through the whole flow | **The web prototype** | free | it works now |
| Actually use it, on an **Android** phone | **EAS preview build** (an APK link) | free | ~1 hour once the backend is live |
| Actually use it, on an **iPhone** | **TestFlight** | $99/yr | 2–5 days |
| Use it on a **computer** | not possible yet — see the last section | — | — |

---

## 1. The web prototype — works today, on anything

A link that opens in any browser, phone or laptop. It's the real screens, the
real flow: sign up, swipe, match, chat, events, the doubles-team option.

**What a tester experiences:** everything works and nothing is saved. The people
they swipe on are made up, and two testers can't match with *each other* — each
person's session lives only in their own browser. It's a demo, and it says so.

**Good for:** showing investors, club owners, and prospective members what
you're building. Collecting reactions to the flow and the design.

**Not good for:** anything where you need testers interacting with each other,
or where you want their signups recorded.

Send them the prototype link. Nothing to install, nothing to sign up for.

> **Don't send the landing page yet.** Until it's deployed with real Supabase
> keys, waitlist emails are stored in *the visitor's own browser*. Everyone sees
> "You're on the list" and nobody is on it.

---

## 2. Android — a real installable app, free

This is the fastest route to someone genuinely *using* 40/LOVE on their phone.
It needs a free Expo account and **no Google Play account at all**.

**Do the backend first.** Without it every tester is in demo mode looking at the
same twelve invented players, which is no better than the web link. See
`backend-setup.md`: create the Supabase project, run `go-live.sh`, turn on email
sign-in, and add Twilio — signups stall at the phone step without it.

Then:

```bash
npm install -g eas-cli
eas login                 # free account, sign up at expo.dev
cd mobile
eas init                  # links this app to your Expo account
eas build --profile preview --platform android
```

The build runs on Expo's machines (~15 minutes) and finishes with a URL. Send
that URL to anyone. They open it on an Android phone, tap through the "install
from an unknown source" warning, and they have the app.

**What a tester experiences:** the real thing. Real account, real phone
verification, real matching against everyone else you've invited.

**The warning is normal.** Android shows it for any app not installed from the
Play Store. Worth saying so in the message you send, or half of them will stop.

---

## 3. iPhone — needs the Apple Developer account

There is no free path. Apple requires the $99/year Developer Program before an
app runs on any iPhone but your own.

Once enrolled:

```bash
cd mobile
eas build --profile production --platform ios
eas submit --platform ios      # fill in the two [REPLACE_...] values in eas.json first
```

Then in App Store Connect → TestFlight, add testers by email.

- **Internal testers** (up to 100, must be on your App Store Connect team):
  available immediately after the build processes.
- **External testers** (up to 10,000, anyone's email): the first build needs
  **Beta App Review**, usually about a day. Later builds go out immediately.

**Before the first iOS build with Sign in with Apple**, deploy the token
revocation function — Apple requires it and reviewers check. See
`backend-setup.md`.

**Expo Go will not work for this app.** Google Sign-In is a third-party native
module that Expo Go doesn't contain, so the app cannot run there. Don't spend
an afternoon on it.

---

## 4. Computers — not yet, and it's not a small job

The phone app is React Native with no web build: `react-native-web` isn't
installed and there's no `web` block in `app.json`. Adding it isn't a switch.
The parts that would need replacing on the web are the ones a dating app leans
on hardest — the photo picker, push notifications, location, and both social
sign-in buttons are all native modules with no browser equivalent.

So the realistic options are:

- **Send the web prototype** for anyone on a laptop. It's the flow, honestly
  labelled as a demo.
- **Build a real web version later**, as its own project, once the phone app has
  proven the idea. It is not a prerequisite for launching.

Racquet sports are arranged from a phone, at a court, usually one-handed. A
web version is a nice-to-have, and pretending otherwise would cost weeks.

---

## What to write when you send it

Say which of the three it is, or testers will judge it against the wrong thing —
someone who thinks the prototype is the finished app will report that "nothing
saves" as a bug.

> **Prototype:** "Here's a clickable demo of 40/LOVE — it's the real screens,
> but the players are made up and nothing you do is saved. Curious what you
> think of the flow."

> **Android build:** "Here's 40/LOVE. It's a real early build, so you'll sign up
> properly and you'll be matching with the other people I've invited. Android
> will warn you it's not from the Play Store — that's expected, tap through it."

> **TestFlight:** "You'll get an email from TestFlight. Install that app first,
> then 40/LOVE from inside it."

---

## 5. Knowing whether any of it worked

Three different numbers, from three different places.

**Did anyone visit?** — **Netlify Analytics**, on the site's *Analytics* tab.
It's a paid add-on, about **$9/month per site**, and it's the reason to pick it
over a free script: it reads the server logs Netlify already keeps, so there is
nothing to install, no cookie banner to add, no third party receiving your
visitors, and nothing that slows the page down. Turn it on:

1. app.netlify.com → your **40-love** site → **Analytics**
2. **Enable analytics** → confirm the charge

It starts counting from the moment you enable it and backfills the previous 30
days from existing logs. No deploy needed, no code change — nothing in this
repo controls it.

> The privacy policy already covers this (see "Visits to our website"), so
> **deploy the current site at the same time you enable it** and the two stay
> consistent.

**Did anyone try the demo, and how far did they get?** — the **Numbers** tab on
`/admin`. Needs Supabase configured. Anonymous: a step name and a random value
the page forgets when you leave.

**Did anyone join the waitlist?** — same **Numbers** tab, or the Supabase table
editor. Also needs Supabase.

The last two are free and yours. The first is the one that costs money, and
it's the only way to know whether the links you send are being opened at all.
