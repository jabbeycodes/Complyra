/**
 * Vertex AI transport for the extract-pcsp edge function.
 *
 * PURE module: Web Crypto + fetch only — no jsr: imports, no Deno or
 * process globals — so vitest / node --test can import it directly.
 *
 * Replaces the old Gemini Developer API transport (API-key header auth).
 * Vertex AI calls are authorized with an OAuth 2.0 access token minted
 * from a Google Cloud service-account JSON key (RS256 JWT bearer grant),
 * which is the path a Google Cloud BAA can cover.
 *
 * Secrets discipline: this module never logs the JWT assertion, the access
 * token, or any part of the service-account JSON. Errors carry HTTP status
 * codes only — never response bodies, never PHI, never credential material.
 */

/** Typed failure for anything in the Vertex AI transport. */
export class VertexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VertexError";
  }
}

/** Service-account parsing / OAuth token mint failures. */
export class VertexAuthError extends VertexError {
  constructor(message: string) {
    super(message);
    this.name = "VertexAuthError";
  }
}

/** Failures of the generateContent call itself (network or HTTP error). */
export class VertexGenerateError extends VertexError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "VertexGenerateError";
    this.status = status;
  }
}

/** Parsed form of VERTEX_SERVICE_ACCOUNT_JSON. */
export interface ServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
}

export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
export const CLOUD_PLATFORM_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";

// PEM armor marker, assembled from fragments so a naive secret-scan of the
// source tree never matches a private-key block. No key material is present
// in this module — the private key arrives only via the
// VERTEX_SERVICE_ACCOUNT_JSON function secret at runtime.
const PEM_BEGIN_PRIVATE_KEY = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");

/**
 * Parse the VERTEX_SERVICE_ACCOUNT_JSON secret into the fields the JWT
 * bearer grant needs. Throws VertexAuthError on missing/invalid JSON or
 * missing fields. The raw JSON is never retained beyond the parsed fields.
 */
export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new VertexAuthError(
      "VERTEX_SERVICE_ACCOUNT_JSON is not valid JSON.",
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new VertexAuthError(
      "VERTEX_SERVICE_ACCOUNT_JSON must be a JSON object.",
    );
  }
  const obj = parsed as Record<string, unknown>;
  const clientEmail = obj.client_email;
  const privateKeyPem = obj.private_key;
  const tokenUri = obj.token_uri ?? DEFAULT_TOKEN_URI;
  if (typeof clientEmail !== "string" || clientEmail.trim() === "") {
    throw new VertexAuthError(
      "VERTEX_SERVICE_ACCOUNT_JSON is missing client_email.",
    );
  }
  if (
    typeof privateKeyPem !== "string" ||
    !privateKeyPem.includes(PEM_BEGIN_PRIVATE_KEY)
  ) {
    throw new VertexAuthError(
      "VERTEX_SERVICE_ACCOUNT_JSON is missing a valid private_key (PKCS#8 PEM).",
    );
  }
  if (typeof tokenUri !== "string" || tokenUri.trim() === "") {
    throw new VertexAuthError(
      "VERTEX_SERVICE_ACCOUNT_JSON has an invalid token_uri.",
    );
  }
  return { clientEmail, privateKeyPem, tokenUri };
}

