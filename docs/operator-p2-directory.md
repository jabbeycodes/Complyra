# Operator phase 2: agency directory

Depends on phase 1's protected operator assertion and review workflow. Adds a server-gated directory RPC, local parity, status/access/source/reporting filters and agency detail with existing rule controls. Hosted classifications default to customer; deployment must explicitly classify real demo/test agencies. Only the known platform agency is marked internal by this migration. Seeded Evergreen is explicitly demo data. Unknown legacy local creation dates are shown as not recorded.

Checks: npm test PASS (153 file-level entries, zero failures); npm run build PASS (bundle-size warning); npx tsc -b PASS; git diff --check PASS. Tests cover all agency-template denials and distinct directory filtering semantics. pgTAP denial/data assertions added but not run (no Supabase CLI or usable Docker). Migration is included, unapplied.

Deferred: lifecycle controls to phase 3, operator metrics to phase 4. Reporting classification edits are deployment-managed for now; no customer counts are inferred from provisioning source.
