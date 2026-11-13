# Legal review packet: November 2026

**For:** the attorney reviewing RSVPlay before public launch.
**Drafted by:** the founder (with an AI assistant). **Not legal advice.** Every item below is a question for counsel, not a conclusion.

## What to review

| Page | File | Status |
|---|---|---|
| Terms of Service | `landing/terms.html` → `/terms/` | Rewritten November 2026: 10 sections became 16 |
| Privacy Policy | `landing/privacy.html` → `/privacy/` | Added Twilio as a processor and a "Your rights" section |
| Safety tips | `landing/safety.html` → `/safety/` | New page |
| In-app consent | Last signup step, plus links in Settings | New: "By tapping Step on court you confirm you're 18 or older and agree to…" |

## What RSVPlay does

- A dating and social app for racquet-sports players, 18 and over, run from Indianapolis.
- Members sign in with an emailed code, Apple or Google, and verify a phone number by text through Twilio.
- Members can be matched for dating, play or friends, in one or more of 12 US cities in Indiana, California, Arizona, Washington, Texas, Florida and DC.
- Organisers run free meetup events and free single-elimination tournaments of up to 72 players. Players record their own results, and the organiser can correct them or award a walkover.
- A "places to play" list shows public and private courts. It is gathered from public sources, with no venue relationships.
- A member can add a doubles partner: a second person's first name, birthdate and gender, entered by the account holder.
- There are no payments, no ads, and no data sales.

## What changed in the terms, and why

| § | Section | What's new | Why |
|---|---|---|---|
| 3 | Community conduct | Zero-tolerance statement, a ban on asking for money, false tournament results, and trying to locate members | Apple's App Store rules for apps with user content require filtering, reporting, blocking, and timely action on reports. Romance scams are the top dating-app fraud. |
| 4 | Meeting in person | A clear "no criminal background checks or identity checks" statement, and that a verified phone isn't identity | See Q2 |
| 5 | Doubles partners | The account holder confirms the partner is 18+ and agreed to be listed | The account holder supplies a third person's personal data |
| 6 | Your content | A copyright complaint process | See Q6 |
| 7 | Playing sport at your own risk | Widened from events only to tournaments and court time members arrange themselves, with a see-a-doctor note | See Q4 |
| 8 | Tournaments | Players record results, the organiser's decision is final, the draw is random, no prizes, names are shown | See Q5 |
| 9 | Places to play | Information only, no venue affiliation, check before you go | Members rely on venue hours, fees and access that we don't control |
| 10 | Text messages | One verification text, no marketing, carrier rates may apply | See Q7 |
| 11 | The service | Adds "no guarantee member info is accurate" and an exclusion of indirect or consequential losses | Standard; confirm it's enforceable |
| 12 | Your responsibility to us | A light indemnity | See Q8 |
| 14 | Disputes | 60 days of informal resolution first; Indiana law, with a carve-out for rights a member's own state won't let them waive | See Q3 |
| 15 | Changes | Members are told in the app first | Matches the privacy policy |

## Questions for counsel

1. **Is it enforceable as presented?** Agreement is a line of text with links above the final "Step on court" button: sign-in-wrap, not a checkbox. Is that enough, or should there be an unticked checkbox? Do existing beta members need to re-accept?
2. **State dating-safety laws.** Several states have laws aimed at online dating services, about safety notices, background-check disclosures and how they must be shown. I believe these include New Jersey, New York, Illinois, Michigan and Texas, but haven't verified any of them. Texas matters most, because Dallas and Houston are launch markets.
   - Which laws apply to a free app?
   - Is the wording in §4 and on the safety page enough, or is specific statutory wording, font size or placement required (for example, on signup or before messaging)?
3. **Arbitration and class-action waiver.** The draft deliberately has neither, only informal resolution and Indiana law.
   - Should it add binding arbitration, a class-action waiver and a small-claims carve-out?
   - Mass-arbitration fees are a known risk for consumer apps.
   - Is the Indiana choice-of-law clause enforceable against California members?
4. **Liability for injuries.** Does §7 do anything useful for member-arranged games and organiser-run tournaments? Should events and tournaments have a separate liability waiver at sign-up, especially if RSVPlay ever books courts or collects fees?
5. **Tournaments.** If a tournament ever has a prize or an entry fee, which contest or sweepstakes rules apply? Is "the organiser's decision is final" fine as written?
6. **Copyright (DMCA).** For the copyright safe harbor we'd need to register a designated agent with the US Copyright Office and publish the full notice process. Worth doing before launch?
7. **Text messages.** Is a single verification text sent at the member's request covered by the TCPA, and is the §10 disclosure enough? Twilio and the carriers may want their own consent wording.
8. **Indemnity (§12).** Keep it, soften it, or drop it for a free consumer app?
9. **Privacy: state laws.** At our size, the California law (CCPA/CPRA) probably doesn't apply yet, though Washington's My Health My Data Act and others might. The "Your rights" section promises access, correction and deletion within 45 days to everyone. Is that the right promise? Is gender plus "seeking" preferences sensitive data (sexual orientation) under any state law, requiring opt-in consent?
10. **Doubles partner data.** The account holder enters a partner's birthdate and gender without the partner ever signing up. Is the §5 confirmation enough, or should the partner confirm themselves (for example, by text)?
11. **Reviewing reports within 24 hours.** §3 and the safety page say "we aim to review every report within 24 hours". That is an operational promise; confirm the founder can staff it before launch.

## Known gaps outside the documents

These aren't legal-text problems, but counsel should know about them. Both are logged in `outreach/launch/checklist.md`, and **both were fixed on 2026-11-12** (migration 30). The privacy policy has been updated to match.

- **Some profile settings were readable by any signed-in member** through the API (cities, modes, who they're seeking, age and distance range, last active). Fixed: other members can now read only a member's first name directly; everything else they see comes from the card, which carries only what the card shows.
- **The distance shown to members could have been used to work out where someone is**, by checking it from several places. Fixed: distance is now given in whole miles between map squares about 2½ miles across, and a member's position can move to a new square at most once every six hours.

The fix has not yet been tried on the live backend or a real device.

## Still to do (owner)

- Refile the Apple App Privacy and Google Play Data safety forms. Gender, partner details, and tournament names and results are now visible to other members.
- Set the effective date on both pages when the lawyer signs off, and remove the "Founder note" boxes.
