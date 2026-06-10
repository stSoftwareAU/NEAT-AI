import { assert, assertEquals } from "@std/assert";

/**
 * Tests that deno.json conforms to the NEAT-AI-core
 * dependency pinning policy defined in docs/CORE_DEPENDENCY_POLICY.md.
 *
 * Issue #2342 — verifies repo+ref policy and documentation references.
 */

const DENO_JSON = "deno.json";
const POLICY_DOC = "docs/CORE_DEPENDENCY_POLICY.md";

Deno.test("deno.json pins neatCore repo and ref", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  const neatCore = json.neatCore;
  assert(neatCore, "deno.json must define neatCore");
  assertEquals(
    neatCore.repo,
    "stSoftwareAU/NEAT-AI-core",
    "neatCore.repo must target stSoftwareAU/NEAT-AI-core",
  );
  assert(
    typeof neatCore.ref === "string" && neatCore.ref.length > 0,
    "neatCore.ref must be a non-empty branch/tag/ref",
  );
  if (typeof neatCore.rev === "string" && neatCore.rev.length > 0) {
    assert(
      /^[0-9a-f]{40}$/.test(neatCore.rev),
      "neatCore.rev must be a full 40-character hex SHA when set",
    );
  }
});

Deno.test("core dependency policy document exists", async () => {
  const info = await Deno.stat(POLICY_DOC);
  assert(info.isFile, `${POLICY_DOC} must exist`);
});

/**
 * Extract the `neatCore` pin advertised by the documented `json` fenced block
 * in CORE_DEPENDENCY_POLICY.md and parse it into an object.
 *
 * The doc shows the canonical shape, e.g.
 *
 * ```json
 * "neatCore": {
 *   "repo": "stSoftwareAU/NEAT-AI-core",
 *   "ref": "Develop",
 *   "rev": "<40-char SHA>"
 * }
 * ```
 *
 * The fenced block is an object body (a `"neatCore": { ... }` fragment), so we
 * wrap it in braces before parsing. Returns the inner `neatCore` object.
 */
function extractDocNeatCore(
  doc: string,
): { repo?: unknown; ref?: unknown } | null {
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

/**
 * WHAT-test: the pin documented in CORE_DEPENDENCY_POLICY.md must agree with the
 * authoritative pin in deno.json on the values a machine can compare — `repo`
 * and `ref`. This fails only when the two genuinely disagree (e.g. the doc still
 * advertises an old ref after deno.json is bumped), not when surrounding prose
 * is reworded. `rev` is intentionally excluded: the doc carries a `<40-char SHA>`
 * placeholder rather than the live SHA.
 */
Deno.test("policy document pins the same neatCore repo and ref as deno.json", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  const denoNeatCore = json.neatCore;
  assert(denoNeatCore, "deno.json must define neatCore");

  const doc = await Deno.readTextFile(POLICY_DOC);
  const docNeatCore = extractDocNeatCore(doc);
  assert(
    docNeatCore,
    `${POLICY_DOC} must document a json neatCore block`,
  );

  assertEquals(
    docNeatCore.repo,
    denoNeatCore.repo,
    "policy doc and deno.json must agree on neatCore.repo",
  );
  assertEquals(
    docNeatCore.ref,
    denoNeatCore.ref,
    "policy doc and deno.json must agree on neatCore.ref",
  );
});
