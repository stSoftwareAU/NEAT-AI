/**
 * Issue #3457 — benches and performance docs must not reference the private
 * `stSoftwareAU/GRQ` repository by file path.
 *
 * The uppercase-`GRQ` audit (`LiveDocsNoPrivateGrqReference.ts`) only catches
 * the literal `GRQ` token, so private *path* references that do not spell out
 * `GRQ` slip through: the downstream runner scripts `worker/learn.sh` /
 * `worker/sampler.sh`, and the sibling-checkout path `../GRQ/.trainData-*`.
 * These point public readers at files they cannot see and advertise the
 * private repo's internal layout.
 *
 * This test walks the real benches / performance docs and fails if any
 * reintroduces such a private path. It exercises behaviour (file content), not
 * the source text of any function.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Benches / performance docs that must not carry a private GRQ path. */
const TARGET_FILES = [
  "../../bench/SquashBudgetSelection.ts",
  "../../docs/archive/pr-summaries/pr-summary-3263.md",
  "../../docs/EVOLUTION_CONFIG_SWEEP_3400.md",
  "../../docs/SCORE_PER_HOUR_HARNESS.md",
];

/**
 * Return every line that references the private `GRQ` repo by file path: the
 * downstream runner scripts (`worker/learn.sh`, `worker/sampler.sh`) or a
 * sibling `../GRQ/` checkout path (including the `.trainData-binary_*` corpus).
 *
 * The lower-case in-tree `grq-3397` scale-preset name is a synthetic fixture,
 * not a private path, so it is deliberately not matched.
 *
 * @param source raw file source
 * @returns 1-indexed line numbers carrying a private path reference
 */
export function findPrivateWorkerScriptPaths(source: string): number[] {
  const pattern =
    /worker\/(?:learn|sampler)\.sh|\.\.\/GRQ\/|\.trainData-binary_/;
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

for (const rel of TARGET_FILES) {
  Deno.test(`${rel} has no private GRQ worker-script or checkout path (#3457)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateWorkerScriptPaths(source);
    assertEquals(
      hits,
      [],
      `${rel} references a private GRQ path on line(s) ${hits.join(", ")}. ` +
        `Reword to concept level (e.g. "the downstream production runner ` +
        `scripts", "the production training corpus (≈21 GiB, not ` +
        `distributable)") so the file stays verifiable by public readers.`,
    );
  });
}

Deno.test("findPrivateWorkerScriptPaths flags the worker runner scripts", () => {
  const src = [
    "Intro line.",
    "tuned by `worker/learn.sh` / `worker/sampler.sh` on the cluster.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateWorkerScriptPaths(src), [2]);
});

Deno.test("findPrivateWorkerScriptPaths flags a sibling GRQ checkout path", () => {
  const src = "requires the seed and `../GRQ/.trainData-binary_115`.\n";
  assertEquals(findPrivateWorkerScriptPaths(src), [1]);
});

Deno.test("findPrivateWorkerScriptPaths ignores the lower-case grq-3397 fixture", () => {
  const src = [
    "The synthetic `grq-3397` scale preset reproduces the dimensions.",
    "The downstream production runner scripts drive the same topology.",
  ].join("\n");
  assertEquals(findPrivateWorkerScriptPaths(src), []);
});

Deno.test("findPrivateWorkerScriptPaths returns empty for concept-level prose", () => {
  const src = [
    "The downstream production runner scripts select the scoring lane.",
    "The full A/B needs the production training corpus (≈21 GiB).",
  ].join("\n");
  assertEquals(findPrivateWorkerScriptPaths(src), []);
});

Deno.test("findPrivateWorkerScriptPaths returns empty for empty input", () => {
  assertEquals(findPrivateWorkerScriptPaths(""), []);
});
