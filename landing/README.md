# 40/Love — Landing Page

`index.html` is the complete waitlist site: one self-contained file, no
build step. It runs in two modes:

- **Demo** (as checked in): the waitlist form saves to the visitor's own
  browser. Fine for previewing, useless for collecting signups.
- **Live**: the form writes emails to your Supabase `waitlist` table. The
  database only allows anonymous *inserts* — nobody can read the list
  without your admin access (verified by the backend test suite).

## Go live in ~10 minutes

1. **Connect the form** — open `index.html` and find the config block near
   the bottom:

   ```js
   window.FORTYLOVE = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };
   ```

   Paste your Supabase project URL and **anon public** key (Dashboard →
   Settings → API). The anon key is designed to be public — publishing it
   in the page is safe and normal.

2. **Deploy** — the assembled website lives in `site/` (landing page at `/`,
   the clickable prototype at `/demo`, favicon included). Any static host
   works; all are free at this scale:
   - **Netlify:** drag the `site/` folder onto [app.netlify.com/drop](https://app.netlify.com/drop). Done.
   - **Vercel:** `npx vercel site/`
   - **GitHub Pages:** repo Settings → Pages → serve from the branch,
     `/site` folder.

   After editing `landing/index.html` or `app/index.html`, re-run
   `./scripts/build-site.sh` to refresh `site/`, then re-deploy. (Step 1's
   Supabase keys go into `landing/index.html` — rebuild after pasting them,
   or paste them into `site/index.html` directly before dragging.)

3. **Custom domain** (recommended before promoting it): buy `40love.app`
   or similar (~$15/yr) and point it at the host. Update the Instagram/
   TikTok bio links to it.

4. **Read your signups** — Supabase Dashboard → Table Editor → `waitlist`.
   Export CSV anytime for the `waitlist-community` agent to draft welcome
   emails.

## What's verified

Automated browser tests cover: demo mode never makes a network call; live
mode POSTs the lowercased email with `city: Indianapolis, source: landing`
and the anon key header; a duplicate signup shows the friendly
"already on the list" state; a server failure shows an inline error and
re-enables the button without losing the visitor's input.

## Notes

- City-vote chips are local-only fun for now (each visitor sees their own
  counts). Wiring real vote tallies needs a small table + policy — ask the
  `backend-engineer` agent when it matters.
- The page's copy and palette come from `../docs/brand-guide.md`; keep
  edits inside that system.
