# AI model settings (PCSP extraction pipeline)

The PCSP document-extraction pipeline sends uploaded PCSPs / annual
physician orders to Gemini **through Vertex AI (Google Cloud)** — not the
Gemini Developer API. Vertex AI is the path a Google Cloud HIPAA BAA can
cover. Full operator steps: [docs/vertex-ai-setup.md](./vertex-ai-setup.md).

## Secrets the ship step must set

Set these as **Supabase function secrets** for the `extract-pcsp` function
(`supabase/functions/extract-pcsp/index.ts`). They are NOT database
columns and must never land in a migration, a `.env` file in the repo,
memory, or chat.

| Secret                        | Required | Default            | Notes                                                              |
| ----------------------------- | -------- | ------------------ | ------------------------------------------------------------------ |
| `VERTEX_SERVICE_ACCOUNT_JSON` | yes      | —                  | Service-account JSON key. Read from `Deno.env` only. Never logged, never returned, never stored. |
| `VERTEX_PROJECT_ID`           | yes      | —                  | GCP project id. Recorded on `agency_ai_settings.vertex_project_id` at verification (display only). |
| `VERTEX_LOCATION`             | no       | `us-central1`      | Vertex AI region.                                                  |
| `GEMINI_MODEL`                | no       | `gemini-2.5-flash` | Falls back to the agency's `agency_ai_settings.model` row.         |

The old `GEMINI_API_KEY` Developer-API secret is no longer read — delete
it at ship time (`supabase secrets unset GEMINI_API_KEY`).

## Verify

On the admin AI settings screen, "Verify service account" calls
`extract-pcsp` with `{ action: "verify" }`: the function mints an OAuth
access token from the service-account JSON and runs one minimal
`generateContent` call ("Reply with the single word: ok"). On success it
stamps `agency_ai_settings.service_account_verified_at` and
`vertex_project_id` and returns `{ ok: true, project_id }` — credential
material is never echoed back.

## BAA requirement

`agency_ai_settings.ai_processing_enabled` defaults to **false**.
The `extract-pcsp` function refuses to call Vertex AI while it is false and
returns a `403` with `baa_required: true` and this message:

> "AI processing is not enabled for this agency. An administrator must
> enable it after a BAA with Google is in place."

Sending PHI to Google without a Business Associate Agreement would be a
HIPAA violation. The administrator flips the flag (roles.manage-gated,
`set_agency_ai_settings` RPC, model + enabled flag only) only after
accepting the Google Cloud HIPAA BAA (Cloud Console → IAM & Admin →
HIPAA Business Associate Addendum). The flag flip is written to
`document_audit_log`.

## PHI minimization

- The client uploads the PDF to the private `pcsp-documents` bucket; the
  edge function receives only the **text** the client chose to send.
- `extract-pcsp` truncates `document_text` server-side to ~120k
  characters before the Vertex AI call — a full PCSP fits, but nothing
  extra is transmitted.
- The prompt instructs the model to return `null` for anything the
  document does not state (no hallucinated PHI).
- On malformed model output the function retries once, then records a
  deterministic fallback extraction whose every item carries
  `needs_human_check: true` — the pipeline never crashes on bad JSON.
- On Vertex AI errors the function returns the HTTP status only — never
  response bodies, which could carry PHI or credential hints.
- The agency_id-scoped RLS policies mean ordinary staff only ever see
  approved/activated items at their own sites; raw extraction JSON is
  reviewers-only.

## Rotation / revocation

To rotate: create a new JSON key on the same service account, re-run
`supabase secrets set VERTEX_SERVICE_ACCOUNT_JSON=...`, then delete the
old key in Cloud Console. No database row carries a credential, so there
is nothing to clean up in the DB. Deleting or disabling the key in IAM &
Admin revokes access immediately; the function fails closed with a 502.
