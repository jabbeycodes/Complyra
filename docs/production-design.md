# From Complyrer preview to a production service

This document describes the intended architecture, not security controls implemented in the preview. Real care records must remain outside this build.

## Product promise

The central record is the individual's approved PCSP/ISP. Uploaded source documents produce proposed obligations. An authorized reviewer approves the source interpretation, owner, frequency, due date, and evidence requirements. Staff receive those obligations through their actual site assignments. Completed work has retained evidence and version-specific acknowledgment records.

Readiness is a view of recorded obligations and evidence, not an automated determination of regulatory compliance. Show unknown, missing, unreviewed, and expired information explicitly.

## Application boundary

Use a server application with a relational database, private document storage, an identity provider, and an asynchronous job queue. The browser should receive only data it is permitted to display. Do not turn this local-storage demo into a PHI repository by adding a login screen alone.

Every request must establish a verified user, agency membership, role, and site/program scope. Obtain agency context from that authenticated membership; never trust a client-supplied agency identifier as authorization. Enforce the same policy for tables, search results, file downloads, exports, notifications, and assistant retrieval.

## Core records

- Agencies → programs → sites → individuals.
- Users, agency memberships, role permissions, and dated program/site/individual staff assignments.
- Documents with immutable versions, encrypted private storage references, content hashes, effective dates, review state, and supersession links.
- Requirement drafts and approved requirement versions, each tied to a source version and page/section.
- Recurring obligation instances, assigned owners, due dates, evidence expectations, and a separate completion decision.
- Acknowledgments tied to the exact document version, signer identity, signature meaning, signed time, and evidence hash.
- Delegations tied to an authorized nurse, individual, staff member, task, training record, effective interval, expiration, and renewal history.
- Evidence records, immutable security events, reminder deliveries, escalation jobs, and export manifests.

All tenant-owned records carry a non-null agency identifier. Composite foreign keys must prevent a row in one agency from pointing at a row in another. Database row-level policies should enforce tenant scope, with the application providing finer-grained assignment checks. Background jobs must run with an explicit, validated tenant context.

## Document ingestion and approval

1. Check uploader permission and create a pending, tenant-bound document record.
2. Accept the file into quarantine with size/type restrictions, malware scanning, hash calculation, and encrypted private storage.
3. Extract text/OCR in a controlled worker. Treat all document contents as untrusted data, never executable instructions.
4. Propose structured requirements with exact source text, page positions, confidence, and missing fields. Do not invent clinical instructions, frequencies, or owners.
5. Compare against the previously approved version and show added, removed, and changed requirements.
6. Require an authorized human to approve material changes. Enforce the approval transition on the server.
7. Activate the new version and associated obligations atomically. Preserve prior documents, approvals, evidence, and acknowledgments.
8. Recalculate affected staff obligations from dated assignments and issue idempotent notification jobs.

The future AI provider must be selected and configured to meet the agency's contractual and data-handling requirements before sensitive documents are sent to it. Retrieval must apply agency and assignment filters before exposing data to the model.

## Rules and evidence

Represent due dates and recurrence explicitly in the agency's time zone. Compute overdue/expired states from the clock rather than editable UI labels. A periodic job creates the next obligation instance without overwriting completion history. Repeated job delivery must not duplicate assignments or notifications.

Evidence submission and approval are separate events when the category requires manager or nurse verification. A text note alone must not complete a regulated signature, competency, or delegation requirement. An expired delegation cannot be renewed by a DSP marking a checkbox.

Store the source requirement version with each obligation instance. When a plan changes, retain the old instance and create or supersede obligations according to the reviewed change. Record who made that decision and why.

## Permission model

Agency and compliance administrators manage agency-wide requirements within configured permissions. Program and house managers manage assigned scopes. DSPs see only assigned individuals and obligations. Nurses control authorized clinical delegation actions. HR can access relevant employee records without automatically receiving clinical records. Auditors receive explicitly scoped, time-limited read access with no general agency membership escalation.

Use deny-by-default policies. Check authorization on every mutation and download. Test cross-agency and cross-site access using fabricated identifiers, file references, search terms, and expired auditor links.

## Operations and retention

Require encrypted transport and encrypted private storage with managed keys. Use short-lived, authorization-checked download URLs, least-privilege service identities, MFA for privileged users, session expiration, and account revocation. Keep sensitive contents out of application logs and analytics.

Write critical events server-side to an append-only audit store protected from ordinary application update/delete rights. Include actor, agency, action, target version, timestamp, and request identifier. Corrections append a new event; they do not alter the original.

Define retention and legal-hold policies with the agency. Verify encrypted backups through restoration exercises, and establish incident response and recovery objectives before launch. Keep operational evidence for these controls; a design document does not establish compliance.

## Audit exports

Build export packets in authorized server jobs. Freeze the scope, date range, and document versions in a manifest. Include original evidence, verification records, and a gaps report; never silently omit missing evidence. Create an expiring, private download, log its creation/access, and recheck permission before delivery.

## Production release gates

- Authentication, tenant isolation, site assignment permissions, and server authorization tests pass.
- File ingestion, malware handling, private access, and source retention are verified.
- Human review and version transitions remain correct under concurrent updates.
- Signature identity, delegation authority, recurrence, and expiration workflows are validated with the agency.
- Reminder delivery, retries, idempotency, escalation, and delivery logs are working.
- Audit trail integrity and backup restoration are demonstrated.
- A security review and appropriate contractual/operational readiness review are complete before real sensitive data is introduced.
