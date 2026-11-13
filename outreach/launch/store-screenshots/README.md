# Store screenshots — 1.0 listing set

Rendered from the real phone app (`mobile/`), not the prototype: the Expo
app's web build at phone size, in demo mode, walked from signup through
check-in. The "Demo:" notes the demo build shows are hidden, because the live
app never shows them. Sample players appear as initials, not photos.

| Set | Size | Use |
|---|---|---|
| `ios-*.png` | 1320 × 2868 | App Store, iPhone 6.9" (the one size Apple requires) |
| `android-*.png` | 1080 × 2340 | Google Play, phone |

Order, the same for both stores:

1. `1-welcome` — Serve. Rally. Connect., the three modes, Date opt-in
2. `2-home-events` — this week on the courts, RSVP first
3. `3-event-detail` — an event: venue, how the night works, who's going
4. `4-checked-in` — checked in with the host's code; see your crew
5. `5-crew` — the people you shared a court with, then your matches
6. `6-bracket` — a tournament bracket, round by round
7. `7-ladder` — a ladder league's standings
8. `8-profile` — your card, phone verified, photos

Feature graphic (Play, 1024 × 500): `mobile/assets/play-feature-graphic.png`.

To retake after an app change: rebuild the web export and run the screenshot
script (ask any session to "retake the store screenshots"). Once real members
with approved photos exist, a set taken on a device will look better; these
are accurate to the shipped screens either way.
