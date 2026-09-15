# Complyrer platform audit and repairs

Audit date: September 14, 2026. Working branch: `codex/platform-audit`.

This pass repairs the existing application and integrates previously separate QA and Audit Me work. It includes the other agent's latest `main` build, `b67a8a4` (QA Review), verified against GitHub on the audit date. Changes are prepared for review; they have not been deployed to the live application or its database.

## What changed and why it matters

- **Access follows the actual user and their assignments.** Expired memberships, unavailable agencies, and accounts requiring a password change cannot keep using protected records. DSP staff see assigned individuals; site staff cannot access another home's care records by supplying a record ID. HR retains staff functions without receiving raw care records. Detailed audit history and private corrective actions have narrower access.
- **Records keep their proper relationships.** Requirements validate their individual, home, owner, and source document. Invalid calendar dates, empty titles, invalid quantities, and unauthorized completion are rejected before changing data. Completed requirements need evidence; the server records the completion time.
- **Medication counts update together with their evidence.** Deliveries and PRN doses now use one database transaction, meaning the stock change and its history either both succeed or both fail. Simultaneous doses cannot overwrite one another, and doses cannot exceed available stock.
- **Notifications use saved records.** The bell reads the real notification list, preserves each user's read state, refreshes, and opens permitted destinations. Broadcast messages no longer become read for everyone when one person reads them. Unsafe external destinations are rejected. A database index repair fixes delegation/document operations that failed while attempting to prevent duplicate notifications.
- **QA Review is connected.** Quarterly reviews, scoring, evidence disputes, resolution, site history, schedules, ranking, and PDF reports are integrated with the current interface. Local reviews survive refreshes. Hosted quarter queries no longer request impossible dates such as September 31. Database finalization blocks unfinished or disputed items and protects signed records against later edits. The signed name comes from the account. In-progress scores are labeled “Score so far” so a partially assessed review does not look complete.
- **Audit Me uses connected information.** Corrective actions can be created, assigned, and resolved through the existing workflow. Risk and deadline links open their source pages. Expired requirements and actual medication inventory contribute to the score. Duplicate site rows are removed, failed data loads are visible, and unsupported assumptions about required certificates no longer create invented gaps.
- **Delegation and document review save reliably.** Newer local template, assignment, draft, publication, acknowledgment, extraction, item-review, and AI-setting changes now persist. Document extraction children and delegation materials inherit individual access in the database as well as the app. Raw PCSP downloads require review access to that individual; approved tasks can be read without revealing the raw extraction. The shared delegation template library remains available.
- **Daily navigation is clearer.** DSP staff land on Individuals, inaccessible or invalid routes recover to a permitted page, manual sign-in does not force a demo tour, and certificate management opens from the profile. Forms have clearer labels and evidence checks. Audit pages work at phone width without horizontal overflow. Long deadline lists and reference workflows are collapsed initially. Audit Me and several PDF builders load on demand.
- **Verification is repeatable.** Test discovery now includes all test files rather than a stale hand-maintained list. Browser fixtures use a stable date, working accessible labels, and portable screenshot paths. New database and hosted-API checks run against a disposable local backend. GitHub verification jobs cover application and database checks. Seed scripts require explicit backend configuration and local-only verification scripts reject remote targets.

## What was exercised

The browser suite uses fictional data and the local adapter. The hosted checks use the real application API, authentication service, and PostgreSQL database running locally. These are distinct kinds of evidence; a browser pass is not a claim that a live external service has been tested.

