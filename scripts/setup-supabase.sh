#!/usr/bin/env bash
set -euo pipefail

# 40/LOVE — one-shot Supabase provisioning.
# Run from the repo root ON YOUR OWN COMPUTER after:
#   1) creating a project at https://supabase.com (free tier)
#   2) npm install -g supabase
#   3) supabase login
#
# Usage: ./scripts/setup-supabase.sh <project-ref>
# (project-ref is the id in your project's URL: https://supabase.com/dashboard/project/<project-ref>)

PROJECT_REF="${1:?Usage: ./scripts/setup-supabase.sh <project-ref>}"

echo "==> Linking to project $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo "==> Applying the database (all migrations: schema, push tokens, realtime, photo bucket)"
supabase db push

echo "==> Generating push webhook secret + deploying the send-push function"
SECRET="$(openssl rand -hex 32)"
supabase secrets set PUSH_WEBHOOK_SECRET="$SECRET"
supabase functions deploy send-push --no-verify-jwt

cat <<DONE

✅ Database, storage bucket, realtime, and push function are provisioned.

Three clicks left in the dashboard (https://supabase.com/dashboard/project/$PROJECT_REF):

1) AUTH — Authentication → Sign In / Up → Email: turn ON. In Email Templates,
   make sure the "Magic Link" template body contains {{ .Token }} so the email
   carries the 6-digit code the app asks for.

2) PUSH WEBHOOK — Database → Webhooks → Create:
     table: public.notifications   ·   event: INSERT
     type: HTTP request → POST → your send-push function URL
       (Edge Functions → send-push → URL)
     add HTTP header:   x-webhook-secret : $SECRET

3) KEYS — Settings → API: copy "Project URL" and the "anon public" key into:
     mobile/.env                (copy mobile/.env.example first)
     landing/index.html         (the window.FORTYLOVE block near the bottom)
   The anon key is public by design — safe in the landing page.
   NEVER copy the service_role key anywhere.

DONE
