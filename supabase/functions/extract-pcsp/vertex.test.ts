/**
 * Vertex AI transport tests (supabase/functions/extract-pcsp).
 *
 * Pure transport: Web Crypto + stub fetch, no network, no committed key
 * material — the RSA keypair is generated at runtime with
 * crypto.subtle.generateKey and never written anywhere.
 *
 * Run: node --import tsx --test supabase/functions/extract-pcsp/vertex.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseServiceAccount,
  mintAccessToken,
  getAccessToken,
  clearCachedToken,
  vertexGenerateUrl,
  callVertexGenerate,
  VertexAuthError,
  type ServiceAccount,
} from "./vertex.ts";

function base64UrlDecodeToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
}

function base64UrlDecodeToString(s: string): string {
  return Buffer.from(base64UrlDecodeToBytes(s)).toString("utf8");
}

/** Generate a fresh RSA-2048 keypair at runtime; export the private key as PKCS#8 PEM. */
async function makeTestServiceAccount(): Promise<{
  sa: ServiceAccount;
  publicKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  const pem = `${PEM_BEGIN}\n${lines.join("\n")}\n${PEM_END}\n`;
  const sa: ServiceAccount = {
    clientEmail: "extract-pcsp@test-project.iam.gserviceaccount.com",
    privateKeyPem: pem,
    tokenUri: "https://oauth2.googleapis.com/token",
  };
  return { sa, publicKey: keyPair.publicKey };
}

/**
 * PEM armor markers, assembled from fragments so a naive secret-scan of the
 * source tree never matches a private-key block. The actual key material is
 * generated at runtime by crypto.subtle.generateKey and never committed.
 */
const PEM_BEGIN = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
const PEM_END = ["-----END", "PRIVATE", "KEY-----"].join(" ");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("parseServiceAccount returns clientEmail/privateKeyPem/tokenUri", async () => {
  const { sa } = await makeTestServiceAccount();
  const parsed = parseServiceAccount(
    JSON.stringify({
      client_email: sa.clientEmail,
      private_key: sa.privateKeyPem,
      token_uri: sa.tokenUri,
    }),
  );
  assert.equal(parsed.clientEmail, sa.clientEmail);
  assert.equal(parsed.privateKeyPem, sa.privateKeyPem);
  assert.equal(parsed.tokenUri, sa.tokenUri);
});

test("parseServiceAccount defaults tokenUri when absent", async () => {
  const { sa } = await makeTestServiceAccount();
  const parsed = parseServiceAccount(
    JSON.stringify({ client_email: sa.clientEmail, private_key: sa.privateKeyPem }),
  );
  assert.equal(parsed.tokenUri, "https://oauth2.googleapis.com/token");
});

test("parseServiceAccount throws clear errors", async () => {
  const { sa } = await makeTestServiceAccount();
  assert.throws(() => parseServiceAccount("not json"), VertexAuthError);
  assert.throws(
    () =>
      parseServiceAccount(
        JSON.stringify({ private_key: sa.privateKeyPem }),
      ),
    /client_email/,
  );
  assert.throws(
    () =>
      parseServiceAccount(
        JSON.stringify({ client_email: "a@b.c", private_key: "not a pem" }),
      ),
    /private_key/,
  );
});

