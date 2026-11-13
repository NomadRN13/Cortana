# Putting the website on rsvplayapp.com

The domain is registered at Cloudflare (2026-11-13), and Cloudflare runs its DNS. The kit already uses
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

## 3. Cloudflare: point the domain at Netlify

dash.cloudflare.com → **rsvplayapp.com** → **DNS → Records**. Delete any
existing `A`, `AAAA` or `CNAME` records for `rsvplayapp.com` and `www`, then add:

| Type | Name | Target | Proxy status |
|---|---|---|---|
| CNAME | `@` | `rsvplay.netlify.app` | **DNS only** (grey cloud) |
| CNAME | `www` | `rsvplay.netlify.app` | **DNS only** (grey cloud) |

Cloudflare allows a CNAME on the bare domain (it "flattens" it). Proxy status
must be **DNS only**: with the orange cloud on, Netlify cannot issue the HTTPS
certificate. Within an hour Netlify shows the domain as verified and issues
the certificate itself. Open `https://rsvplayapp.com/privacy/` and
`https://rsvplayapp.com/delete-account/`; both stores check those pages.

## 4. Cloudflare: the mailbox, free

**rsvplayapp.com → Email → Email Routing → Get started** → add the address
`hello` → destination: the inbox you already read (Cloudflare emails it a
confirmation link). Let Cloudflare add the MX and TXT records it offers. Mail *to* hello@ arrives
there. Mail *from* hello@ (sign-in codes, the desk's replies) goes out through
Resend: `docs/store-submission.md` §1.

## 5. Supabase: tell it the site moved

**Authentication → URL Configuration**: Site URL `https://rsvplayapp.com`;
add `https://rsvplayapp.com/**` to the redirect allow-list.

## 6. Verify

`./scripts/test-web.sh share` checks that every URL the launch docs hand a
store reviewer resolves to a page in the build. Then open `/privacy/`,
`/terms/`, `/delete-account/` and `/demo/` on the live site.
