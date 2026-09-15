import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  parseServiceAccount,
  callVertexGenerate,
  VertexAuthError,
  VertexGenerateError,
  type ServiceAccount,
} from "./vertex.ts";

/**
 * extract-pcsp — AI document-ingestion for PCSPs and annual physician
 * orders (Gemini via Vertex AI).
 *
 * The Vertex AI service-account JSON lives ONLY in the
 * VERTEX_SERVICE_ACCOUNT_JSON environment variable (set as a Supabase
 * function secret), alongside VERTEX_PROJECT_ID (required),
 * VERTEX_LOCATION (default us-central1), and GEMINI_MODEL (model fallback).
 * Credential material is never logged, never returned, and never stored
 * in the database — agency_ai_settings deliberately carries only the
 * verification timestamp and project id, never credentials.
 *
 * Vertex AI (Google Cloud) is the BAA-coverable path: the agency accepts
 * Google's HIPAA Business Associate Addendum in Cloud Console before AI
 * processing is enabled for real PHI. The old Gemini Developer API key
 * path is removed.
 *
 * PHI minimization: the caller-supplied document_text is truncated
 * server-side to ~120k characters before it ever reaches the model, so we
 * send the smallest slice that can still hold a full plan.
 *
 * Auth: the JWT caller's membership must hold `documents.review` in the
 * upload's agency, and the agency's ai_processing_enabled flag must be
 * true (BAA gate — see docs/ai-model-settings.md). mark_extraction_complete
 * is service-role-only; callers can never write extraction rows directly.
 */
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

// Characters of document_text sent to the model. ~120k chars ≈ 30k tokens:
// small enough to avoid shipping an entire plan to a third party when the
// caller passes more, large enough for a full PCSP.
const MAX_DOC_CHARS = 120_000;

// ---------------------------------------------------------------------------
// PCSP JSON schema (v1) — every field nullable; per-field `confidence` 0..1
// where the model can provide it. Sent to Vertex AI as responseSchema and
// re-checked below after generation.
// ---------------------------------------------------------------------------
const PCSP_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    individual: {
      type: "object",
      properties: {
        full_name: { type: "string", nullable: true },
        date_of_birth: { type: "string", nullable: true },
        medicaid_id: { type: "string", nullable: true },
        confidence: { type: "number", nullable: true },
      },
    },
    plan: {
      type: "object",
      properties: {
        effective_date: { type: "string", nullable: true },
        expiry_date: { type: "string", nullable: true },
        annual_review_due_date: { type: "string", nullable: true },
        confidence: { type: "number", nullable: true },
      },
    },
    outcomes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          support_strategies: {
            type: "array",
            items: { type: "string" },
            nullable: true,
          },
          confidence: { type: "number", nullable: true },
        },
      },
      nullable: true,
    },
    protocols_referenced: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", nullable: true },
          category: { type: "string", nullable: true },
          confidence: { type: "number", nullable: true },
        },
      },
      nullable: true,
    },
    dietary: {
      type: "object",
      properties: {
        description: { type: "string", nullable: true },
        confidence: { type: "number", nullable: true },
      },
      nullable: true,
    },
    behavioral_supports: {
      type: "object",
      properties: {
        description: { type: "string", nullable: true },
        confidence: { type: "number", nullable: true },
      },
      nullable: true,
    },
    staff_training_requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", nullable: true },
          due_date: { type: "string", nullable: true },
          confidence: { type: "number", nullable: true },
        },
      },
      nullable: true,
    },
    physician_orders: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string", nullable: true },
          date: { type: "string", nullable: true },
          confidence: { type: "number", nullable: true },
        },
      },
      nullable: true,
    },
    signatures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", nullable: true },
          name: { type: "string", nullable: true },
          signed: { type: "boolean", nullable: true },
          date: { type: "string", nullable: true },
        },
      },
      nullable: true,
    },
  },
};

