/**
 * Issue #3633 — unit tests for `scripts/verify_provenance.ts`, the post-publish
 * gate that fails the release run when the published version carries no
 * Sigstore provenance.
 *
 * ## Why these tests changed (business-logic change, Issue #3633)
 *
 * The gate originally polled JSR's `<version>_meta.json` for a non-null
 * `rekorLogId`. JSR stopped populating that field for **every** package in the
 * registry around 2–3 July 2026 (upstream jsr-io/jsr#1474), so the gate turned
 * every publish red while `deno publish` kept minting genuine Sigstore
 * transparency-log entries. The gate now verifies the transparency-log entry in
 * **Rekor** directly — the authoritative source — and treats JSR's `rekorLogId`
 * as informational only. The `verifyProvenance` polling tests are therefore
 * replaced by `jsrRekorLogId` (informational, never throws) and
 * `verifySigstoreProvenance` (fail-loud) tests; `hasProvenance` and `metaUrl`
 * keep their original coverage.
 *
 * These call the real functions with an injected fetch/sleep so no network is
 * touched. The attestation itself only happens in the GitHub Actions OIDC
 * context at publish time, so this exercises the *detection* logic — the only
 * automatable surface — not the signing.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  attestationSubjects,
  extractLogIndex,
  hasProvenance,
  jsrRekorLogId,
  metaUrl,
  packageUrl,
  rekorEntryUrl,
  verifySigstoreProvenance,
} from "../../scripts/verify_provenance.ts";

const noSleep = (_ms: number) => Promise.resolve();

/** Base64-encode a UTF-8 string the same way Rekor encodes `attestation.data`. */
function b64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** Build the in-toto attestation payload Rekor returns for a JSR publish. */
function attestationData(subjectName: string): string {
  return b64(JSON.stringify({
    type: "https://in-toto.io/Statement/v1",
    subject: [{ name: subjectName, digest: { sha256: "deadbeef" } }],
    predicateType: "https://slsa.dev/provenance/v1",
  }));
}

/** Build a Rekor `GET /api/v1/log/entries?logIndex=N` response body. */
function rekorResponse(
  logIndex: number,
  subjectName: string | null,
  uuid = "24296fb24b8ad77a",
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    logIndex,
    integratedTime: 1785604350,
  };
  if (subjectName !== null) {
    entry.attestation = { data: attestationData(subjectName) };
  }
  return { [uuid]: entry };
}

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

/** A realistic `deno publish` transcript, as captured on GitHub Actions. */
const PUBLISH_OUTPUT = `Checking for slow types in the public API...
Check file:///home/runner/work/NEAT-AI/NEAT-AI/mod.ts
Publishing @stsoftware/neat-ai@6.2.0 ...
Provenance transparency log available at https://search.sigstore.dev/?logIndex=2313255666
Successfully published @stsoftware/neat-ai@6.2.0
Visit https://jsr.io/@stsoftware/neat-ai@6.2.0 for details
`;

Deno.test("extractLogIndex reads the Sigstore logIndex from `deno publish` output", () => {
  assertEquals(extractLogIndex(PUBLISH_OUTPUT), 2313255666);
});

Deno.test("extractLogIndex takes the last entry when a run prints several", () => {
  const output = PUBLISH_OUTPUT +
    "Provenance transparency log available at https://search.sigstore.dev/?logIndex=99\n";
  assertEquals(extractLogIndex(output), 99);
});

Deno.test("extractLogIndex fails loud when publish printed no transparency log", () => {
  // The #3234 rule: absence of a positive attestation marker is never success.
  const err = assertThrows(
    () =>
      extractLogIndex(
        "Publishing @stsoftware/neat-ai@6.2.0 ...\nSuccessfully published\n",
      ),
    Error,
    "no Sigstore transparency-log entry",
  );
  assert(
    err.message.includes("id-token: write"),
    "the failure must explain how provenance is enabled, got: " + err.message,
  );
});

Deno.test("extractLogIndex fails loud on empty publish output", () => {
  assertThrows(
    () => extractLogIndex(""),
    Error,
    "no Sigstore transparency-log entry",
  );
});

Deno.test("packageUrl builds the JSR package URL used as the attestation subject", () => {
  assertEquals(
    packageUrl("@stsoftware/neat-ai", "6.2.0"),
    "pkg:jsr/@stsoftware/neat-ai@6.2.0",
  );
});

Deno.test("rekorEntryUrl builds the Rekor lookup endpoint", () => {
  assertEquals(
    rekorEntryUrl(2313255666),
    "https://rekor.sigstore.dev/api/v1/log/entries?logIndex=2313255666",
  );
});

Deno.test("rekorEntryUrl honours a custom base URL without doubling slashes", () => {
  assertEquals(
    rekorEntryUrl(7, "https://rekor.example.test/"),
    "https://rekor.example.test/api/v1/log/entries?logIndex=7",
  );
});

Deno.test("attestationSubjects decodes the in-toto subject names", () => {
  const entry = {
    attestation: { data: attestationData("pkg:jsr/@scope/pkg@1.0.0") },
  };
  assertEquals(attestationSubjects(entry), ["pkg:jsr/@scope/pkg@1.0.0"]);
});

Deno.test("attestationSubjects returns nothing for missing or unusable data", () => {
  assertEquals(attestationSubjects({}), []);
  assertEquals(attestationSubjects({ attestation: {} }), []);
  assertEquals(attestationSubjects({ attestation: { data: "" } }), []);
  assertEquals(
    attestationSubjects({ attestation: { data: b64("not json") } }),
    [],
  );
  assertEquals(attestationSubjects(null), []);
  assertEquals(attestationSubjects("nope"), []);
});

