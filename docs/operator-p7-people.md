# Operator phase 7: people and support context

Depends on phase 6's scoped activity explorer and inherited agency directory. Adds protected paged global account lookup, real membership/expiry/account-state metadata and a read-only support panel linking agency detail/rules and recorded activity. Credentials and clinical record contents are omitted. Tenant role tools are linked only for the current authorized workspace; this does not grant cross-tenant role changes or impersonation.

Validation: npm test PASS (158 file-level entries, zero failures); npm run build PASS (bundle warning); npx tsc -b PASS; git diff --check PASS. Unit tests cover membership search, filtering, omission of credentials and every agency-role denial. Chromium operator-console.spec.ts: 3 PASS, including people lookup/support links and admin denial. pgTAP tests added; isolated database setup in progress, no pgTAP pass claimed at this checkpoint. Migration is UNAPPLIED to hosted projects.

Deferred: support ticket ownership/SLA persistence and operator privilege editing belong to phase 12 and require separate approval. No support cases or accounts are invented.