| Workflow | Verified coverage |
| --- | --- |
| Agency setup, sites, individuals, staff | Browser setup/invitation/password-change flows; hosted site creation, saved site details, individual creation, nine-role sign-in and workspace reads |
| Roles and isolation | Browser admin/HM/DSP/RN/HR-facing behavior; database tenant, site, exact DSP assignment, inactive/expired access, and forbidden write cases; hosted checks for all nine role keys |
| PCSP/ISP and requirements | Browser file retention, extraction draft, review, assignment, approval, completion evidence, version history, and export; real API requirement draft → approval → completion; new extraction lifecycle and reload checks; database document-child and download access checks |
| Acknowledgments and training | Browser acknowledgment roster/PDF; domain and permission tests; hosted delegation template → activation → individual assignment → draft → review → publication → opening → signed acknowledgment |
| Annual renewals and physician orders | Browser clinical upload/date-reset and RN-first signing workflow, including password re-entry; renewal date, signature, and permission logic tests |
| Medication counts | Browser chart/count flow; database access/quantity/log checks; hosted delivery and concurrent PRN deductions with overdraw rejection |
| HR and certificates | Role restrictions, profile entry point, certificate/clearance logic, and hosted HR workspace exclusion of care records; live certificate file delivery was not separately exercised |
| Mileage and monthly checks | Existing calculation, date, continuity, permission, and month-summary tests; browser monthly equipment/drills/safety forms and exports; QA quarter integration |
| Alerts and dashboards | Saved notification API/read-state and destination tests; browser source navigation, agency/site dashboards, missing/error states, and responsive layouts; external email delivery is unverified |
| Audit Me and QA Review | Browser corrective action persistence, source links, QA creation/scoring/reload/PDF, phone navigation; hosted scoring/dispute resolution/site history/actions; database finalization and signature tamper protection |

Final local results:

- **710 automated logic/security/domain checks passed.**
- **56 browser tests passed**, with the three audit-page tests rerun successfully after the final score-label change.
- **48 live database assertions passed.**
- **Hosted API checks passed for all nine roles**, including the complete delegation path and concurrent medication updates.
- **Production build passed.** Phone and desktop audit screenshots were visually inspected.
- A clean local database installation, all migrations, fictional seed, database tests, and hosted API checks were rerun together. No production database was used.

Reproduce with `npm test`, `npm run build`, and `npm run test:e2e`. With Docker and Supabase CLI available, use `supabase start`, `npm run test:db`, `npm run seed:local`, and `npm run test:hosted`. The hosted smoke check creates fictional records; use a disposable local database. `supabase db reset --local` erases that local database and recreates it from migrations.

## Deployment and remaining work

Apply **all committed database migrations in order** before releasing this frontend. The repair migrations run from `20260915021000` through `20260915031000`; QA/readiness tables, permissions, service grants, access guards, medication transactions, and notification deduplication are required together. Do not copy only the frontend. Verify staging with the intended agency roles before changing the live deployment.

This pass does not establish that every production integration is ready. The highest-value next work is:

1. **Verify a staging deployment with real service connections.** Exercise private file uploads/downloads, document AI, provider credentials, email delivery, and scheduled reminder jobs using synthetic records. Review notification recipient rules for individual-specific content. Confirm backups, recovery, monitoring, and deployment rollback.
2. **Finish the agency's authoritative requirement mapping.** Required certificates/training vary by role and agency. Audit Me does not infer obligations from whichever certificates happen to exist. The newer extraction pipeline stores approved trackable items and connects protocols to delegation; other extracted item types are not universally converted into the main requirement, training, or clinical modules. That mapping needs explicit ownership, recurrence, and review rules before automatic creation is safe.
3. **Unify the remaining evidence and signing paths.** QA now protects account identity and finalized content, but QA and the newer delegation acknowledgments still have separate signing flows from the clinical signature ceremony. Extend evidence attachments, consent/password re-entry, and retention policies consistently where required by agency policy. Recheck server-side QA evidence calculation independently of browser-supplied scoring.
4. **Reduce the remaining initial download and test at realistic scale.** The main JavaScript bundle is still approximately 1.53 MB before compression (435 KB compressed). More page-level lazy loading and tests with large agencies will improve slow-device performance. Native iOS/Android builds, full accessibility assistive-technology testing, and load testing were not performed.

Audit scores describe the records and rules currently connected to the application. Medication forecasts are inventory estimates, and workflow-library entries are reference templates. Neither is a substitute for the agency's authoritative clinical records or configured compliance requirements.
