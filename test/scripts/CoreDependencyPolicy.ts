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
 * Read the cells of the markdown table row whose first cell mentions `needle`.
 * Returns null when no such row exists, so callers can assert on absence.
 */
function tableRowCells(doc: string, needle: string): string[] | null {
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length > 1 && cells[0].includes(needle)) return cells;
  }
  return null;
}

/**
 * Issue #3517 — the `assetSha256` pin is enforced only when the target rev
 * equals `neatCore.rev` (#3514); the release sidecar is the anchor on a
 * revision advance (#3515). The guard table must not advertise the pin as a
 * whole-of-download check.
 */
Deno.test("policy guard table scopes assetSha256 to same-rev downloads", async () => {
  const doc = await Deno.readTextFile(POLICY_DOC);
  const cells = tableRowCells(doc, "neatCore.assetSha256");
  assert(
    cells,
    `${POLICY_DOC} must document neatCore.assetSha256 in the guard table`,
  );

  const whenItRuns = cells[1];
  assert(
    !/every download/i.test(whenItRuns),
    `The assetSha256 pin is not verified on every download — guard table says "${whenItRuns}"`,
  );
  assert(
    /same[-\s]rev/i.test(whenItRuns),
    `The assetSha256 guard row must say it runs on same-rev downloads only — got "${whenItRuns}"`,
  );
});

/**
 * Issue #3517 — `--allow-unverified` no longer covers a revision advance
 * (#3515): an advance always requires the sidecar, with no override. Both the
 * modes table and the bootstrap prose must say so.
 */
Deno.test("policy doc narrows --allow-unverified to the bootstrap case", async () => {
  const doc = await Deno.readTextFile(POLICY_DOC);
  const cells = tableRowCells(doc, "--allow-unverified");
  assert(
    cells,
    `${POLICY_DOC} must document ./build.sh --allow-unverified in the modes table`,
  );
  assert(
    /revision advance/i.test(cells[1]),
    "The --allow-unverified modes-table row must state that it does not cover a " +
      `revision advance (Issue #3515) — got "${cells[1]}"`,
  );

  const bootstrapProse = doc.split(/\n\s*\n/).filter((block) =>
    !block.startsWith("|") && block.includes("--allow-unverified")
  );
  assert(
    bootstrapProse.length > 0,
    `${POLICY_DOC} must explain --allow-unverified in prose, not only in the modes table`,
  );
  assert(
    bootstrapProse.some((block) => /revision advance/i.test(block)),
    "The --allow-unverified prose must state that a revision advance is never " +
      "allowed to proceed unverified (Issue #3515)",
  );
});

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