const APO_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    individual: {
      type: "object",
      properties: {
        full_name: { type: "string", nullable: true },
        date_of_birth: { type: "string", nullable: true },
        medicaid_id: { type: "string", nullable: true },
        confidence: { type: "number", nullable: true },
      },
      nullable: true,
    },
    order_date: { type: "string", nullable: true },
    expiry_date: { type: "string", nullable: true },
    orders: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string", nullable: true },
          frequency: { type: "string", nullable: true },
          confidence: { type: "number", nullable: true },
        },
      },
      nullable: true,
    },
    physician: {
      type: "object",
      properties: {
        name: { type: "string", nullable: true },
        signature_present: { type: "boolean", nullable: true },
        confidence: { type: "number", nullable: true },
      },
      nullable: true,
    },
  },
};

function extractionPrompt(documentType: string): string {
  if (documentType === "annual_physician_order") {
    return [
      "You are a document extraction assistant for a disability-services compliance platform.",
      "Extract the annual physician order details from the document text below.",
      "Return ONLY the JSON matching the response schema. Every field is nullable:",
      "use null when the document does not state it. Include per-field confidence",
      "scores between 0 and 1 where you can estimate them. Do not invent values.",
      "Never include any text outside the JSON object.",
    ].join(" ");
  }
  return [
    "You are a document extraction assistant for a disability-services compliance platform.",
    "Extract the Person-Centered Support Plan (PCSP) details from the document text below.",
    "Return ONLY the JSON matching the response schema. Every field is nullable:",
    "use null when the document does not state it. Include per-field confidence",
    "scores between 0 and 1 where you can estimate them. Do not invent values.",
    "Never include any text outside the JSON object.",
  ].join(" ");
}

function looksValidExtraction(documentType: string, data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (documentType === "annual_physician_order") {
    return (
      "orders" in d &&
      (Array.isArray(d.orders) || d.orders === null || d.orders === undefined)
    );
  }
  return (
    ("outcomes" in d || "signatures" in d || "individual" in d) &&
    (Array.isArray(d.outcomes) || d.outcomes === null || d.outcomes === undefined)
  );
}

/**
 * Deterministic fallback when the model returns malformed JSON (after one
 * retry): record an extraction whose every item needs a human check, so the
 * pipeline never crashes and a reviewer still gets a usable draft.
 */
function fallbackExtraction(
  documentType: string,
): { extracted_data: unknown; confidence: unknown; items: unknown[] } {
  return {
    extracted_data: { _unparsed: true, document_type: documentType },
    confidence: { overall: 0 },
    items: [
      {
        item_type: "other",
        title: "Manual review required — extraction failed",
        detail: {
          description:
            "The AI extractor could not parse this document. A reviewer must read the document and enter the trackable items by hand.",
        },
        due_date: null,
        confidence: 0,
        needs_human_check: true,
      },
    ],
  };
}

/**
 * Map the structured extraction onto the proposed trackable items the
 * reviewer sees: deadlines (annual review / plan expiry), staff training
 * requirements, protocols that need delegation, physician orders, and
 * missing signatures.
 */
