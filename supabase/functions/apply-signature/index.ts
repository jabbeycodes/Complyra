import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * apply-signature — the server-side authority for the e-signature ceremony.
 *
 * Actions (body.action):
 *   "sign"   (default) — stamp one signature/initials field. Requires a fresh
 *                         password re-entry (the 13 CSR 65-3.050 second
 *                         identification component) and passes every domain
 *                         rule below. The client mirrors these rules for UX,
 *                         but THIS function is the authority.
 *   "reauth"            — verify the caller's password against the Auth API and
 *                         record a fresh re-auth (covers a 5-minute signing
 *                         session). The password is used once for verification
 *                         and never stored. Rate-limited: 5 failures / 15 min.
 *   "log"               — record a client-observed audit event (login, logout,
 *                         document_viewed) with the server-captured IP.
 *
 * 13 CSR 65-3.050 notes:
 *   - Two distinct ID components to affix a signature: the session JWT plus a
 *     password re-entry within REAUTH_WINDOW_SECONDS (300s / 5 minutes). One
 *     re-entry covers a short signing session (e.g. initialing 60 checklist
 *     lines); a fresh signature after the window needs re-entry again.
 *   - Audit trail: every re-auth outcome and applied signature is written to
 *     public.signature_audit_log with device ID + IP; login/logout and
 *     signed-document views are logged through the "log" action.
 *   - Audit writes are best-effort-but-loud: a failed audit insert is logged
 *     to the function logs and never blocks a legitimate signing, so a
 *     logging outage cannot lock staff out of critical sign-offs. The audit
 *     table itself is append-only (no client write policies).
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** 13 CSR 65-3.050 second-ID-component window: 5 minutes of signing per re-entry. */
const REAUTH_WINDOW_SECONDS = 300;
/** Re-auth brute-force guard: max failures before a temporary lockout. */
const REAUTH_MAX_ATTEMPTS = 5;
const REAUTH_LOCKOUT_SECONDS = 15 * 60;

