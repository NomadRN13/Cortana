# Renaming the live infrastructure to RSVPlay

The kit now points at `https://rsvplay.netlify.app` and `hello@rsvplay.app`.
The live site is still the old Netlify project. These are the steps only the
account owner can take; none of them can be done from the repo.

1. **Netlify site name.** app.netlify.com → the `40-love` site → *Site
   configuration → Site details → Change site name* → `rsvplay`. The URL
   becomes `https://rsvplay.netlify.app`. If the name is taken, pick another
   and tell Claude; one sweep updates `netlify.toml`, `scripts/build-site.sh`,
   the store pack and the tests.
2. **Production branch.** *Build & deploy → Branches and deploy contexts →
   Production branch* → `claude/rsvplay-scripts-formatting-a15dow` (or `main`
   once this branch is merged). Without this a deploy succeeds and publishes
   the wrong branch.
3. **Domain and mailbox.** Register the domain you want (the kit assumes
   `rsvplay.app`) and create `hello@` on it. The privacy policy, terms, safety
   page, deletion page and several in-app messages name that address.
4. **Supabase.** Authentication → URL configuration: add the new site URL to
   the redirect allow-list. Edge function secrets are unchanged.
5. **Expo / stores.** The bundle id is now `com.rsvplay.app` (it was never
   submitted under the old one). Run `eas init` on the new slug `rsvplay`.
6. **Verify.** `./scripts/test-web.sh share` checks every URL the launch docs
   hand a store reviewer resolves to a page in the build; then open
   `/privacy/` and `/delete-account/` on the live site.
