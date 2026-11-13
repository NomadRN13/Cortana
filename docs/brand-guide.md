# RSVPlay — Brand & Design Guide

The single source of truth for how RSVPlay looks, sounds, and feels. Every
screen, page, and document in this repo derives from this guide. The design
canvases ("RSVPlay — Rebrand Mockups" and "RSVPlay — App Mockup") are built on
the same tokens.

## 1. Positioning

**Product:** RSVPlay — an events-first social app for paddle and racquet sports
(pickleball, tennis, padel, racquetball, squash).

**One-liner:** RSVP to a game, show up, play, and keep the people you meet.

**Positioning line:** *The app for paddle and racquet sports.*

**Tagline:** *Serve. Rally. Connect.*

**Three modes**, in this order everywhere: **Play** (find players for your next
match), **Date** (opt-in; meet people you’d like to date), **Friends** (expand your
circle on and off the court). Mode identity comes from icons — paddle, heart,
people — never from per-mode colors.

## 2. The idea behind the identity

The name is the brand: **RSVP + Play.** You say yes to a game, and the game is
where everything else starts. The identity is confident, plain-spoken and a
little playful: a bold geometric wordmark, one lime accent, and the pickleball
as the recurring mark — as the period after the name, as the app icon, and as
the ball in every lockup.

Visual world to draw from: court lines, paddles, the lime ball, night games
under the lights. Not from: generic dating-app gradients, purple/pink neon,
tennis-score puns (that was the old name's world).

## 3. Palette

| Token | Hex | Use |
|-------|-----|-----|
| Ink | `#14161C` | The ground on dark surfaces; text on light surfaces |
| Court | `#F5F4EE` | Light ground; text on dark surfaces |
| Optic | `#C8F04A` | The one accent: primary actions, active states, the lime P |
| Court blue | `#2F5BFF` | Secondary accent: event headers, "Start a rematch", avatars |
| Surface | `#1E2128` | Cards on Ink |
| Surface 2 | `#272B33` | Chips and date boxes inside cards |
| Line | `#2E323B` / `#3E434E` | Card borders / input and outlined-button borders |
| Muted | `#C9CBD2` | Secondary text on dark |
| Success | `#3DC96B` | Verified badges, confirmations |
| Danger | `#E15A72` | Destructive and negative actions only |

Light surfaces use Court as ground, `#FFFFFF` cards, `#DEDCD3` lines, and
`#3A3F4B` / `#4A4F5C` for secondary text.

Rules: Optic is never body text on a light ground. Court blue and Optic never
sit directly on each other — separate them with Ink or Court. Text contrast
is WCAG AA everywhere, including 11–12 px labels.

In code the tokens live in `mobile/src/theme.js` (the app), the `:root` block
of `app/index.html` (the prototype), `landing/index.html` and `admin/index.html`.
Keep them identical.

## 4. Typography

- **Headlines, numbers, the wordmark:** Space Grotesk 700, tight tracking
  (`letter-spacing: -0.02em`, `-0.03em` on the wordmark). The self-contained
  pages fall back to the system sans at weight 800.
- **Body, buttons, labels:** Inter (system sans fallback). Eyebrow labels are
  11–12 px, uppercase, `+0.08em` tracking.
- **Scoreboard numerals:** `font-variant-numeric: tabular-nums` wherever
  digits align (scores, stats, distances, dates).
- Body text ~65ch max width, 1.45–1.6 line height.

## 5. Wordmark / logo

Typographic wordmark plus the pickleball mark. The sanctioned lockups, from the
brand boards:

- **A · The ball dot** — `RSVPlay` with the ball as the period. The default
  (app bars, policy pages, the admin desk).
- **D · Ball lockup** — ball first, name second. The ball alone is the app icon.
- **F · Shared P** — `RSV` + Optic `P` + `lay`: the lime P belongs to both RSVP
  and Play. Welcome screens and hero moments.
- **H · Club badge** — round seal, `RSVPLAY` on top, `SERVE · RALLY · CONNECT`
  underneath. Merch and wristbands.
- **I · Stacked on lime** — `RSVP` over `Play` on Optic. Posters and signs.

The ball is defined once in `scripts/lib/ball.js`; `scripts/sync-mark.js`
writes it into every page and `scripts/make-icons.js` renders the icons and the
`ball.png` the phone app draws. Never redraw it by hand.

## 6. Structural motifs

- Cards: 16–20 px radius, 1 px Line borders, no shadows on dark.
- Pills: 44 px tall, fully rounded; primary buttons 54 px.
- Date boxes, numbered steps and avatars are circles or soft squares in
  Surface 2 with Optic numerals.
- Overlapping avatar stacks for "who's going".

## 7. Voice & copy

Confident, plain-spoken, genuinely helpful. Warm and direct; at most one pun
per piece, and none in safety copy. Controls say what they do ("RSVP",
"Request to hit", "Send"). Skill talk is real: NTRP for tennis, DUPR for
pickleball, or Beginner / Intermediate / Advanced / Competitive when generic.

Sanctioned phrases: "Serve. Rally. Connect." · "RSVP to a game and meet your
people." · "It's a Match Point!" (mutual match) · "Your serve" (your turn to
reply) · "Find a game. Find your people."

Never: "40/LOVE", "Love at first serve", "the first date is a game" — those
belong to the retired name.

## 8. The surfaces

**The app and the website share one dark theme:** Ink ground, Surface cards,
one Optic accent, Court text, the ball-dot wordmark. Verified badges are
Success green; Danger red appears only for destructive or negative actions.

**Light screens** (home, event, crew in the mockups) use Court ground with
white cards and Ink text; the same Optic accent carries across.

**Print and event materials** use the same tokens; Stacked-on-lime and the club
badge are the lockups meant for them.