Deno.test("verifySigstoreProvenance confirms the entry in Rekor (the #3633 fix)", async () => {
  const { fetch, calls } = stubFetch(
    rekorResponse(2313255666, "pkg:jsr/@stsoftware/neat-ai@6.2.0"),
  );
  const result = await verifySigstoreProvenance(
    "@stsoftware/neat-ai",
    "6.2.0",
    2313255666,
    { fetchImpl: fetch, log: () => {} },
  );
  assertEquals(result.logIndex, 2313255666);
  assertEquals(result.uuid, "24296fb24b8ad77a");
  assertEquals(result.subject, "pkg:jsr/@stsoftware/neat-ai@6.2.0");
  assertEquals(calls, [
    "https://rekor.sigstore.dev/api/v1/log/entries?logIndex=2313255666",
  ]);
});

Deno.test("verifySigstoreProvenance rejects an entry attesting a different version", async () => {
  // A transparency-log entry for some *other* artefact must never be accepted
  // as proof for this release.
  const { fetch } = stubFetch(
    rekorResponse(2313255666, "pkg:jsr/@stsoftware/neat-ai@6.1.1"),
  );
  const err = await assertRejects(
    () =>
      verifySigstoreProvenance("@stsoftware/neat-ai", "6.2.0", 2313255666, {
        fetchImpl: fetch,
        retries: 2,
        delayMs: 1,
        sleep: noSleep,
        log: () => {},
      }),
    Error,
    "does not attest",
  );
  assert(err.message.includes("pkg:jsr/@stsoftware/neat-ai@6.2.0"));
});

Deno.test("verifySigstoreProvenance fails loud when the entry carries no attestation", async () => {
  const { fetch } = stubFetch(rekorResponse(2313255666, null));
  await assertRejects(
    () =>
      verifySigstoreProvenance("@scope/pkg", "1.0.0", 2313255666, {
        fetchImpl: fetch,
        retries: 2,
        delayMs: 1,
        sleep: noSleep,
        log: () => {},
      }),
    Error,
    "does not attest",
  );
});

Deno.test("verifySigstoreProvenance rejects an entry with a mismatched logIndex", async () => {
  const { fetch } = stubFetch(
    rekorResponse(111, "pkg:jsr/@scope/pkg@1.0.0"),
  );
  await assertRejects(
    () =>
      verifySigstoreProvenance("@scope/pkg", "1.0.0", 222, {
        fetchImpl: fetch,
        retries: 2,
        delayMs: 1,
        sleep: noSleep,
        log: () => {},
      }),
    Error,
    "logIndex",
  );
});

Deno.test("verifySigstoreProvenance retries while Rekor is still integrating the entry", async () => {
  let attempt = 0;
  const fetchImpl = (() => {
    attempt++;
    if (attempt < 3) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(rekorResponse(5, "pkg:jsr/@scope/pkg@1.0.0")),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  const result = await verifySigstoreProvenance("@scope/pkg", "1.0.0", 5, {
    fetchImpl,
    retries: 5,
    delayMs: 1,
    sleep: noSleep,
    log: () => {},
  });
  assertEquals(result.logIndex, 5);
  assertEquals(attempt, 3);
});

Deno.test("verifySigstoreProvenance fails loud after exhausting retries", async () => {
  const fetchImpl =
    (() => Promise.reject(new Error("network down"))) as typeof fetch;
  await assertRejects(
    () =>
      verifySigstoreProvenance("@scope/pkg", "1.0.0", 5, {
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

Deno.test("verifySigstoreProvenance fails loud when Rekor returns no entries", async () => {
  const { fetch } = stubFetch({});
  await assertRejects(
    () =>
      verifySigstoreProvenance("@scope/pkg", "1.0.0", 5, {
        fetchImpl: fetch,
        retries: 2,
        delayMs: 1,
        sleep: noSleep,
        log: () => {},
      }),
    Error,
    "no transparency-log entry",
  );
});

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

Deno.test("jsrRekorLogId returns the registry's id when JSR recorded one", async () => {
  const { fetch, calls } = stubFetch({ rekorLogId: "abc123" });
  const id = await jsrRekorLogId("@scope/pkg", "1.0.0", {
    fetchImpl: fetch,
    log: () => {},
  });
  assertEquals(id, "abc123");
  assertEquals(calls, ["https://jsr.io/@scope/pkg/1.0.0_meta.json"]);
});

Deno.test("jsrRekorLogId is informational: null rekorLogId does not throw (Issue #3633)", async () => {
  // JSR reports null for every package registry-wide (jsr-io/jsr#1474). That
  // must be reported, never treated as a release-blocking failure — Rekor is
  // the gate.
  const { fetch } = stubFetch({ rekorLogId: null });
  const messages: string[] = [];
  const id = await jsrRekorLogId("@stsoftware/neat-ai", "6.2.0", {
    fetchImpl: fetch,
    log: (m) => messages.push(m),
  });
  assertEquals(id, null);
  assert(
    messages.some((m) => m.includes("jsr-io/jsr#1474")),
    "the informational note must cite the upstream regression, got: " +
      JSON.stringify(messages),
  );
});

Deno.test("jsrRekorLogId swallows transport failures (informational only)", async () => {
  const fetchImpl =
    (() => Promise.reject(new Error("network down"))) as typeof fetch;
  const messages: string[] = [];
  const id = await jsrRekorLogId("@scope/pkg", "1.0.0", {
    fetchImpl,
    log: (m) => messages.push(m),
  });
  assertEquals(id, null);
  assert(messages.some((m) => m.includes("network down")));
});