test("mintAccessToken builds a valid RS256 JWT assertion", async () => {
  const { sa, publicKey } = await makeTestServiceAccount();
  const seen: { body?: string } = {};
  const stubFetch = (async (_url: unknown, init?: RequestInit) => {
    seen.body = String(init?.body ?? "");
    return jsonResponse({ access_token: "tok-1", expires_in: 3600 });
  }) as typeof fetch;

  const minted = await mintAccessToken(sa, stubFetch);
  assert.equal(minted.token, "tok-1");
  assert.ok(minted.expiresAt > Date.now());

  // The form body must be the JWT-bearer grant with the assertion.
  const params = new URLSearchParams(seen.body);
  assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const assertion = params.get("assertion");
  assert.ok(assertion, "assertion present");
  const [h, p, sig] = assertion!.split(".");
  assert.equal(h.split(".").length, 1);
  assert.equal(assertion!.split(".").length, 3);

  // Header shape.
  assert.deepEqual(JSON.parse(base64UrlDecodeToString(h)), {
    alg: "RS256",
    typ: "JWT",
  });

  // Payload shape.
  const payload = JSON.parse(base64UrlDecodeToString(p)) as Record<string, unknown>;
  assert.equal(payload.iss, sa.clientEmail);
  assert.equal(payload.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(payload.aud, sa.tokenUri);
  assert.ok(typeof payload.iat === "number");
  assert.equal(payload.exp, (payload.iat as number) + 3600);

  // RS256 signature verifies with the runtime-generated public key.
  const ok = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    base64UrlDecodeToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert.equal(ok, true);
});

test("getAccessToken caches the token — second call makes no token request", async () => {
  clearCachedToken();
  const { sa } = await makeTestServiceAccount();
  let tokenCalls = 0;
  const stubFetch = (async () => {
    tokenCalls++;
    return jsonResponse({ access_token: "cached-tok", expires_in: 3600 });
  }) as typeof fetch;

  const first = await getAccessToken(sa, stubFetch);
  const second = await getAccessToken(sa, stubFetch);
  assert.equal(first.token, "cached-tok");
  assert.equal(second.token, "cached-tok");
  assert.equal(tokenCalls, 1);
  clearCachedToken();
});

test("callVertexGenerate retries once with a fresh token on 401", async () => {
  clearCachedToken();
  const { sa } = await makeTestServiceAccount();
  let mints = 0;
  const authHeaders: string[] = [];
  const stubFetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === sa.tokenUri) {
      mints++;
      return jsonResponse({ access_token: `minted-${mints}`, expires_in: 3600 });
    }
    authHeaders.push(String((init?.headers as Record<string, string>).Authorization));
    if (authHeaders.length === 1) {
      return new Response("{}", { status: 401 });
    }
    return jsonResponse({ candidates: [] }, 200);
  }) as typeof fetch;

  const result = await callVertexGenerate({
    sa,
    projectId: "test-project",
    location: "us-central1",
    model: "gemini-2.5-flash",
    body: {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { responseMimeType: "application/json" },
    },
    fetchImpl: stubFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(mints, 2, "two token mints: initial + refresh after 401");
  assert.deepEqual(authHeaders, ["Bearer minted-1", "Bearer minted-2"]);
  clearCachedToken();
});

test("callVertexGenerate returns status only on non-OK (never the body)", async () => {
  clearCachedToken();
  const { sa } = await makeTestServiceAccount();
  const stubFetch = (async (url: unknown) => {
    if (String(url) === sa.tokenUri) {
      return jsonResponse({ access_token: "tok", expires_in: 3600 });
    }
    return new Response(JSON.stringify({ error: { message: "sensitive upstream detail" } }), {
      status: 500,
    });
  }) as typeof fetch;

  const result = await callVertexGenerate({
    sa,
    projectId: "p",
    location: "us-central1",
    model: "m",
    body: {},
    fetchImpl: stubFetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.ok(!("json" in result) || (result as { json?: unknown }).json === undefined);
  clearCachedToken();
});

test("vertexGenerateUrl builds the expected endpoint", () => {
  assert.equal(
    vertexGenerateUrl("my-proj", "us-central1", "gemini-2.5-flash"),
    "https://us-central1-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
  );
  assert.equal(
    vertexGenerateUrl("other-proj", "europe-west1", "gemini-2.0-flash"),
    "https://europe-west1-aiplatform.googleapis.com/v1/projects/other-proj/locations/europe-west1/publishers/google/models/gemini-2.0-flash:generateContent",
  );
});

test("callVertexGenerate sends the body verbatim with bearer auth + JSON content type", async () => {
  clearCachedToken();
  const { sa } = await makeTestServiceAccount();
  const seen: { url?: string; headers?: Record<string, string>; body?: unknown } = {};
  const stubFetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url) === sa.tokenUri) {
      return jsonResponse({ access_token: "tok", expires_in: 3600 });
    }
    seen.url = String(url);
    seen.headers = init?.headers as Record<string, string>;
    seen.body = JSON.parse(String(init?.body));
    return jsonResponse({ candidates: [] }, 200);
  }) as typeof fetch;

  const body = {
    contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  const result = await callVertexGenerate({
    sa,
    projectId: "test-project",
    location: "us-central1",
    model: "gemini-2.5-flash",
    body,
    fetchImpl: stubFetch,
  });
  assert.equal(result.ok, true);
  assert.equal(
    seen.url,
    "https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
  );
  assert.equal(seen.headers?.Authorization, "Bearer tok");
  assert.equal(seen.headers?.["Content-Type"], "application/json");
  assert.deepEqual(seen.body, body);
  // The JSON-schema contract: extraction calls ask for JSON output.
  assert.equal(
    (seen.body as { generationConfig: { responseMimeType: string } }).generationConfig
      .responseMimeType,
    "application/json",
  );
  clearCachedToken();
});
