# Vertex AI setup (PCSP extraction pipeline)

The `extract-pcsp` edge function calls Gemini through **Vertex AI (Google
Cloud)** — not the Gemini Developer API. Vertex AI is the path a Google
Cloud HIPAA Business Associate Addendum (BAA) can cover, which is required
before Complyrer processes real PHI. Complyrer stores **no credential**:
the service-account JSON, project id, and location are Supabase function
secrets read from `Deno.env` by the edge function only. The database keeps
only the verification timestamp (`service_account_verified_at`) and the
project id (`vertex_project_id`) on `agency_ai_settings`.

## Operator steps

1. **Google Cloud project + billing.** Create (or pick) a GCP project for
   Complyrer. Billing must be enabled on the project — Vertex AI is a
   billed API.
2. **Enable the Vertex AI API.** In Cloud Console: APIs & Services →
   Library → search "Vertex AI API" → Enable.
3. **Accept the BAA.** In Cloud Console: IAM & Admin → HIPAA Business
   Associate Addendum → accept for the project. AI processing must stay OFF
   per agency (`ai_processing_enabled` defaults to false) until this is
   done — the edge function refuses to call Vertex AI otherwise and returns
   a `403` with `baa_required: true`.
4. **Create the service account.** IAM & Admin → Service Accounts →
   Create. Grant it the **Vertex AI User** role (`roles/aiplatform.user`).
   No other roles are needed — the function only calls
   `publishers.models.generateContent`.
5. **Create a JSON key.** Open the service account → Keys → Add key →
   Create new key → JSON. Download the file.
6. **Set the function secrets** (from the repo root):
   ```bash
   supabase secrets set VERTEX_SERVICE_ACCOUNT_JSON="$(cat /path/to/key.json)"
   supabase secrets set VERTEX_PROJECT_ID=<your-gcp-project-id>
   # optional — defaults to us-central1:
   supabase secrets set VERTEX_LOCATION=us-central1
   # optional — model id; the agency's saved model takes precedence:
   supabase secrets set GEMINI_MODEL='gemini-2.5-flash'
   ```
   These are NOT database columns and must never land in a migration, a
   `.env` file in the repo, memory, or chat.
7. **Apply the migration** (adds `vertex_project_id`, renames
   `key_last_verified_at` → `service_account_verified_at`):
   ```bash
   supabase db push
   ```
8. **Deploy the function**:
   ```bash
   supabase functions deploy extract-pcsp --project-ref <ref>
   ```
9. **Delete the old secret.** The Developer API key path is removed —
   delete the now-unused `GEMINI_API_KEY` function secret:
   ```bash
   supabase secrets unset GEMINI_API_KEY
   ```
10. **Verify in the app.** As an administrator, open AI settings →
    "Verify service account". The function mints an OAuth token and runs a
    minimal generateContent call. On success the settings screen shows
    "Configured — verified <date>" and the project id.

## Secure Vault flow for the key value

Joshua opens the Secure Vault capture page and pastes the service-account
JSON there himself. Anert reads it **transiently** only for the
`supabase secrets set VERTEX_SERVICE_ACCOUNT_JSON=...` call in the ship
turn, then discards it. The value is not written to any file, environment
variable, log, or memory entry.

## Verification semantics

- The "Verify service account" button calls `extract-pcsp` with
  `{ action: "verify" }`. The function mints an access token via the JWT
  bearer grant and makes one minimal `generateContent` call
  ("Reply with the single word: ok", `maxOutputTokens: 8`). It returns
  `{ ok: true, project_id }` — credential material is never echoed back.
- On success the function stamps
  `agency_ai_settings.service_account_verified_at` and
  `vertex_project_id` (a row that carries no credential).
- Token mint failure → HTTP 502. Vertex AI non-OK → HTTP 502 with the
  status only — response bodies are never surfaced (they could carry PHI
  or credential hints).

## Rotation / revocation

Create a new JSON key on the same service account, re-run
`supabase secrets set VERTEX_SERVICE_ACCOUNT_JSON=...`, then delete the
old key in Cloud Console. Nothing in the database needs cleanup — no
credential is stored there. To revoke immediately, delete or disable the
key in IAM & Admin; the function fails closed with a 502.
