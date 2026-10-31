# Operator phase 3: agency lifecycle

Depends on phase 2 directory controls and phase 1 lifecycle log. Transitions: pending → active/rejected; active → suspended; suspended → active. Rejected is not suspension. Existing disabled active agencies migrate to suspended. Platform agency lifecycle changes are blocked to avoid operator lockout. RPC records reasons and stale-state checks atomically; tenant RLS and security-definer permission helpers respect suspension. LocalApi blocks existing sessions and new tenant sign-ins while suspended. No records are deleted and no billing meaning is inferred.

Validation: npm test PASS (154 file-level entries, zero failures), npm run build PASS (bundle warning), npx tsc -b PASS, git diff --check PASS. New local tests verify existing-session denial, sign-in denial, restoration without deletion, and platform-agency protection. pgTAP checks added for tenant denial and permission-helper revocation but NOT RUN (Supabase CLI absent; Docker unavailable). Included migration is UNAPPLIED.

Deferred: lifecycle explorer to phase 6. Suspension blocks tenant data through authorization; it does not claim to destroy or revoke the underlying Auth token. Deployment must apply migrations before shipping this client.
