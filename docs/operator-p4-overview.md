# Operator phase 4: source-backed overview

Depends on phase 3's canonical operational state and phase 2's directory/reporting classifications. Adds an operator landing, protected aggregate RPC, local equivalent, UTC range/group filters, registration/growth charts with keyboard-accessible links and data tables, and dated directory drill-downs. Customer reporting excludes classified demo/internal agencies. Local demo defaults therefore show zero customer agencies until a demo/all group is selected; these are real seeded counts, not invented customers.

Snapshot cards are current. Registration trends count persisted agency creation. Growth cannot reconstruct deleted agencies or historical active customers. Activity is recorded audit-action volume, not comprehensive usage. Unknown legacy local creation dates are labeled and excluded from time series. Commercial metrics are unmeasured and no billing numbers are synthesized.

Checks: npm test PASS (155 file-level entries, zero failures); npm run build PASS (existing bundle warning); npx tsc -b PASS; git diff --check PASS. Added aggregate reconciliation/date-validation/all-template denial tests and pgTAP aggregate-access tests. pgTAP NOT RUN: no Supabase CLI/usable Docker. Included migration is UNAPPLIED. Deferred: commercial metrics to phases 10–12 after agreed sources and approvals.