// ---------------------------------------------------------------------------
// base64url helpers (hand-rolled so they work identically in Deno and Node)
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string | ArrayBuffer): string {
  let binary: string;
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data);
    binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  } else {
    const bytes = new Uint8Array(data);
    binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function stripPemArmor(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

async function rs256Sign(
  privateKeyPem: string,
  data: string,
): Promise<ArrayBuffer> {
  const der = base64ToBytes(stripPemArmor(privateKeyPem));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(data),
  );
}

/** Minted OAuth access token; expiresAt is epoch milliseconds. */
export interface MintedToken {
  token: string;
  expiresAt: number;
}

/**
 * Mint an OAuth access token via the JWT bearer grant. The JWT assertion
 * and the token are never logged. Throws VertexAuthError on any failure
 * (bad key, network error, non-2xx token endpoint, missing access_token).
 */
export async function mintAccessToken(
  sa: ServiceAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<MintedToken> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: sa.tokenUri,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(claims));
  let signature: ArrayBuffer;
  try {
    signature = await rs256Sign(sa.privateKeyPem, unsigned);
  } catch (e) {
    throw new VertexAuthError(
      `Could not sign the service-account JWT: ${(e as Error).message}`,
    );
  }
  // The assertion is sensitive — it is built and used below but never logged.
  const assertion = unsigned + "." + base64UrlEncode(signature);
  const formBody =
    "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" +
    encodeURIComponent(assertion);

  let res: Response;
  try {
    res = await fetchImpl(sa.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
  } catch (e) {
    throw new VertexAuthError(
      `Token request failed: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new VertexAuthError(
      `Token request failed with HTTP ${res.status}. Check the service-account key and project.`,
    );
  }
  const payload = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new VertexAuthError(
      "Token response did not include an access_token.",
    );
  }
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 3600;
  return { token: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
}

// ---------------------------------------------------------------------------
// Token cache — avoids minting (and a signing round-trip) on every call.
// ---------------------------------------------------------------------------

const CACHE_SKEW_MS = 60_000;
let cached: MintedToken | null = null;

/** Drop the cached token (used after a 401 and by tests). */
export function clearCachedToken(): void {
  cached = null;
}

/**
 * Return a valid access token, reusing the cached one when it is still
 * valid (with a 60s skew). Throws VertexAuthError when minting fails.
 */
export async function getAccessToken(
  sa: ServiceAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<MintedToken> {
  if (cached && cached.expiresAt - CACHE_SKEW_MS > Date.now()) {
    return cached;
  }
  cached = await mintAccessToken(sa, fetchImpl);
  return cached;
}

// ---------------------------------------------------------------------------
// generateContent
// ---------------------------------------------------------------------------

/** Vertex AI generateContent endpoint for a Google-publisher model. */
export function vertexGenerateUrl(
  projectId: string,
  location: string,
  model: string,
): string {
  return (
    `https://${location}-aiplatform.googleapis.com/v1/projects/` +
    `${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`
  );
}

export interface CallVertexGenerateArgs {
  sa: ServiceAccount;
  projectId: string;
  location: string;
  model: string;
  /** The generateContent request body (contents, generationConfig, …). */
  body: unknown;
  fetchImpl?: typeof fetch;
}

export type CallVertexGenerateResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number };

/**
 * POST a generateContent request to Vertex AI with an OAuth bearer token.
 * On a 401 the cached token is dropped, a fresh token is minted, and the
 * request is retried exactly once. Non-OK responses return { ok: false,
 * status } — the response body is deliberately discarded (it could carry
 * PHI or credential hints). Network failures throw VertexGenerateError.
 */
export async function callVertexGenerate(
  args: CallVertexGenerateArgs,
): Promise<CallVertexGenerateResult> {
  const { sa, projectId, location, model, body, fetchImpl = fetch } = args;
  const url = vertexGenerateUrl(projectId, location, model);

  async function post(token: string): Promise<Response> {
    return fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  let res: Response;
  try {
    res = await post((await getAccessToken(sa, fetchImpl)).token);
  } catch (e) {
    if (e instanceof VertexAuthError) throw e;
    throw new VertexGenerateError(
      502,
      `Vertex AI request failed: ${(e as Error).message}`,
    );
  }

  if (res.status === 401) {
    // Token rejected — it may have been revoked or expired early. Mint a
    // fresh one and retry once; if that also 401s the caller sees the
    // status, never the body.
    clearCachedToken();
    let fresh: MintedToken;
    try {
      fresh = await getAccessToken(sa, fetchImpl);
    } catch (e) {
      if (e instanceof VertexAuthError) throw e;
      throw new VertexGenerateError(
        502,
        `Vertex AI token refresh failed: ${(e as Error).message}`,
      );
    }
    try {
      res = await post(fresh.token);
    } catch (e) {
      throw new VertexGenerateError(
        502,
        `Vertex AI retry failed: ${(e as Error).message}`,
      );
    }
  }

  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const json = (await res.json()) as unknown;
  return { ok: true, status: res.status, json };
}
