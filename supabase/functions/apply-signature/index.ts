import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Canonical JSON: recursively sort object keys so the same payload always
// hashes to the same digest regardless of key order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json({ error: "Server is not configured" }, 500);
  }

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, service);

  const {
    data: { user },
    error: userError,
  } = await caller.auth.getUser();
  if (userError || !user) return json({ error: "Not signed in" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  // -- Validate the request ----------------------------------------------------
  const documentType =
    typeof body.document_type === "string" ? body.document_type.trim() : "";
  const documentId =
    typeof body.document_id === "string" ? body.document_id.trim() : "";
  const fieldName =
    typeof body.field_name === "string" ? body.field_name.trim() : "";
  const signatureKind = body.signature_kind;
  const documentPayload = body.document_payload;
  const agencyIdRaw =
    body.agency_id === undefined || body.agency_id === null
      ? null
      : String(body.agency_id);

  if (!documentType || documentType.length > 128) {
    return json({ error: "document_type must be 1–128 characters." }, 400);
  }
  if (!documentId || documentId.length > 256) {
    return json({ error: "document_id must be 1–256 characters." }, 400);
  }
  if (!fieldName || fieldName.length > 128) {
    return json({ error: "field_name must be 1–128 characters." }, 400);
  }
  if (signatureKind !== "signature" && signatureKind !== "initials") {
    return json({ error: 'signature_kind must be "signature" or "initials".' }, 400);
  }
  if (
    documentPayload === null ||
    typeof documentPayload !== "object" ||
    Array.isArray(documentPayload)
  ) {
    return json({ error: "document_payload must be a non-null object." }, 400);
  }
  // 1 MB cap on the payload before hashing/storing.
  const payloadText = stableStringify(documentPayload);
  if (payloadText.length > 1024 * 1024) {
    return json({ error: "document_payload exceeds the 1 MB limit." }, 400);
  }
  if (agencyIdRaw !== null && !UUID_RE.test(agencyIdRaw)) {
    return json({ error: "agency_id must be a valid UUID." }, 400);
  }

  // -- Server checks ------------------------------------------------------------
  // Anti-impersonation: the signer is ALWAYS the JWT subject. A user_id in the
  // body is never accepted, so nobody can stamp another person's signature.
  const { data: adopted, error: adoptedError } = await admin
    .from("user_signatures")
    .select("signature_path, initials_path, consent_at, consent_text_version")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adoptedError) {
    console.error("apply-signature: user_signatures lookup failed", adoptedError.message);
    return json({ error: "Could not verify the adopted signature." }, 500);
  }
  if (!adopted || !adopted.consent_at) {
    return json(
      { error: "No adopted signature on file. Adopt a signature before signing." },
      403,
    );
  }

  const imagePath =
    signatureKind === "signature" ? adopted.signature_path : adopted.initials_path;
  if (!imagePath) {
    return json(
      {
        error:
          "No adopted " +
          (signatureKind === "signature" ? "signature" : "initials") +
          " on file. Adopt one before signing.",
      },
      403,
    );
  }

  // Confirm the adopted image actually exists in storage.
  const { error: storageError } = await admin.storage
    .from("user-signatures")
    .download(imagePath);
  if (storageError) {
    console.error("apply-signature: signature image missing", storageError.message);
    return json(
      {
        error:
          "The adopted signature image was not found. Re-adopt your signature before signing.",
      },
      403,
    );
  }

  // Resolve the agency from the caller's membership when possible; fall back
  // to the caller's explicit value.
  let agencyId: string | null = null;
  const { data: membership } = await admin
    .from("memberships")
    .select("agency_id")
    .eq("user_id", user.id)
    .is("expires_on", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membership?.agency_id) {
    agencyId = membership.agency_id;
  } else {
    const { data: anyMembership } = await admin
      .from("memberships")
      .select("agency_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    agencyId = anyMembership?.agency_id ?? agencyIdRaw;
  }

  // -- Stamp the event ------------------------------------------------------------
  const documentHash = await sha256Hex(payloadText);
  const consentVersion = adopted.consent_text_version;

  const { data: event, error: insertError } = await admin
    .from("signature_events")
    .insert({
      document_type: documentType,
      document_id: documentId,
      field_name: fieldName,
      kind: signatureKind,
      signer_user_id: user.id,
      document_hash: documentHash,
      consent_version: consentVersion,
      agency_id: agencyId,
    })
    .select("id, signed_at, signer_user_id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return json(
        { error: "This field has already been signed for this document." },
        409,
      );
    }
    console.error("apply-signature: insert failed", insertError.message);
    return json({ error: "Could not record the signature." }, 500);
  }

  console.log(
    "apply-signature: signed",
    documentType,
    user.id,
  );

  return json({
    event_id: event.id,
    signed_at: event.signed_at,
    signer_user_id: event.signer_user_id,
    kind: signatureKind,
    document_hash: documentHash,
    signature_path: adopted.signature_path,
    initials_path: adopted.initials_path,
  });
});
