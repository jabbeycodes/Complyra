#!/usr/bin/env bash
# Links this repo to the dedicated Complyra Supabase project and applies schema.
# Requires a personal access token from https://supabase.com/dashboard/account/tokens
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ynjthbdfuzkqrbvjuvwd}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Set SUPABASE_ACCESS_TOKEN, then run: npx supabase login --token \"\$SUPABASE_ACCESS_TOKEN\""
  exit 1
fi

npx supabase login --token "$SUPABASE_ACCESS_TOKEN"
npx supabase link --project-ref "$PROJECT_REF"
npx supabase db push
npx supabase functions deploy invite-member

echo "Next: copy the anon key into VITE_SUPABASE_ANON_KEY and run npm run seed:evergreen"