const HM_ROLE_KEYS = ["administrator", "house_manager", "degreed_professional_manager"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Application failure with a machine-readable code the UI can act on. */
function fail(message: string, status: number, code?: string) {
  return json(code ? { error: message, code } : { error: message }, status);
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

/** Mirrors signatureUtils.delegationRosterRowKey (client) byte-for-byte. */
function rosterRowKey(printName: string): string {
  const slug = printName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `row:${slug || "unnamed"}:initials`;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const raw =
    (forwarded ? forwarded.split(",")[0].trim() : "") ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "";
  // Only persist plausible IPs; the inet column would reject anything else.
  return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : null;
}

function deviceIdOf(body: Record<string, unknown>): string | null {
  const raw = body.device_id;
  return typeof raw === "string" && raw.length > 0 && raw.length <= 128
    ? raw
    : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNABLE_TYPES = [
  "delegation_form",
  "training_checklist",
  "hm_checklist",
  "certificate",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("Missing authorization", 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return fail("Server is not configured", 500);
  }

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, service);

  const {
    data: { user },
    error: userError,
  } = await caller.auth.getUser();
  if (userError || !user) return fail("Not signed in", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body.", 400);
  }

  const action =
    typeof body.action === "string" && body.action.trim() ? body.action.trim() : "sign";
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const deviceId = deviceIdOf(body);

  // Resolve the agency from the caller's membership when possible.
  /**
   * Resolve the agency to attribute this action to. When the caller names an
   * agency, it is honored only if the user holds an ACTIVE membership there
   * (expired memberships fail closed for authority-granting actions). The
   * fallback is the user's first active membership; only non-authority audit
   * observations fall back to an expired membership for attribution.
   */
  async function resolveAgency(
    preferred: string | null,
    requireActive: boolean,
  ): Promise<string | null> {
    const today = new Date().toISOString().slice(0, 10);
    const activeFilter = `expires_on.is.null,expires_on.gte.${today}`;
    if (preferred) {
      const { data } = await admin
        .from("memberships")
        .select("id")
        .eq("user_id", user.id)
        .eq("agency_id", preferred)
        .or(activeFilter)
        .limit(1);
      if (data && data.length > 0) return preferred;
      if (requireActive) return null;
    }
    const { data: active } = await admin
      .from("memberships")
      .select("agency_id")
      .eq("user_id", user.id)
      .or(activeFilter)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const activeAgency = (active as { agency_id?: string } | null)?.agency_id;
    if (activeAgency) return activeAgency;
    if (requireActive) return null;
    const { data: anyMembership } = await admin
      .from("memberships")
      .select("agency_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return (
      (anyMembership as { agency_id?: string } | null)?.agency_id ?? null
    );
  }

  async function audit(
    actionName: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await admin.from("signature_audit_log").insert({
      user_id: user.id,
      agency_id: extra.agency_id ?? null,
      action: actionName,
      document_type: extra.document_type ?? null,
      document_id: extra.document_id ?? null,
      field_name: extra.field_name ?? null,
      device_id: deviceId,
      ip_address: ip,
      user_agent: userAgent,
      details: extra.details ?? null,
    });
    if (error) {
      // Best-effort-but-loud: never block a legitimate signing because the
      // audit table had a bad moment; the failure is in the function logs.
      console.error("apply-signature: audit insert failed", actionName, error.message);
    }
  }

  async function hasRole(
    agencyId: string,
    roleKeys: string[],
  ): Promise<boolean> {
    const { data } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("agency_id", agencyId)
      .in("role_key", roleKeys)
      .or("expires_on.is.null,expires_on.gte." + new Date().toISOString().slice(0, 10))
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  // -- reauth: verify password, record a fresh second ID component ------------
  if (action === "reauth") {
    const password = body.password;
    if (typeof password !== "string" || password.length === 0) {
      return fail("A password is required.", 400);
    }
    const now = new Date();
    const { data: state } = await admin
      .from("signature_reauth")
      .select("failed_attempts, attempt_window_start")
      .eq("user_id", user.id)
      .maybeSingle();
    const windowStart = state?.attempt_window_start
      ? new Date(state.attempt_window_start as string)
      : null;
    const windowFresh =
      windowStart !== null &&
      now.getTime() - windowStart.getTime() < REAUTH_LOCKOUT_SECONDS * 1000;
    if (windowFresh && (state?.failed_attempts ?? 0) >= REAUTH_MAX_ATTEMPTS) {
      await audit("reauth_failed", { details: { reason: "rate_limited" } });
      return fail(
        "Too many incorrect attempts. Wait a few minutes and try again.",
        429,
        "rate_limited",
      );
    }

    const { data: fullUser, error: userLookupError } = await admin.auth.admin.getUserById(
      user.id,
    );
    const email = fullUser?.user?.email ?? null;
    if (userLookupError || !email) {
      console.error("apply-signature: reauth user lookup failed", userLookupError?.message);
      return fail("Could not verify your identity.", 500);
    }
    // Server-verified check: the password is verified against the Auth API
    // here, in the function — never trusted from a client-side claim, and
    // never persisted anywhere.
    let verified = false;
    try {
      const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: anon,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      verified = tokenRes.ok;
    } catch (err) {
      console.error("apply-signature: reauth verify call failed", (err as Error).message);
      return fail("Could not verify your identity.", 500);
    }

    const agencyId = await resolveAgency(null, true);
    if (verified && !agencyId) {
      // Fail closed here too: a successful re-auth that can never lead to a
      // signature (signing requires an active membership) would mislead the
      // user into thinking the ceremony completed.
      await audit("reauth_failed", {
        agency_id: null,
        details: { reason: "no_active_membership" },
      });
      return fail("No active agency membership found for this account.", 403);
    }
    if (verified) {
      const reauthAt = now.toISOString();
      const { error: upsertError } = await admin.from("signature_reauth").upsert(
        {
          user_id: user.id,
          reauth_at: reauthAt,
          failed_attempts: 0,
          attempt_window_start: null,
          updated_at: reauthAt,
        },
        { onConflict: "user_id" },
      );
      if (upsertError) {
        console.error("apply-signature: reauth upsert failed", upsertError.message);
        return fail("Could not record the identity check.", 500);
      }
      await audit("reauth_success", { agency_id: agencyId });
      return json({ ok: true, reauth_at: reauthAt });
    }

    const attempts = windowFresh ? (state?.failed_attempts ?? 0) + 1 : 1;
    await admin.from("signature_reauth").upsert(
      {
        user_id: user.id,
        failed_attempts: attempts,
        attempt_window_start: windowFresh
          ? (state?.attempt_window_start as string)
          : now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id" },
    );
    await audit("reauth_failed", {
      agency_id: agencyId,
      details: { reason: "bad_password", attempts },
    });
    return fail("That password is not correct.", 401, "bad_password");
  }

  // -- log: client-observed audit events (login / logout / document views) ----
  if (action === "log") {
    const logAction = body.log_action;
    if (logAction !== "login" && logAction !== "logout" && logAction !== "document_viewed") {
      return fail("log_action must be login, logout, or document_viewed.", 400);
    }
    const documentType =
      typeof body.document_type === "string" ? body.document_type.trim() : "";
    const documentId =
      typeof body.document_id === "string" ? body.document_id.trim() : "";
    if (logAction === "document_viewed" && (!documentType || !documentId)) {
      return fail("document_type and document_id are required for document_viewed.", 400);
    }
    const agencyId = await resolveAgency(null, false);
    await audit(logAction, {
      agency_id: agencyId,
      document_type: documentType || null,
      document_id: documentId || null,
      details:
        body.details && typeof body.details === "object" ? body.details : null,
    });
    return json({ ok: true });
  }

  if (action !== "sign") {
    return fail('action must be "sign", "reauth", or "log".', 400);
  }

  // -- sign: validate the request ----------------------------------------------
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

  if (!(SIGNABLE_TYPES as readonly string[]).includes(documentType)) {
    return fail("Unknown document type.", 400);
  }
  if (!documentId || documentId.length > 256) {
    return fail("document_id must be 1–256 characters.", 400);
  }
  if (!fieldName || fieldName.length > 128) {
    return fail("field_name must be 1–128 characters.", 400);
  }
  if (signatureKind !== "signature" && signatureKind !== "initials") {
    return fail('signature_kind must be "signature" or "initials".', 400);
  }
  if (
    documentPayload === null ||
    typeof documentPayload !== "object" ||
    Array.isArray(documentPayload)
  ) {
    return fail("document_payload must be a non-null object.", 400);
  }
  const payloadText = stableStringify(documentPayload);
  if (payloadText.length > 1024 * 1024) {
    return fail("document_payload exceeds the 1 MB limit.", 400);
  }
  if (agencyIdRaw !== null && !UUID_RE.test(agencyIdRaw)) {
    return fail("agency_id must be a valid UUID.", 400);
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
    return fail("Could not verify the adopted signature.", 500);
  }
  if (!adopted || !adopted.consent_at) {
    return fail(
      "No adopted signature on file. Adopt a signature before signing.",
      403,
      "no_adopted_signature",
    );
  }

  const imagePath =
    signatureKind === "signature" ? adopted.signature_path : adopted.initials_path;
  if (!imagePath) {
    return fail(
      "No adopted " +
        (signatureKind === "signature" ? "signature" : "initials") +
        " on file. Adopt one before signing.",
      403,
      "no_adopted_signature",
    );
  }

  const { error: storageError } = await admin.storage
    .from("user-signatures")
    .download(imagePath);
  if (storageError) {
    console.error("apply-signature: signature image missing", storageError.message);
    return fail(
      "The adopted signature image was not found. Re-adopt your signature before signing.",
      403,
      "signature_image_missing",
    );
  }

  // 13 CSR 65-3.050 second identification component: the password re-entry
  // must be fresh (within REAUTH_WINDOW_SECONDS). The client opens the
  // password sheet when it sees code `reauth_required`.
  const { data: reauthState } = await admin
    .from("signature_reauth")
    .select("reauth_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const reauthAt = reauthState?.reauth_at ? new Date(reauthState.reauth_at as string).getTime() : 0;
  if (Date.now() - reauthAt > REAUTH_WINDOW_SECONDS * 1000) {
    return fail(
      "Confirm it\u2019s you: re-enter your password to sign.",
      403,
      "reauth_required",
    );
  }

  const agencyId = await resolveAgency(agencyIdRaw, true);
  if (!agencyId) {
    return fail("No active agency membership found for this account.", 403);
  }

  // -- Domain rules: every client-side signing rule, enforced here --------------
  const domainError = await checkDomainRules();
  if (domainError) return domainError;

  // -- Domain transitions: legacy columns the UI reads --------------------------
  // Mirrors the local API order (domain mutation, then the immutable event).
  // Every transition is idempotent, so a retry after a failed event insert
  // converges instead of wedging. A failed transition aborts the stamp: a
  // signature_events row is never written without its domain transition.
  const transitionError = await applyDomainTransition();
  if (transitionError) return transitionError;

  /** The signer's display name from their profile (for legacy name columns). */
  async function signerFullName(): Promise<string> {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    return String(
      (profile as { full_name: string } | null)?.full_name ?? "",
    ).trim();
  }

  /** Text initials derived from a display name (mirrors suggestInitials). */
  function textInitials(fullName: string): string {
    const words = fullName.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    const first = words[0][0] ?? "";
    const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
    return (first + last).toUpperCase();
  }

  async function applyDomainTransition(): Promise<Response | null> {
    const now = new Date().toISOString();
    if (documentType === "delegation_form") {
      if (fieldName === "rn_signature") {
        const fullName = await signerFullName();
        const { data: obligation } = await admin
          .from("obligations")
          .select("delegation_form")
          .eq("id", documentId)
          .maybeSingle();
        const form = (
          ((obligation as { delegation_form: unknown } | null)
            ?.delegation_form ?? {}) as Record<string, unknown>
        );
        const delegatingRn =
          typeof form.delegatingRn === "object" && form.delegatingRn !== null
            ? (form.delegatingRn as Record<string, string>)
            : {};
        delegatingRn.signatureName = fullName;
        delegatingRn.dateSigned = now.slice(0, 10);
        if (!String(delegatingRn.name ?? "").trim()) delegatingRn.name = fullName;
        form.delegatingRn = delegatingRn;
        const { error } = await admin
          .from("obligations")
          .update({
            delegating_rn_user_id: user.id,
            rn_signed_at: now,
            rn_signature_name: fullName,
            rn_signature_mark: adopted.signature_path,
            delegation_form: form,
          })
          .eq("id", documentId);
        if (error) {
          console.error("apply-signature: RN domain transition failed", error.message);
          return fail("Could not record the RN signature.", 500);
        }
        return null;
      }
      const rowMatch = /^row:(.+):initials$/.exec(fieldName);
      if (rowMatch) {
        const { data: obligation } = await admin
          .from("obligations")
          .select("delegation_form")
          .eq("id", documentId)
          .maybeSingle();
        const form = (
          ((obligation as { delegation_form: unknown } | null)
            ?.delegation_form ?? {}) as {
            roster?: Array<{ printName?: string; initials?: string }>;
          }
        );
        const roster = Array.isArray(form.roster) ? form.roster : [];
        const row = roster.find(
          (r) => rosterRowKey(String(r.printName ?? "")) === fieldName,
        );
        if (!row) {
          console.error(
            "apply-signature: roster row vanished between check and transition",
          );
          return fail("Roster row not found.", 400);
        }
        // Keep the legacy initials column in sync; the event carries the mark.
        // Initialing is not the row signature and does not lock the form.
        if (!row.initials) row.initials = textInitials(await signerFullName());
        const { error } = await admin
          .from("obligations")
          .update({ delegation_form: form })
          .eq("id", documentId);
        if (error) {
          console.error(
            "apply-signature: roster initials transition failed",
            error.message,
          );
          return fail("Could not record the roster initials.", 500);
        }
        return null;
      }
      return null;
    }
    if (documentType === "training_checklist") {
      if (fieldName === "staff_sign" || fieldName === "hm_countersign") {
        const [, traineeUserId, siteId] = documentId.split(":");
        const fullName = await signerFullName();
        const patch =
          fieldName === "staff_sign"
            ? {
                staff_signature_name: fullName,
                staff_signature_mark: adopted.signature_path,
                staff_signed_at: now,
              }
            : {
                hm_signature_name: fullName,
                hm_signature_mark: adopted.signature_path,
                hm_signed_at: now,
              };
        const { error } = await admin.from("training_countersignatures").upsert(
          {
            agency_id: agencyId,
            user_id: traineeUserId,
            site_id: siteId,
            ...patch,
          },
          { onConflict: "agency_id,user_id,site_id" },
        );
        if (error) {
          console.error(
            "apply-signature: countersignature transition failed",
            error.message,
          );
          return fail("Could not record the signature.", 500);
        }
        return null;
      }
      return null; // per-line initials: the event is the record.
    }
    if (documentType === "hm_checklist" && fieldName === "hm_signature") {
      const fullName = await signerFullName();
      const { error } = await admin
        .from("hm_weekly_checklists")
        .update({
          status: "submitted",
          submitted_at: now,
          attestation: {
            signedBy: fullName,
            signedAt: now,
            signatureMark: adopted.signature_path,
          },
        })
        .eq("id", documentId);
      if (error) {
        console.error(
          "apply-signature: checklist submit transition failed",
          error.message,
        );
        return fail("Could not submit the checklist.", 500);
      }
      return null;
    }
    return null; // certificate staff_ack: the event is the record.
  }

  async function checkDomainRules(): Promise<Response | null> {
    if (documentType === "training_checklist") {
      return checkTrainingChecklist();
    }
    if (documentType === "delegation_form") {
      return checkDelegationForm();
    }
    if (documentType === "hm_checklist") {
      return checkHmChecklist();
    }
    // certificate
    return checkCertificate();
  }

  /** All requirements for a staffer+site with an unresolved line count. */
  async function openTrainingLines(
    traineeUserId: string,
    siteId: string,
  ): Promise<{ total: number; open: number }> {
    const { data: lines, error } = await admin
      .from("training_requirements")
      .select("id,status")
      .eq("agency_id", agencyId)
      .eq("user_id", traineeUserId)
      .eq("site_id", siteId);
    if (error) {
      console.error("apply-signature: training_requirements lookup failed", error.message);
      return { total: -1, open: -1 };
    }
    const rows = (lines ?? []) as Array<{ id: string; status: string }>;
    const open = rows.filter(
      (r) => r.status !== "complete" && r.status !== "waived_na",
    ).length;
    return { total: rows.length, open };
  }

  async function documentLocked(): Promise<boolean> {
    // A whole-document SIGNATURE event (staff_sign / hm_countersign / …)
    // locks the sheet; per-line initials never lock it.
    const { data } = await admin
      .from("signature_events")
      .select("id")
      .eq("document_type", documentType)
      .eq("document_id", documentId)
      .not("field_name", "like", "line:%")
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  async function checkTrainingChecklist(): Promise<Response | null> {
    const parts = documentId.split(":");
    if (parts.length !== 3 || parts[0] !== "staff" || !parts[1] || !parts[2]) {
      return fail("Unknown document.", 400);
    }
    const [, traineeUserId, siteId] = parts;

    const lineMatch = /^line:(.+):v(\d+)$/.exec(fieldName);
    if (lineMatch) {
      // Per-line e-initials.
      if (signatureKind !== "initials") {
        return fail("Training lines are initialed, not signed.", 400);
      }
      const requirementId = lineMatch[1];
      const version = Number(lineMatch[2]);
      const { data: requirement } = await admin
        .from("training_requirements")
        .select("id,user_id,agency_id,site_id")
        .eq("id", requirementId)
        .maybeSingle();
      if (!requirement || (requirement as { agency_id: string }).agency_id !== agencyId) {
        return fail("Unknown signature field.", 400);
      }
      // Line ownership: ONLY the assigned staff member initials their lines.
      if ((requirement as { user_id: string }).user_id !== user.id) {
        return fail(
          "Only the assigned staff member can initial their own training lines.",
          403,
          "not_line_owner",
        );
      }
      const { data: signoff } = await admin
        .from("training_signoffs")
        .select("signoff_version,na")
        .eq("requirement_id", requirementId)
        .order("signoff_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!signoff || (signoff as { na: boolean }).na) {
        return fail("This line has no sign-off to initial.", 400, "no_signoff");
      }
      // Version matching: a stale client that initialed an edited line gets a
      // 409, not a stamp on the old version.
      if ((signoff as { signoff_version: number }).signoff_version !== version) {
        return fail(
          "This line was updated — refresh and initial the current version.",
          409,
          "stale_version",
        );
      }
      if (await documentLocked()) {
        return fail(
          "This sheet is signed and locked. Request a correction to amend it.",
          409,
          "document_locked",
        );
      }
      return null;
    }

    if (fieldName === "staff_sign") {
      if (signatureKind !== "signature") {
        return fail("The staff attestation needs a full signature.", 400);
      }
      if (user.id !== traineeUserId) {
        return fail("Staff must sign their own training sheet.", 403, "not_line_owner");
      }
      const { total, open } = await openTrainingLines(traineeUserId, siteId);
      if (total === 0) {
        return fail("No training lines assigned for this site yet.", 400);
      }
      if (open > 0) {
        return fail(
          `Initial or N/A every training line before signing (${open} still open).`,
          409,
          "lines_open",
        );
      }
      return null;
    }

    if (fieldName === "hm_countersign") {
      if (signatureKind !== "signature") {
        return fail("The countersignature needs a full signature.", 400);
      }
      if (!(await hasRole(agencyId, HM_ROLE_KEYS))) {
        return fail(
          "Only a house manager can counter-sign training.",
          403,
          "not_hm",
        );
      }
      const { data: staffEvent } = await admin
        .from("signature_events")
        .select("id")
        .eq("document_type", documentType)
        .eq("document_id", documentId)
        .eq("field_name", "staff_sign")
        .limit(1);
      if ((staffEvent?.length ?? 0) === 0) {
        return fail(
          "Staff must sign this sheet before the house manager.",
          409,
          "staff_first",
        );
      }
      const { total, open } = await openTrainingLines(traineeUserId, siteId);
      if (total === 0) {
        return fail("No training lines assigned for this site yet.", 400);
      }
      if (open > 0) {
        return fail(
          `Initial or N/A every training line before countersigning (${open} still open).`,
          409,
          "lines_open",
        );
      }
      return null;
    }

    return fail("Unknown signature field.", 400);
  }

  async function checkDelegationForm(): Promise<Response | null> {
    const { data: obligation } = await admin
      .from("obligations")
      .select("id,agency_id,kind,delegation_form,rn_signed_at")
      .eq("id", documentId)
      .maybeSingle();
    const ob = obligation as {
      id: string;
      agency_id: string;
      kind: string;
      delegation_form: { roster?: Array<{ printName?: string }> } | null;
      rn_signed_at: string | null;
    } | null;
    if (!ob || ob.kind !== "delegation" || ob.agency_id !== agencyId) {
      return fail("Delegation not found.", 400);
    }

    if (fieldName === "rn_signature") {
      if (signatureKind !== "signature") {
        return fail("The delegating RN attestation needs a full signature.", 400);
      }
      if (!(await hasRole(agencyId, ["nurse"]))) {
        return fail(
          "Only the delegating nurse can sign this form.",
          403,
          "not_nurse",
        );
      }
      return null;
    }

    const rowMatch = /^row:(.+):initials$/.exec(fieldName);
    if (rowMatch) {
      if (signatureKind !== "initials") {
        return fail("Roster rows are initialed, not signed.", 400);
      }
      const roster = Array.isArray(ob.delegation_form?.roster)
        ? ob.delegation_form!.roster!
        : [];
      const row = roster.find((r) => rosterRowKey(String(r.printName ?? "")) === fieldName);
      if (!row) return fail("Roster row not found.", 400);
      const printName = String(row.printName ?? "").trim();
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const myName = String(
        (profile as { full_name: string } | null)?.full_name ?? "",
      ).trim();
      // Only your own row: the printed name must match the signer's identity.
      if (!printName || printName.toLowerCase() !== myName.toLowerCase()) {
        return fail(
          printName
            ? `Only ${printName} can initial this row.`
            : "Only the named staff member can initial this row.",
          403,
          "not_line_owner",
        );
      }
      // The delegating RN signs first (paper order).
      const { data: rnEvent } = await admin
        .from("signature_events")
        .select("id")
        .eq("document_type", documentType)
        .eq("document_id", documentId)
        .eq("field_name", "rn_signature")
        .limit(1);
      if (!ob.rn_signed_at && (rnEvent?.length ?? 0) === 0) {
        return fail("The delegating RN must sign first.", 409, "rn_first");
      }
      return null;
    }

    return fail("Unknown signature field.", 400);
  }

  async function checkHmChecklist(): Promise<Response | null> {
    if (fieldName !== "hm_signature") return fail("Unknown signature field.", 400);
    if (signatureKind !== "signature") {
      return fail("The checklist attestation needs a full signature.", 400);
    }
    const { data: checklist } = await admin
      .from("hm_weekly_checklists")
      .select("id,agency_id,assigned_to_user_id")
      .eq("id", documentId)
      .maybeSingle();
    const cl = checklist as {
      id: string;
      agency_id: string;
      assigned_to_user_id: string | null;
    } | null;
    if (!cl || cl.agency_id !== agencyId) {
      return fail("Checklist not found.", 400);
    }
    if (cl.assigned_to_user_id) {
      if (cl.assigned_to_user_id !== user.id) {
        return fail(
          "Only the assigned house manager can sign this checklist.",
          403,
          "not_assignee",
        );
      }
    } else if (!(await hasRole(agencyId, HM_ROLE_KEYS))) {
      return fail(
        "Only a house manager can sign this checklist.",
        403,
        "not_hm",
      );
    }
    return null;
  }

  async function checkCertificate(): Promise<Response | null> {
    if (fieldName !== "staff_ack") return fail("Unknown signature field.", 400);
    // The event itself is the acknowledgment; the certificate row is
    // unchanged. Either kind is accepted (the UI uses initials here).
    const { data: cert } = await admin
      .from("staff_certificates")
      .select("id,agency_id,user_id")
      .eq("id", documentId)
      .maybeSingle();
    const c = cert as { id: string; agency_id: string; user_id: string } | null;
    if (!c || c.agency_id !== agencyId) {
      return fail("Certificate not found.", 400);
    }
    if (c.user_id !== user.id) {
      return fail(
        "Only the certificate holder can acknowledge it.",
        403,
        "not_line_owner",
      );
    }
    return null;
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
      device_id: deviceId,
      ip_address: ip,
    })
    .select("id, signed_at, signer_user_id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return fail(
        "This field has already been signed for this document.",
        409,
        "already_signed",
      );
    }
    console.error("apply-signature: insert failed", insertError.message);
    return fail("Could not record the signature.", 500);
  }

  await audit("sign_applied", {
    agency_id: agencyId,
    document_type: documentType,
    document_id: documentId,
    field_name: fieldName,
    details: { kind: signatureKind, consent_version: consentVersion },
  });

  // Mirror into the agency activity log (audit_events) so the Activity Log
  // page shows the signature alongside other agency events. Best-effort:
  // never block a legitimate signing because the log table had a bad moment.
  const signerDisplayName = await signerFullName();
  const { error: activityError } = await admin.from("audit_events").insert({
    agency_id: agencyId,
    actor_id: user.id,
    action: "signature.applied",
    target_type: "signature_event",
    target_id: event.id,
    detail: `${signerDisplayName || "A staff member"} signed ${documentType} (${fieldName})`,
  });
  if (activityError) {
    console.error("apply-signature: activity log insert failed", activityError.message);
  }

  console.log("apply-signature: signed", documentType, user.id);

  return json({
    ok: true,
    event_id: event.id,
    signed_at: event.signed_at,
    signer_user_id: event.signer_user_id,
    kind: signatureKind,
    document_hash: documentHash,
    signature_path: adopted.signature_path,
    initials_path: adopted.initials_path,
  });
});
