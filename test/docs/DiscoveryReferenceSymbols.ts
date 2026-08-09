/**
 * Issue #3695 — fact-check guard for the symbols, paths and signatures cited by
 * the Discovery reference documents.
 *
 * The audit found four families of dead reference:
 *
 *   1. `docs/DISCOVERY_DIR.md` cited `Creature.toJSON()`; the export API is
 *      `exportJSON()` / `exportSnapshotJSON()`.
 *   2. `docs/DISCOVERY_DIR.md` placed focus-selection traces under
 *      `focus-analysis/<discoveryID>/<timestamp>-focus-selection…json`; they are
 *      written as `focus-selection[-retry-N].json` inside the creature's temp
 *      directory (`.discovery/<creatureUuid>/`), with no timestamp prefix.
 *   3. `docs/DISCOVERY_ARCHITECTURE.md` named `getSuccessfulRemovalNeuronUUIDs()`;
 *      the real export is `getSuccessfulRemovalNeuronIds()`.
 *   4. `docs/api/DISCOVERY.md` documented four disk-space signatures that take
 *      neither the parameters nor the arity of the real functions.
 *
 * Plus a broken shell sample in `docs/DISCOVERY_GUIDE.md` whose continuations
 * were doubled (`\\`), which emits a literal backslash and splits the command.
 *
 * Every documented claim below is anchored to the live API, so neither half can
 * drift: the behaviour assertions fail if the code changes, and the doc
 * assertions fail if the corrected prose is reverted.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Creature } from "../../mod.ts";
import {
  checkDiskSpace,
  estimateRequiredDiskSpaceMB,
  logDiscoveryDiskUsage,
  preFlightDiskSpaceCheck,
} from "../../mod.ts";
import { getSuccessfulRemovalNeuronIds } from "@discovery/SuccessCache.ts";
import { writeFocusSelectionAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/FocusSelectionWeighting.ts";
import type { NeuronErrorInfo } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DIR_DOC = join(REPO_ROOT, "docs", "DISCOVERY_DIR.md");
const ARCH_DOC = join(REPO_ROOT, "docs", "DISCOVERY_ARCHITECTURE.md");
const GUIDE_DOC = join(REPO_ROOT, "docs", "DISCOVERY_GUIDE.md");
const API_DOC = join(REPO_ROOT, "docs", "api", "DISCOVERY.md");

const noopLog = (
  _level: "debug" | "info" | "warn" | "error",
  _message: string,
  _details?: unknown,
): void => {};

/**
 * Folds the table row (or bullet) documenting `symbol` onto one line so the
 * assertions survive a `deno fmt` reflow.
 */
function claimFor(content: string, symbol: string): string {
  const lines = content.split("\n");
  const row = lines.findIndex((line) => line.startsWith(`| \`${symbol}(`));
  const start = row >= 0
    ? row
    : lines.findIndex((line) => line.startsWith(`- \`${symbol}(`));
  assert(start >= 0, `document must carry a claim for ${symbol}`);

  const block = [lines[start]];
  if (lines[start].startsWith("- ")) {
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].startsWith("  ")) break; // end of the wrapped bullet
      block.push(lines[i]);
    }
  }
  return block.join(" ").replace(/\s+/g, " ");
}

Deno.test("DISCOVERY_DIR.md: creature samples cite the real export API", async () => {
  // Behaviour anchor: there is no toJSON(); exportJSON() is the export API.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  assertEquals(
    (creature as unknown as Record<string, unknown>).toJSON,
    undefined,
    "Creature has no toJSON() method",
  );
  assertEquals(
    typeof creature.exportJSON,
    "function",
    "exportJSON() is the export API",
  );

  const doc = await Deno.readTextFile(DIR_DOC);
  assert(
    !doc.includes("toJSON()"),
    "DISCOVERY_DIR.md must not cite the non-existent Creature.toJSON()",
  );
  assert(
    doc.includes("exportJSON()"),
    "DISCOVERY_DIR.md must cite exportJSON() for creature samples",
  );
});

