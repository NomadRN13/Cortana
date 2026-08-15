# Getting 40/LOVE onto Google Play

Play is the cheaper and faster of the two stores — $25 once, no annual fee, and
no equivalent of Apple's review queue for test builds. The one thing that will
surprise you is the **closed testing requirement**, so read that part first.

---

## The thing that sets your timeline

**A new personal Play developer account must run a closed test with at least
12 testers who stay opted in for 14 consecutive days before it may publish to
production.** Not 12 installs — 12 accounts continuously opted in for two full
weeks. The clock starts when the closed test does.

So the order that actually matters:

1. Create the account **today** (identity verification alone can take a few days)
2. Get a build into closed testing as soon as the backend is live
3. Recruit 12+ testers — a mixer is the natural place
4. Wait out the 14 days while you fix what they report
5. Apply for production

If you do everything else perfectly and start the closed test last, you are
still two weeks from launch. Start it first.

> This applies to **personal** accounts created after Nov 2023. An
> **organization** account (needs a D-U-N-S number) is exempt, which is worth
> knowing if you're forming an LLC anyway.

---

## 1. Account (~$25, 1–3 days)

[play.google.com/console](https://play.google.com/console) → pay the one-time
$25 → complete identity verification. Personal or organization; organization
skips the 12-tester rule but needs a D-U-N-S number, which is free but slow.

## 2. Backend first

Don't build until Supabase is live, or every tester lands in demo mode looking
at the same twelve invented players. See `backend-setup.md`: create the project,
run `go-live.sh`, enable email sign-in, and **add Twilio** — signups stall at the
phone step without it, which is the first thing a tester will hit.

## 3. Build the AAB

```bash
npm install -g eas-cli
eas login                      # free, expo.dev
cd mobile
eas init                       # writes the project id
eas build --profile production --platform android
```

Production profile produces an `.aab`, which is what Play wants. (The `preview`
profile makes an `.apk` for sideloading — good for handing to a friend directly,
not for the store.)

**Signing:** let EAS manage the keystore. Losing an app-signing key means never
updating the app again under that listing; EAS keeps it and Play's Play App
Signing keeps a copy.

## 4. Upload and fill the listing

Create the app in the console, then **Testing → Closed testing** → create a
track → upload the `.aab` → add testers by email list.

Everything the listing asks for, and where it is:

| Field | Where it comes from |
|---|---|
| App name, short + full description | `outreach/launch/store-listing.md` |
| App icon (512×512) | `mobile/assets/icon.png` — resize to 512 |
| **Feature graphic (1024×500)** | `mobile/assets/play-feature-graphic.png` ✅ |
| Phone screenshots (2–8) | **You have to take these** — see below |
| Category | Dating |
| Content rating questionnaire | Answer honestly: user-to-user communication, user-generated photos, dating. Expect **Mature 17+** |
| Target audience | **18 and over only.** Do not tick any minor band |
| Privacy policy URL | `https://40-love.netlify.app/privacy/` |
| **Account deletion URL** | `https://40-love.netlify.app/delete-account/` |
| Data safety form | `outreach/launch/store-listing.md` § Data Safety, filled in per data type |

### Screenshots are the one asset nobody can generate for you

Play requires screenshots of the **real app**, and using the web prototype's
screens instead would misrepresent the product — they look nearly identical,
which makes it more misleading rather than less. Install the build on an Android
phone and capture:

1. The deck with a real profile card
2. Match Point celebration
3. A chat with a court-time card
4. The events list
5. Your own profile

Take them on a device with the backend live so the content is real. Two is the
minimum, five tells the story.

## 5. Things that get dating apps rejected

- **No functioning block and report.** Both exist here, in the deck and in chat,
  and both now surface a failure rather than pretending to have worked.
- **Under-18 access.** Enforced twice — the birthdate check at signup and a
  database constraint that refuses a profile under 18.
- **Unmoderated user photos.** Photos are invisible until approved at `/admin`.
- **A data safety form that doesn't match behaviour.** Ours is drafted from the
  code, not from memory, and the website's analytics are deliberately excluded
  because they aren't in the app binary.
- **A privacy policy URL that 404s.** Deploy the site before you submit.

## 6. After the 14 days

Production → create a release → promote the tested build → set rollout
percentage. Start at 20% for a day; a bad release caught at 20% is a much
smaller problem than one at 100%.

---

## Quick status

| Item | State |
|---|---|
| Feature graphic | ✅ generated, exactly 1024×500 |
| App icon | ✅ `mobile/assets/icon.png` (resize to 512) |
| Listing copy | ✅ drafted |
| Data safety answers | ✅ drafted from the code |
| Privacy + deletion URLs | ✅ pages exist; deploy the site |
| Block / report / moderation | ✅ shipped |
| Play account | ⬜ founder, $25 |
| Supabase + Twilio | ⬜ founder |
| `eas init` + build | ⬜ needs the Expo account |
| Screenshots | ⬜ needs the build on a real phone |
| 12 testers × 14 days | ⬜ **start this first** |
