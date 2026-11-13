# Putting the website on rsvplayapp.com

The domain is bought (Namecheap, 2026-11-13). The kit already uses
`https://rsvplayapp.com` and `hello@rsvplayapp.com` everywhere. What remains
is in two dashboards, and only the account owner can do it.

## 1. Netlify: build this branch

1. app.netlify.com → the site still named `40-love` → **Site configuration →
   Build & deploy → Branches and deploy contexts → Production branch** →
   `claude/rsvplay-scripts-formatting-a15dow`. Without this a deploy succeeds
   and publishes the old project.
2. **Site configuration → Site details → Change site name** → `rsvplayapp`.
   Optional, since the custom domain is what people see, but it stops
   `40-love.netlify.app` from ever appearing in a log or a preview link.
3. **Deploys → Trigger deploy → Deploy site.** `netlify.toml` runs
   `scripts/build-site.sh`, so the deploy is built from source every time.

## 2. Netlify: add the domain

**Domain management → Add a domain** → `rsvplayapp.com` → *Add domain*. Netlify
will show it as awaiting DNS; it also adds `www.rsvplayapp.com` and redirects
it to the bare domain.

## 3. Namecheap: point the domain at Netlify

Keep Namecheap's own DNS (**Nameservers: Namecheap BasicDNS**), because the
free email forwarding below only works there. Then **Advanced DNS → Host
Records**, delete the parking records, and add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | `75.2.60.5` | Automatic |
| CNAME | `www` | `rsvplayapp.netlify.app` (or the site's current `*.netlify.app` name) | Automatic |

Within an hour Netlify shows the domain as verified and issues the HTTPS
certificate itself. Open `https://rsvplayapp.com/privacy/` and
`https://rsvplayapp.com/delete-account/`; both stores check those pages.

## 4. Namecheap: the mailbox, free

**Domain List → Manage → Email Forwarding** (or **Redirect Email**) → add
`hello` → forward to the inbox you already read. Mail *to* hello@ arrives
there. Mail *from* hello@ (sign-in codes, the desk's replies) goes out through
Resend: `docs/store-submission.md` §1.

## 5. Supabase: tell it the site moved

**Authentication → URL Configuration**: Site URL `https://rsvplayapp.com`;
add `https://rsvplayapp.com/**` to the redirect allow-list.

## 6. Verify

`./scripts/test-web.sh share` checks that every URL the launch docs hand a
store reviewer resolves to a page in the build. Then open `/privacy/`,
`/terms/`, `/delete-account/` and `/demo/` on the live site.