Deno.test("DISCOVERY_DIR.md: focus-selection traces are documented where they are written", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "focus-trace-doc-" });
  try {
    const neuronErrors: NeuronErrorInfo[] = [
      { id: 0, totalError: 1, impact: 0.5 },
      { id: 1, totalError: 0.5, impact: 0.25 },
    ];

    // Behaviour anchor: the first trace and a retry trace, both unprefixed.
    writeFocusSelectionAnalysis(
      tempDir,
      "discovery-id",
      false,
      neuronErrors,
      new Set([0]),
      1.5,
      "weighted",
      0.05,
      noopLog,
    );
    writeFocusSelectionAnalysis(
      tempDir,
      "discovery-id",
      false,
      neuronErrors,
      new Set([1]),
      1.5,
      "weighted",
      0.05,
      noopLog,
      2,
    );

    const written: string[] = [];
    for await (const entry of Deno.readDir(tempDir)) written.push(entry.name);
    written.sort();
    assertEquals(
      written,
      ["focus-selection-retry-2.json", "focus-selection.json"],
      "trace filenames carry no timestamp prefix",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }

  const dirDoc = await Deno.readTextFile(DIR_DOC);
  const archDoc = await Deno.readTextFile(ARCH_DOC);
  for (
    const [name, doc] of [["DISCOVERY_DIR.md", dirDoc], [
      "DISCOVERY_ARCHITECTURE.md",
      archDoc,
    ]]
  ) {
    assert(
      !doc.includes("focus-analysis"),
      `${name} must not reference the non-existent focus-analysis directory`,
    );
  }
  assert(
    dirDoc.includes("focus-selection[-retry-N].json"),
    "DISCOVERY_DIR.md must name the real trace filenames",
  );
  assert(
    !/\{timestamp\}-focus-selection/.test(dirDoc),
    "DISCOVERY_DIR.md must not document a timestamp-prefixed trace filename",
  );
});

Deno.test("DISCOVERY_ARCHITECTURE.md: success-cache query method exists under the documented name", () => {
  // Behaviour anchor: the real export, called on a missing cache directory.
  assertEquals(
    getSuccessfulRemovalNeuronIds("/tmp/neat-ai-no-such-success-cache").size,
    0,
    "getSuccessfulRemovalNeuronIds() returns an empty set for a missing cache",
  );
});

Deno.test("DISCOVERY_ARCHITECTURE.md: success-cache query is documented by its real name", async () => {
  const doc = await Deno.readTextFile(ARCH_DOC);
  assert(
    doc.includes("getSuccessfulRemovalNeuronIds()"),
    "architecture doc must name getSuccessfulRemovalNeuronIds()",
  );
  assert(
    !doc.includes("getSuccessfulRemovalNeuronUUIDs"),
    "architecture doc must not name the non-existent …NeuronUUIDs symbol",
  );
});

Deno.test("api/DISCOVERY.md: disk-space signatures match the real exports", async () => {
  // Behaviour anchors: each function called through its real parameter list.
  const tempDir = await Deno.makeTempDir({ prefix: "disk-space-doc-" });
  try {
    assertEquals(
      estimateRequiredDiskSpaceMB(1024 * 1024, 10),
      20,
      "estimateRequiredDiskSpaceMB(bytesPerSample, sampleCount) defaults to a 2.0 multiplier",
    );
    assertEquals(
      estimateRequiredDiskSpaceMB(1024 * 1024, 10, 1),
      10,
      "the third argument is the safety multiplier",
    );
    assertEquals(
      checkDiskSpace(tempDir, 0).ok,
      true,
      "checkDiskSpace(path, thresholdMB) passes a zero threshold",
    );
    assertEquals(
      preFlightDiskSpaceCheck(tempDir, 0, 0),
      true,
      "preFlightDiskSpaceCheck(path, minFreeDiskMB, criticalFreeDiskMB) proceeds",
    );
    // The second argument is a milestone label, not a logger.
    logDiscoveryDiskUsage(tempDir, "test milestone");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }

  const doc = await Deno.readTextFile(API_DOC);
  const expected: ReadonlyArray<[string, string]> = [
    ["checkDiskSpace", "checkDiskSpace(path, thresholdMB)"],
    [
      "estimateRequiredDiskSpaceMB",
      "estimateRequiredDiskSpaceMB(estimatedBytesPerSample, sampleCount, safetyMultiplier?)",
    ],
    ["getAvailableDiskSpaceMB", "getAvailableDiskSpaceMB(path)"],
    ["logDiscoveryDiskUsage", "logDiscoveryDiskUsage(dirPath, milestone)"],
    ["measureDirectorySize", "measureDirectorySize(dirPath)"],
    [
      "preFlightDiskSpaceCheck",
      "preFlightDiskSpaceCheck(path, minFreeDiskMB, criticalFreeDiskMB, estimatedRequiredMB?)",
    ],
  ];
  for (const [symbol, signature] of expected) {
    const claim = claimFor(doc, symbol);
    assert(
      claim.includes(`\`${signature}\``),
      `api/DISCOVERY.md must document ${signature}, got: ${claim}`,
    );
  }
});

Deno.test("DISCOVERY_GUIDE.md: shell samples use single-backslash line continuations", async () => {
  const lines = (await Deno.readTextFile(GUIDE_DOC)).split("\n");
  const offenders = lines
    .map((line, index) => ({ line, lineNo: index + 1 }))
    .filter(({ line }) => /\\\\$/.test(line));
  assertEquals(
    offenders,
    [],
    "a doubled backslash emits a literal backslash and splits the command",
  );
});
