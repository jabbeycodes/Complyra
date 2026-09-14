# AI model settings (PCSP extraction pipeline)

The PCSP document-extraction pipeline sends uploaded PCSPs / annual
physician orders to Google Gemini for structured extraction. This page is
the exact secrets list for the ship step, plus the Secure Vault flow and
the compliance notes.

## Secrets the ship step must set

Set these as **Supabase function secrets** for the `extract-pcsp` function
(`supabase/functions/extract-pcsp/index.ts`). They are NOT database
columns and must never land in a migration, a `.env` file in the repo,
memory, or chat.

| Secret             | Required | Default            | Notes                                                         |
| ------------------ | -------- | ------------------ | ------------------------------------------------------------- |
| `GEMINI_API_KEY`   | yes      | —                  | Read from `Deno.env` only. Never logged, never returned, never stored. |
| `GEMINI_MODEL`     | no       | `gemini-2.5-flash` | Falls back to the agency's `agency_ai_settings.model` row.    |

CLI (run from the repo root, after the migration is applied):

```bash
supabase secrets set GEMINI_API_KEY='<the key>' --project-ref <ref>
# optional:
supabase secrets set GEMINI_MODEL='gemini-2.5-flash' --project-ref <ref>
```

Then deploy the function (source only — the ship step decides when):

```bash
supabase functions deploy extract-pcsp --project-ref <ref>
```

## Secure Vault flow for the key value

1. Joshua opens the Secure Vault capture page and pastes the Gemini API
   key there himself (same pattern as his Hostinger mailbox password —
   he types it, Anert never sees it).
2. Anert reads the key **transiently** only for the `supabase secrets set`
   call above, in the ship turn, then discards it. The value is not
   written to any file, environment variable, log, or memory entry.
3. Verification: on the admin AI settings screen, the "Verify key" button
   calls `extract-pcsp` with `{ action: "verify" }`, which makes a minimal
   Gemini `models.list` call and returns `{ ok: true, model_count }` — the
   key value is never echoed back. On success the function stamps
   `agency_ai_settings.key_last_verified_at` (a row that carries no key).

## BAA requirement

`agency_ai_settings.ai_processing_enabled` defaults to **false**.
The `extract-pcsp` function refuses to call Gemini while it is false and
returns a `403` with `baa_required: true` and this message:

> "AI processing is not enabled for this agency. An administrator must
> enable it after a BAA with Google is in place."

Sending PHI to Google without a Business Associate Agreement would be a
HIPAA violation. The administrator flips the flag (roles.manage-gated,
`set_agency_ai_settings` RPC, model + enabled flag only) only after the
BAA is signed. The flag flip is written to `document_audit_log`.

## PHI minimization

- The client uploads the PDF to the private `pcsp-documents` bucket; the
  edge function receives only the **text** the client chose to send.
- `extract-pcsp` truncates `document_text` server-side to ~120k
  characters before the Gemini call — a full PCSP fits, but nothing extra
  is transmitted.
- The prompt instructs the model to return `null` for anything the
  document does not state (no hallucinated PHI).
- On malformed model output the function retries once, then records a
  deterministic fallback extraction whose every item carries
  `needs_human_check: true` — the pipeline never crashes on bad JSON.
- The agency_id-scoped RLS policies mean ordinary staff only ever see
  approved/activated items at their own sites; raw extraction JSON is
  reviewers-only.

## Rotation / revocation

To rotate: generate a new key in the Google AI Studio console, re-run
`supabase secrets set GEMINI_API_KEY=...`, then revoke the old key. No
database row carries the key, so there is nothing to clean up in the DB.
