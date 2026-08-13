# 40/Love — Brand & Design Guide

The single source of truth for how 40/Love looks, sounds, and feels. Every screen,
page, and document in this repo derives from this guide.

## 1. Positioning

**Product:** 40/Love — a dating and social app for people who play racquet sports
(tennis, pickleball, padel, racquetball, squash).

**One-liner:** 40/Love connects active singles through the racquet sports they
already love, making the first date a game instead of dinner.

**Tagline:** *Love at first serve.*

**Three modes** (functional color coding — used consistently everywhere):

| Mode | Purpose | Color |
|------|---------|-------|
| ❤️ Date | Find romantic matches | Match Rose `#E15A72` |
| 🎾 Play | Find hitting & practice partners | Optic `#CFE23F` |
| 👥 Friends | Leagues, socials, community | Baseline Blue `#3E7C9B` |

## 2. The idea behind the identity

The name is the brand: **"40" is sport, "Love" is romance.** The identity holds
those two worlds in tension — crisp court geometry and scoreboard typography on
the sport side, a warm serif italic and rose accent on the romance side. Neither
wins; the pairing is the look.

Visual world to draw from: court-line geometry (chalk-white 2px lines, service
boxes, corner ticks), scoreboard numerals, optic-yellow felt, deep court green,
club-house warmth. Not from: generic dating-app gradients, purple/pink neon.

## 3. Palette

| Token | Hex | Use |
|-------|-----|-----|
| Court | `#0F3D2E` | Deep green ground — heroes, headers, dark surfaces |
| Ink | `#132A21` | Text on light surfaces (green-black, never pure black) |
| Chalk | `#F6F4EC` | Warm line-white — light ground, court lines on Court |
| Optic | `#CFE23F` | Tennis-ball yellow — sport accent, Play mode, CTAs on dark |
| Match Rose | `#E15A72` | Romance accent — Date mode, likes, "Love" in the wordmark |
| Baseline Blue | `#3E7C9B` | Friends mode, secondary info accents |

Rules: Optic is never used for body text on light grounds (contrast). Rose and
Optic never sit directly on each other — separate with Court, Ink, or Chalk.
Neutrals are green-biased (derive greys from Ink/Chalk), never pure `#888`.

## 4. Typography

No webfonts (self-contained pages). The system carries it through treatment:

- **Display / headings:** system sans (`system-ui`) at weight 800–900,
  tight tracking (`letter-spacing: -0.02em`), `text-wrap: balance`. Uppercase
  with `+0.08em` tracking for eyebrows/labels only.
- **Romance voice:** `Georgia, 'Times New Roman', serif` in *italic* — used
  sparingly for taglines and the "Love" half of the wordmark.
- **Scoreboard numerals:** `font-variant-numeric: tabular-nums` wherever
  digits align (scores, stats, distances, dates).
- Body text ~65ch max width, 1.6 line height.

## 5. Wordmark / logo

Typographic wordmark, no complex artwork:

> **40**<span style="color:#CFE23F">/</span>*Love*

- "40" — heavy sans, Ink or Chalk depending on ground.
- "/" — Optic, slightly oversized, the pivot between the two worlds.
- "Love" — Georgia italic, Match Rose.

Works at any size, in one color if needed (all-Chalk on Court). A roundel
variant for app icons: Optic circle, Ink "40/L".

## 6. Structural motifs

- **Court lines:** section dividers and card borders are crisp 2px Chalk (on
  dark) or Ink at low alpha (on light) — straight lines, sharp corners or a
  modest 10–14px radius. No soft blob shapes.
- **Service box grid:** two-column bordered grids for feature/stat sections.
- **Score chips:** small bordered pills showing paired values ("40–LOVE",
  "NTRP 3.5", "2.1 mi") in tabular numerals.
- **Corner ticks:** short L-shaped marks at section corners, like court corners.

## 7. Voice & copy

Warm, energetic, lightly punny — one pun per screen, never a pile-up.
Controls say what they do ("Send request", "Join event"). Skill talk is real:
NTRP for tennis, DUPR for pickleball, or Beginner / Intermediate / Advanced /
Competitive when generic.

Sanctioned phrases: "Love at first serve." · "It's a Match Point!" (mutual
match) · "Your serve" (your turn to reply) · "Meet on the court, not at a bar."

## 8. The two surfaces

**The app — "Night Court" (founder-directed).** The product UI commits to a
dark look set by the founder's reference design: near-black ground
(`#0A0B0D`), dark cards (`#17191D`), a single bright Optic accent
(`#D6F44F`) for actions and active states, white text. Mode identity comes
from icons (heart / racquet / people), not per-mode colors. The wordmark on
dark is white with the "o" in "Love" drawn as an Optic pickleball —
holes, not seams (founder-directed, 2026-08-13);
secondary tagline: **"Serve. Rally. Connect."** Verified badges use green
`#3DC96B`; the pass/danger red `#E15A72` appears only for destructive or
negative actions.

**The landing page** shares the Night Court world (founder-directed): night
ground, Optic accents, the ball-o wordmark — one brand across the website
and the app. The §3 court-green palette remains available for print/event
materials where a daylight look fits.

Both surfaces are a deliberate single-theme commitment; keep contrast
WCAG-legible everywhere.