function toTrackableItems(
  documentType: string,
  data: Record<string, unknown>,
): unknown[] {
  const items: unknown[] = [];
  const push = (
    item_type: string,
    title: string,
    detail: Record<string, unknown>,
    due_date: string | null,
    confidence: unknown,
  ) => {
    const conf =
      typeof confidence === "number" && confidence >= 0 && confidence <= 1
        ? confidence
        : null;
    items.push({
      item_type,
      title,
      detail,
      due_date,
      confidence: conf,
      needs_human_check: conf === null || conf < 0.6,
    });
  };

  if (documentType === "annual_physician_order") {
    const orders = data.orders as Array<Record<string, unknown>> | null;
    for (const o of orders ?? []) {
      if (!o?.description) continue;
      push("physician_order", String(o.description).slice(0, 160), o, null, o.confidence);
    }
    const phys = data.physician as Record<string, unknown> | null;
    if (phys && phys.signature_present === false) {
      push(
        "missing_signature",
        `Missing physician signature${phys.name ? ` — ${phys.name}` : ""}`,
        { role: "physician", name: phys.name ?? null, signed: false },
        null,
        phys.confidence,
      );
    }
    if (data.expiry_date) {
      push(
        "deadline",
        "Annual physician order expiry",
        { description: "Physician order expires — schedule renewal." },
        String(data.expiry_date).slice(0, 10),
        null,
      );
    }
    return items;
  }

  // PCSP
  const plan = data.plan as Record<string, unknown> | null;
  if (plan?.annual_review_due_date) {
    push(
      "deadline",
      "PCSP annual review due",
      { description: "Annual review date stated in the PCSP." },
      String(plan.annual_review_due_date).slice(0, 10),
      plan.confidence,
    );
  }
  if (plan?.expiry_date) {
    push(
      "deadline",
      "PCSP plan expiry",
      { description: "Plan expiry date stated in the PCSP." },
      String(plan.expiry_date).slice(0, 10),
      plan.confidence,
    );
  }
  const training = data.staff_training_requirements as
    | Array<Record<string, unknown>>
    | null;
  for (const t of training ?? []) {
    if (!t?.topic) continue;
    push(
      "training_requirement",
      `Staff training: ${String(t.topic).slice(0, 120)}`,
      { topic: t.topic },
      t.due_date ? String(t.due_date).slice(0, 10) : null,
      t.confidence,
    );
  }
  const protocols = data.protocols_referenced as
    | Array<Record<string, unknown>>
    | null;
  for (const p of protocols ?? []) {
    if (!p?.name) continue;
    push(
      "protocol_needs_delegation",
      `Protocol needs delegation: ${String(p.name).slice(0, 120)}`,
      {
        protocol_name: p.name,
        category: p.category ?? null,
        description: `Protocol referenced in the PCSP: ${p.name}.`,
      },
      null,
      p.confidence,
    );
  }
  const orders = data.physician_orders as Array<Record<string, unknown>> | null;
  for (const o of orders ?? []) {
    if (!o?.description) continue;
    push("physician_order", String(o.description).slice(0, 160), o, null, o.confidence);
  }
  const sigs = data.signatures as Array<Record<string, unknown>> | null;
  for (const s of sigs ?? []) {
    if (s?.signed === false) {
      push(
        "missing_signature",
        `Missing signature — ${s.role ?? "unknown role"}`,
        { role: s.role ?? null, name: s.name ?? null, signed: false },
        null,
        null,
      );
    }
  }
  return items;
}

/**
 * Read the Vertex AI configuration from the function secrets. Missing
 * service-account JSON or project id is a server misconfiguration (500) —
 * never a user error. The JSON is parsed but never logged.
 */
