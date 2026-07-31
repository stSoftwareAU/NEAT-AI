/**
 * Issue #3604 — unit cases for the shared private-repo reference scanner used
 * by the #3455 (archived docs) and #3458 (dependency-bump automation) guards.
 *
 * Seven guards previously carried six near-identical copies of this scanner
 * with subtly different patterns, so they disagreed about what was forbidden.
 * The detection contract now lives in one place
 * (`test/_privateRepoRefs.ts`) and is pinned here by the union of the fixtures
 * every one of those copies carried.
 *
 * This file is a private-repo *detector*: it embeds the forbidden slugs and
 * links verbatim as fixtures to verify its own detection logic.
 */

import { assertEquals } from "@std/assert";
import { findPrivateRepoRefs } from "../_privateRepoRefs.ts";

/** One scanner fixture: raw source lines and the lines expected to be flagged. */
type ScannerCase = {
  readonly name: string;
  readonly lines: readonly string[];
  readonly expected: number[];
};

/** Sources that must be flagged — a public reader cannot follow these. */
const FLAGGED: ScannerCase[] = [
  {
    name: "a bare GRQ# issue slug",
    lines: [
      "Intro line.",
      "reducing `popSize` (GRQ#3472 keeps population = 20).",
      "Closing line.",
    ],
    expected: [2],
  },
  {
    name: "an org-qualified GRQ# slug",
    lines: ["handed to the production repo (stSoftwareAU/GRQ#3472) with it."],
    expected: [1],
  },
  {
    name: "a bare VibeCoding# slug",
    lines: [
      "# bump-deps.sh — pre-PR dependency refresh",
      "# worker before quality.sh (see VibeCoding#1613, #1614).",
      "set -euo pipefail",
    ],
    expected: [2],
  },
  {
    name: "an org-qualified VibeCoding# slug",
    lines: ["worker-side PATH bootstrap (stSoftwareAU/VibeCoding#3532)."],
    expected: [1],
  },
  {
    name: "a VibeCoding# slug printed to stderr at runtime",
    lines: ['echo "Worker should revert per VibeCoding#1613." >&2'],
    expected: [1],
  },
  {
    name: "an org-qualified private repo path",
    lines: ["statistics derived from `stSoftwareAU/GRQ-cluster`."],
    expected: [1],
  },
  {
    name: "a private-repo blob link",
    lines: [
      "([net](https://github.com/stSoftwareAU/GRQ-cluster/blob/main/net.json))",
    ],
    expected: [1],
  },
  {
    name: "a private orchestration-repo blob URL",
    lines: [
      "Intro line.",
      "see https://github.com/stSoftwareAU/VibeCoding/blob/main/x.md here.",
    ],
    expected: [2],
  },
  {
    name: "every offending line in a multi-line source",
    lines: [
      "Clean opening line.",
      "reducing popSize (GRQ#3472 keeps population = 20).",
      "Still clean.",
      "tracked separately as stSoftwareAU/VibeCoding#3532 upstream.",
    ],
    expected: [2, 4],
  },
];

/** Sources that must stay clean — concept level, public, or a mnemonic. */
const CLEAN: ScannerCase[] = [
  {
    name: "the public NEAT-AI repository",
    lines: [
      "See https://github.com/stSoftwareAU/NEAT-AI/issues/2575 (public).",
    ],
    expected: [],
  },
  {
    name: "this repository's own issue numbers",
    lines: [
      "# Audit gate (two-phase, Issue #2465): reverts on failure.",
      "#   The automated dependency-bump worker then reverts the bump.",
      'echo "Worker should revert this bump." >&2',
    ],
    expected: [],
  },
  {
    name: "bare host/log/preset mnemonics",
    lines: [
      "On GRQ-21 the 4373 MB V8 limit was misread.",
      "The production-scale grq-3397 topology (seed 3396).",
      "The downstream GRQ-side defences become defence-in-depth.",
      "GRQ-3-rocket.log signature (output-0 self-loops).",
    ],
    expected: [],
  },
  {
    name: "a bare downstream consumer repo name",
    lines: [
      "Neither confirmed consumer (stSoftwareAU/GRQ, NEAT-AI-Examples) uses it.",
      "Logs were captured from the private stSoftwareAU/GRQ-logs repository.",
    ],
    expected: [],
  },
  {
    name: "concept-level archive prose",
    lines: [
      "The production `network.json` snapshot is far larger than documented.",
      "A cross-repo issue in the downstream production repo carries the action.",
      "The orchestration repo's tracking issue carries the worker fix.",
    ],
    expected: [],
  },
  {
    name: "concept-level automation prose",
    lines: [
      "# The automated dependency-bump worker reverts the bump when either",
      "# audit gate fails, so both gates stay self-describing.",
    ],
    expected: [],
  },
  { name: "empty input", lines: [], expected: [] },
];

for (const testCase of [...FLAGGED, ...CLEAN]) {
  const verb = testCase.expected.length > 0 ? "flags" : "ignores";
  Deno.test(`findPrivateRepoRefs ${verb} ${testCase.name} (#3604)`, () => {
    assertEquals(
      findPrivateRepoRefs(testCase.lines.join("\n")),
      testCase.expected,
    );
  });
}
