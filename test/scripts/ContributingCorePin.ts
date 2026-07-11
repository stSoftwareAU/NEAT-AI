import { assert, assertEquals } from "@std/assert";

/**
 * Tests that CONTRIBUTING.md describes the NEAT-AI-core dependency as
 * immutable-SHA pinned — matching deno.json, README.md, AGENTS.md and the
 * `build.sh --verify-only` gate — rather than branch-tracking.
 *
 * Issue #3275 — CONTRIBUTING.md previously said core "follows latest Develop"
 * and showed a `rev`-less example config that would fail `quality.sh`
 * (which runs `build.sh --verify-only`, requiring `neatCore.rev`).
 */

const DENO_JSON = "deno.json";
const CONTRIBUTING = "CONTRIBUTING.md";

/**
 * Extract the `neatCore` pin advertised by a documented `json` fenced block
 * and parse it into an object. The fenced block is an object body
 * (a `"neatCore": { ... }` fragment), so we wrap it in braces before parsing.
 */
function extractDocNeatCore(
  doc: string,
): {
  repo?: unknown;
  ref?: unknown;
  rev?: unknown;
  assetSha256?: unknown;
} | null {
  const fences = doc.matchAll(/```json\s*([\s\S]*?)```/g);
  for (const match of fences) {
    const body = match[1];
    if (!body.includes('"neatCore"')) continue;
    try {
      const parsed = JSON.parse(`{${body}}`);
      return parsed.neatCore ?? null;
    } catch {
      // Not a parseable fragment — keep scanning for the right block.
    }
  }
  return null;
}

Deno.test("CONTRIBUTING.md documents a json neatCore example", async () => {
  const doc = await Deno.readTextFile(CONTRIBUTING);
  const docNeatCore = extractDocNeatCore(doc);
  assert(
    docNeatCore,
    `${CONTRIBUTING} must document a json neatCore block`,
  );
});

Deno.test("CONTRIBUTING.md neatCore example is SHA-pinned, not branch-tracking", async () => {
  const doc = await Deno.readTextFile(CONTRIBUTING);
  const docNeatCore = extractDocNeatCore(doc);
  assert(docNeatCore, `${CONTRIBUTING} must document a json neatCore block`);

  assert(
    typeof docNeatCore.rev === "string" &&
      /^[0-9a-f]{40}$/.test(docNeatCore.rev),
    "CONTRIBUTING.md neatCore example must include a 40-char hex neatCore.rev " +
      "so it matches the immutable-SHA policy and passes build.sh --verify-only",
  );
  assert(
    typeof docNeatCore.assetSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(docNeatCore.assetSha256),
    "CONTRIBUTING.md neatCore example must include a 64-char hex " +
      "neatCore.assetSha256 attesting the vendored WASM bundle",
  );
});

Deno.test("CONTRIBUTING.md neatCore example agrees with deno.json on repo", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  const denoNeatCore = json.neatCore;
  assert(denoNeatCore, "deno.json must define neatCore");

  const doc = await Deno.readTextFile(CONTRIBUTING);
  const docNeatCore = extractDocNeatCore(doc);
  assert(docNeatCore, `${CONTRIBUTING} must document a json neatCore block`);

  assertEquals(
    docNeatCore.repo,
    denoNeatCore.repo,
    "CONTRIBUTING.md and deno.json must agree on neatCore.repo",
  );
});

Deno.test("CONTRIBUTING.md does not claim core follows latest Develop", async () => {
  const doc = await Deno.readTextFile(CONTRIBUTING);
  // The branch-tracking claim contradicts the immutable-SHA pinning policy.
  assert(
    !/follows latest\s+`?Develop`?/i.test(doc),
    "CONTRIBUTING.md must not describe core as following latest Develop — " +
      "core is pinned by immutable SHA in deno.json (Issue #3275)",
  );
});
