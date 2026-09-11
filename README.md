# Complyra

**The compliance operating system for care agencies.**

Complyra turns care plans, policies, and regulatory requirements into trackable responsibilities, helping agency leaders understand what is required, who owns it, what is missing, and where audit risk exists.

## Run locally

```sh
npm install
npm run dev
```

Open the local address printed by Vite (normally http://127.0.0.1:5173).

```sh
npm run build
npm test
npx playwright install chromium
npx playwright test
```

## What this version does

This is a working, browser-based product preview. Evergreen Care, its six homes, 24 individuals, 18 staff, and all document records are fictional. The dashboard uses a fixed September 11, 2026 sample snapshot.

- Agency and site readiness, with live calculations from the sample requirements.
- Searchable requirement lists, status filters, owner assignments, individual profiles, and site summaries.
- Plan index with current, draft, and archived versions. Approving a plan update retains earlier versions.
- Manual draft creation and approval. Drafts do not affect the active compliance score.
- Completion evidence notes that update readiness and appear in the activity timeline.
- Audit scope by site, individual, staff member, category, and due-date range, with a CSV register export.
- A read-only audit screen; this is a UI behavior, not a server permission boundary.
- Deterministic sample-record lookups through “Ask Complyra,” with links to source references.
- Responsive layouts, keyboard-accessible dialogs, locally served fonts, and browser persistence.

Sample PDF selection records the plan index and a manually entered requirement. File bytes are not uploaded, analyzed, or retained. The document title is derived from the selected sample individual. A selected file is **not** an archived source document.

## Scope and production boundary

**Do not enter real individual, patient, or employee data.** This preview stores state in the browser's local storage. It has no authentication, backend, tenant isolation, secure document repository, or tamper-resistant audit trail. No HIPAA or regulatory compliance claim is made.

The following are still production work: authentication and enforced agency/site permissions; protected document uploads; document intelligence; verified electronic signatures; nursing authorization and delegation renewal rules; scheduled reminders and escalations; full evidence packets with original documents; auditor invitations; a digital form builder; HR onboarding; and external integrations.

The assistant performs transparent keyword-based lookups, not language-model analysis. It cannot answer clinical questions from original plan text. Completion notes are not electronic signatures. Notifications are displayed sample priorities, not delivered messages. The compliance score describes recorded completion; it does not certify audit readiness or safe care.

See [the production design](docs/production-design.md) for the next implementation boundaries.

## Main files

- `src/domain.ts`: sample records, compliance calculations, approval and completion rules, CSV export.
- `src/App.tsx`: workspace views and review, completion, document, audit, and assistant flows.
- `src/Dashboard.tsx`: overview and site readiness.
- `src/components.tsx`: shared accessible dialogs, tables, badges, and inputs.
- `src/styles.css`: responsive visual system.
- `src/domain.test.ts`: integrity checks for approval, evidence, scoring, and exports.
- `tests/workflows.spec.ts`: end-to-end browser checks.

To restore the original dataset, use **Settings → Reset sample workspace**. Reset affects only this browser and asks for confirmation.
