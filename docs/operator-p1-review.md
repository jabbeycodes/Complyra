# Operator phase 1: agency review

Unapplied migration: `20261031010000_operator_review.sql`. Deploy separately before enabling the new review client. Direct authenticated status updates are revoked; the operator-only RPC validates pending → active/rejected, requires a reason, locks the agency row, rejects stale status, and writes lifecycle and activity evidence atomically.

Validation: `npm test` passed (152 file-level test entries, zero failures); `npm run build` passed (existing bundle-size warning); `npx tsc -b` passed; `git diff --check` passed. New local tests exercise every agency template's denial, reason validation, stale review, repeat transition, and real caller attribution. `supabase/tests/operator_review.sql` adds server denial, direct-update denial, and attribution checks. pgTAP was not executed: Supabase CLI is absent and Docker access is unavailable in this environment. No migration was applied.

Deferred to later phases: directory (2), suspension/reactivation (3), historical browsing (6). Default reason in the API is retained for existing programmatic callers; the review UI requires an explicit operator reason.
