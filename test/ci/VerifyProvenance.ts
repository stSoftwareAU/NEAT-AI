/**
 * Issue #3333 — unit tests for `scripts/verify_provenance.ts`, the post-publish
 * gate that fails the release run when a freshly published JSR version carries
 * no Sigstore provenance (`rekorLogId` null or missing).
 *
 * These call the real functions with an injected fetch/sleep so no network is
 * touched. The attestation itself only happens in the GitHub Actions OIDC
 * context at publish time, so this exercises the *detection* logic — the only
 * automatable surface — not the signing.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  hasProvenance,
  metaUrl,
  verifyProvenance,
} from "../../scripts/verify_provenance.ts";

const noSleep = (_ms: number) => Promise.resolve();

/** Build a Response-returning fetch from a fixed body/status. */
function stubFetch(
  body: unknown,
  status = 200,
): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

Deno.test("hasProvenance: non-empty rekorLogId string means attested", () => {
  assert(hasProvenance({ rekorLogId: "108e9186e8c5677a..." }));
});

Deno.test("hasProvenance: null / missing / empty means not attested", () => {
  assertEquals(hasProvenance({ rekorLogId: null }), false);
  assertEquals(hasProvenance({}), false);
  assertEquals(hasProvenance({ rekorLogId: "" }), false);
  assertEquals(hasProvenance({ rekorLogId: "   " }), false);
});

Deno.test("hasProvenance: non-object inputs are not attested", () => {
  assertEquals(hasProvenance(null), false);
  assertEquals(hasProvenance(undefined), false);
  assertEquals(hasProvenance("108e9..."), false);
  assertEquals(hasProvenance(42), false);
});

Deno.test("metaUrl builds the JSR version meta endpoint", () => {
  assertEquals(
    metaUrl("@stsoftware/neat-ai", "5.8.1"),
    "https://jsr.io/@stsoftware/neat-ai/5.8.1_meta.json",
  );
});

Deno.test("metaUrl honours a custom base URL without doubling slashes", () => {
  assertEquals(
    metaUrl("@scope/pkg", "1.0.0", "https://example.test/"),
    "https://example.test/@scope/pkg/1.0.0_meta.json",
  );
});

Deno.test("verifyProvenance returns the rekorLogId when attested", async () => {
  const { fetch, calls } = stubFetch({ rekorLogId: "abc123" });
  const id = await verifyProvenance("@scope/pkg", "1.0.0", {
    fetchImpl: fetch,
    log: () => {},
  });
  assertEquals(id, "abc123");
  assertEquals(calls, ["https://jsr.io/@scope/pkg/1.0.0_meta.json"]);
});

Deno.test("verifyProvenance throws when rekorLogId is null (the #3333 bug)", async () => {
  const { fetch } = stubFetch({ rekorLogId: null });
  const err = await assertRejects(
    () =>
      verifyProvenance("@stsoftware/neat-ai", "5.8.1", {
        fetchImpl: fetch,
        retries: 3,
        delayMs: 1,
        sleep: noSleep,
        log: () => {},
      }),
    Error,
    "no JSR provenance attestation",
  );
  // Message must name the version so the red CI run is self-explanatory.
  assert(err.message.includes("5.8.1"));
});

Deno.test("verifyProvenance retries until provenance appears (meta propagation)", async () => {
  let attempt = 0;
  const fetchImpl = (() => {
    attempt++;
    const body = attempt < 3 ? { rekorLogId: null } : { rekorLogId: "late-id" };
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200 }),
    );
  }) as typeof fetch;

  const id = await verifyProvenance("@scope/pkg", "2.0.0", {
    fetchImpl,
    retries: 5,
    delayMs: 1,
    sleep: noSleep,
    log: () => {},
  });
  assertEquals(id, "late-id");
  assertEquals(attempt, 3);
});

Deno.test("verifyProvenance retries on transient non-200 then succeeds", async () => {
  let attempt = 0;
  const fetchImpl = (() => {
    attempt++;
    if (attempt === 1) {
      return Promise.resolve(new Response("nope", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ rekorLogId: "ok" }), { status: 200 }),
    );
  }) as typeof fetch;

  const id = await verifyProvenance("@scope/pkg", "3.0.0", {
    fetchImpl,
    retries: 4,
    delayMs: 1,
    sleep: noSleep,
    log: () => {},
  });
  assertEquals(id, "ok");
});

Deno.test("verifyProvenance fails loud after exhausting retries on errors", async () => {
  const fetchImpl =
    (() => Promise.reject(new Error("network down"))) as typeof fetch;
  await assertRejects(
    () =>
      verifyProvenance("@scope/pkg", "4.0.0", {
        fetchImpl,
        retries: 2,
        delayMs: 1,
        sleep: noSleep,
        log: () => {},
      }),
    Error,
    "network down",
  );
});