function loadVertexConfig(): { sa: ServiceAccount; projectId: string; location: string } {
  const saJson = Deno.env.get("VERTEX_SERVICE_ACCOUNT_JSON");
  const projectId = Deno.env.get("VERTEX_PROJECT_ID");
  if (!saJson || !projectId) {
    throw json(
      { error: "Vertex AI service account is not configured." },
      500,
    );
  }
  let sa: ServiceAccount;
  try {
    sa = parseServiceAccount(saJson);
  } catch (e) {
    throw json(
      { error: "Vertex AI service account is not configured." },
      500,
    );
  }
  const location = Deno.env.get("VERTEX_LOCATION") || "us-central1";
  return { sa, projectId, location };
}

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

  // Verify action: minimal Vertex AI generateContent call to prove the
  // service account works. Platform-operator only — agency admins and
  // roles.manage must not reach this path. No credential material is returned.
  if (body.action === "verify") {
    let vertex: { sa: ServiceAccount; projectId: string; location: string };
    try {
      vertex = loadVertexConfig();
    } catch (resp) {
      return resp as Response;
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.platform_admin) {
      return json(
        { error: "Only the Complyrer operator can verify the AI service account." },
        403,
      );
    }
    try {
      const result = await callVertexGenerate({
        sa: vertex.sa,
        projectId: vertex.projectId,
        location: vertex.location,
        model:
          Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash",
        body: {
          contents: [
            {
              role: "user",
              parts: [{ text: "Reply with the single word: ok" }],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 8 },
        },
      });
      if (!result.ok) {
        return json(
          {
            ok: false,
            error: `Vertex AI returned HTTP ${result.status}. Check the service account, project, and region.`,
          },
          502,
        );
      }
      // Record the verification timestamp + project — the settings row
      // carries no credential material.
      if (body.agency_id && typeof body.agency_id === "string") {
        await admin
          .from("agency_ai_settings")
          .upsert(
            {
              agency_id: body.agency_id,
              service_account_verified_at: new Date().toISOString(),
              vertex_project_id: vertex.projectId,
            },
            { onConflict: "agency_id" },
          );
      }
      return json({ ok: true, project_id: vertex.projectId });
    } catch (e) {
      // VertexAuthError / VertexGenerateError carry status-only messages.
      return json(
        { ok: false, error: `Verification failed: ${(e as Error).message}` },
        502,
      );
    }
  }

  const uploadId = body.upload_id as string | undefined;
  const documentType = body.document_type as string | undefined;
  const documentText = body.document_text as string | undefined;
  if (!uploadId || !documentType || typeof documentText !== "string") {
    return json(
      { error: "upload_id, document_type, and document_text are required." },
      400,
    );
  }
  if (documentType !== "pcsp" && documentType !== "annual_physician_order") {
    return json({ error: "Unknown document_type." }, 400);
  }

  // The upload must exist; the caller must hold documents.review in the
  // upload's agency; and AI processing must be enabled for that agency
  // (BAA gate).
  const { data: upload, error: uploadError } = await admin
    .from("document_uploads")
    .select("id, agency_id, document_type, status")
    .eq("id", uploadId)
    .single();
  if (uploadError || !upload) {
    return json({ error: "Upload not found." }, 404);
  }
  const { data: membership } = await admin
    .from("memberships")
    .select("agency_id, role_key, role")
    .eq("user_id", user.id)
    .eq("agency_id", (upload as { agency_id: string }).agency_id)
    .maybeSingle();
  if (!membership) {
    return json({ error: "You are not a member of this agency." }, 403);
  }
  const { data: callerRole } = await admin
    .from("agency_roles")
    .select("permissions")
    .eq("agency_id", (membership as { agency_id: string }).agency_id)
    .eq(
      "template_key",
      (membership as { role_key?: string; role?: string }).role_key ??
        String((membership as { role?: string }).role),
    )
    .maybeSingle();
  if (
    (callerRole as { permissions?: Record<string, boolean> } | null)
      ?.permissions?.["documents.review"] !== true
  ) {
    return json(
      { error: "You do not have permission to review documents." },
      403,
    );
  }
  const { data: settings } = await admin
    .from("agency_ai_settings")
    .select("ai_processing_enabled, model")
    .eq("agency_id", (upload as { agency_id: string }).agency_id)
    .maybeSingle();
  if (
    !(settings as { ai_processing_enabled?: boolean } | null)?.ai_processing_enabled
  ) {
    return json(
      {
        error:
          "AI processing is not enabled for this agency. An administrator must enable it after a BAA with Google is in place.",
        baa_required: true,
      },
      403,
    );
  }

  let vertex: { sa: ServiceAccount; projectId: string; location: string };
  try {
    vertex = loadVertexConfig();
  } catch (resp) {
    return resp as Response;
  }
  // Agency-selected model takes precedence; GEMINI_MODEL is a fallback for
  // environments where the agency settings row was never saved.
  const model =
    (settings as { model?: string } | null)?.model ||
    Deno.env.get("GEMINI_MODEL") ||
    "gemini-2.5-flash";

  // PHI minimization: truncate server-side before the Vertex AI call.
  const truncated = documentText.slice(0, MAX_DOC_CHARS);
  const schema =
    documentType === "pcsp" ? PCSP_RESPONSE_SCHEMA : APO_RESPONSE_SCHEMA;

  async function callModel(): Promise<
    { ok: true; data: unknown } | { ok: false; status: number; error: string }
  > {
    let result: Awaited<ReturnType<typeof callVertexGenerate>>;
    try {
      result = await callVertexGenerate({
        sa: vertex.sa,
        projectId: vertex.projectId,
        location: vertex.location,
        model,
        body: {
          contents: [
            {
              role: "user",
              parts: [
                { text: extractionPrompt(documentType) },
                { text: truncated },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.1,
          },
        },
      });
    } catch (e) {
      if (e instanceof VertexAuthError) {
        return { ok: false, status: 502, error: "Vertex AI credentials were rejected." };
      }
      if (e instanceof VertexGenerateError) {
        return { ok: false, status: 502, error: "Vertex AI request failed." };
      }
      return { ok: false, status: 502, error: "Vertex AI request failed." };
    }
    if (!result.ok) {
      // HTTP status only — never the response body (could carry PHI or
      // credential hints).
      return {
        ok: false,
        status: 502,
        error: `Vertex AI returned HTTP ${result.status}.`,
      };
    }
    const payload = result.json as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("");
    if (!text) return { ok: false, status: 502, error: "Vertex AI returned no content." };
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: 502, error: "Vertex AI returned unparseable content." };
    }
  }

  // Mark the upload as extracting before the call (best-effort; service
  // role bypasses RLS).
  await admin
    .from("document_uploads")
    .update({ status: "extracting" })
    .eq("id", uploadId);

  // One retry on malformed output, then the deterministic fallback so the
  // pipeline never crashes — every item gets needs_human_check.
  let parsed: unknown = null;
  let fallbackUsed = false;
  let lastError = "extraction failed";
  const first = await callModel();
  if (first.ok && looksValidExtraction(documentType, first.data)) {
    parsed = first.data;
  } else {
    if (!first.ok) lastError = first.error;
    const second = await callModel();
    if (second.ok && looksValidExtraction(documentType, second.data)) {
      parsed = second.data;
    } else {
      if (!second.ok) lastError = second.error;
      const fb = fallbackExtraction(documentType);
      parsed = fb.extracted_data;
      fallbackUsed = true;
    }
  }
  if (!fallbackUsed && parsed === null) {
    // Should be unreachable (callModel either parses or we fall back), but
    // fail closed rather than proceeding with an empty extraction.
    return json({ error: lastError }, 502);
  }

  const data = (parsed ?? {}) as Record<string, unknown>;
  const items = fallbackUsed
    ? (fallbackExtraction(documentType).items as unknown[])
    : toTrackableItems(documentType, data);
  const confidence = fallbackUsed
    ? { overall: 0, fallback: true }
    : { overall: 0.8 };

  const { data: rpcResult, error: rpcError } = await admin.rpc(
    "mark_extraction_complete",
    {
      p_upload_id: uploadId,
      p_extracted_data: data,
      p_confidence: confidence,
      p_model: model,
      p_items: items,
      p_schema_version: 1,
    },
  );
  if (rpcError) {
    // The extraction rows were not written — leave the audit trail in the
    // edge function response, not in the DB. Never leak credentials.
    return json(
      {
        error: "Extraction completed but could not be recorded.",
        detail: rpcError.message,
      },
      500,
    );
  }

  return json({
    ok: true,
    fallback_used: fallbackUsed,
    extraction: rpcResult,
  });
});
