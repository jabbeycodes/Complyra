# Complyrer

**The compliance operating system for care agencies.**

Complyrer turns care plans, policies, and regulatory requirements into trackable responsibilities, helping agency leaders understand what is required, who owns it, what is missing, and where audit risk exists.

The product domain is [complyrer.com](https://complyrer.com).

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Open the local address printed by Vite (normally http://127.0.0.1:5173).

Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, the app runs the **schema-faithful local workspace** (fictional Evergreen Care). This is for development and demonstration only. Do not enter real individual, patient, or employee data.

```sh
npm run build
npm test
npx playwright install chromium
npx playwright test
```

### Sample accounts (local workspace)

Password for all sample accounts: `Evergreen!demo1`

- Provider code `EVERGREEN-MO` / `sarah.mitchell` — Agency administrator
- Provider code `EVERGREEN-MO` / `alex.morgan` — DSP
- Provider code `COMPLYRER-MO` / `platform.owner` — Complyrer operator

### Hosted Supabase

1. Create a Supabase project.
2. Apply `supabase/migrations/20260911120000_complyra_foundation.sql`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Create users in Auth and matching `memberships` rows. Do not load real PHI until Auth, RLS, private storage, and audit logging have been verified.

The migration enables deny-by-default RLS, append-only `audit_events`, and a private `agency-documents` bucket. File paths are `{agency_id}/{individual_id}/{version_id}/source.pdf`.

## What this version does

- Signed-in agency workspace with Administrator, Compliance Admin, Manager, and DSP roles.
- Agency, program, site, individual (including date of birth), and dated staff assignments.
- Real PDF upload with SHA-256 hashing and retained file bytes (no longer discarded).
- Human review and approval of requirement drafts. Drafts do not affect the active score.
- PCSP acknowledgment packets: one sheet per document version listing every assigned employee, with signature, date, and pending rows.
- Staff must open/review before signing. Managers cannot silently sign another person’s row. One-off signers can be added with a reason.
- Single-sheet PDF export with agency name, individual, DOB, what is being acknowledged, start/end dates, and the staff roster sorted by signed date.
- Audit register CSV export, activity timeline, and keyword “Ask Complyrer” lookups against workspace records.

Evergreen Care remains a fictional seed tenant.

## Scope and production boundary

**Do not enter real individual, patient, or employee data** until a hosted project with Auth, RLS, private storage, and audit logging is verified. No HIPAA or regulatory compliance claim is made.

Still production work: AI extraction with human approval, email/SMS escalations, smart forms, delegations as a full module, physician-order workflows, HR, and auditor invitations.

See [the production design](docs/production-design.md) for implementation boundaries.

## Main files

- `supabase/migrations`: multi-tenant schema, RLS, private document storage.
- `src/data`: workspace API, Evergreen seed, local adapter, Supabase client factory.
- `src/domain.ts`: compliance calculations, approval/completion rules, CSV export.
- `src/App.tsx`: workspace views, review, documents, audit, acknowledgments.
- `src/pdf/acknowledgmentPdf.ts`: printable acknowledgment sheet.
- `src/domain.test.ts` / `src/data/localApi.test.ts`: unit tests.
- `tests/workflows.spec.ts`: end-to-end browser checks.

To restore the original fictional dataset in local mode, use **Settings → Reset sample workspace**.
